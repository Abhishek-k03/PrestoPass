"use client";

import React, { useEffect, useState, use, useCallback, useRef } from "react";
import Script from "next/script";
import { motion } from "motion/react";
import { ArrowRight, CalendarDays, MapPin, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { eventType, seatType } from "@/lib/types";
import { formatPaise } from "@/lib/money";
import Navbar from "@/components/Nav";
import SeatLockInfo from "@/components/queue/SeatLockInfo";
import PaymentQueuePanel from "@/components/queue/PaymentQueuePanel";
import MapQueuePanel from "@/components/queue/MapQueuePanel";
import MockCheckoutSheet from "@/components/checkout/MockCheckoutSheet";
import RazorpayCheckout, {
  RAZORPAY_SCRIPT_SRC,
} from "@/components/checkout/RazorpayCheckout";
import { PaymentOrder, PaymentResult } from "@/components/checkout/types";
import { socket } from "@/lib/socket"; //our socket manager
import { redirect, useRouter } from "next/navigation";
import Footer from "@/components/Footer";

interface PageProps {
  params: Promise<{ id: string }>;
}

const EventDetails = ({ params }: PageProps) => {
  const { id } = use(params);

  const handleTimeOut = () => {
    redirect(`/events`);
  };

  const router = useRouter();
  // --- APP STATES ---
  const [event, setEvent] = useState<eventType | null>(null);
  const [seats, setSeats] = useState<seatType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<seatType | null>(null); // Tracks clicked seat
  const [reservedSeat, setReservedSeat] = useState<seatType | null>(null);
  const [lockExpiresIn, setLockExpiresIn] = useState<number | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  type QueueStatus = "idle" | "waiting" | "processing" | "success" | "failed";
  const [queueState, setQueueState] = useState({
    status: "idle" as QueueStatus,
    message: "",
  });
  const [isLocking, setIsLocking] = useState(false); // Prevents spamming button clicks

  // The worker settles a payment in a single fast DB update with no network
  // round trip, so "processing" and "success" can arrive within the same
  // socket flush -- React never paints "processing" in between and the step
  // looks skipped. This holds each transient step on screen for a minimum
  // stretch so the user actually sees it, without slowing anything real down.
  const MIN_DISPLAY_MS: Partial<Record<QueueStatus, number>> = {
    waiting: 400,
    processing: 700,
  };
  const queueStatusRef = useRef<QueueStatus>(queueState.status);
  const queueStateEnteredAtRef = useRef<number>(Date.now());
  // A FIFO queue rather than a single cancelable timer: "processing" and
  // "success" can both arrive while "waiting" is still being timed out, and
  // a naive cancel-and-replace would let "success" clobber the still-pending
  // "processing" transition, skipping it entirely. Queuing lets each step
  // get its minimum on-screen time before the next one is even attempted.
  const queuePendingRef = useRef<{ status: QueueStatus; message: string }[]>([]);
  const queuePumpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    queueStatusRef.current = queueState.status;
  }, [queueState.status]);

  const pumpQueueState = useCallback(() => {
    if (queuePumpTimeoutRef.current) return; // a transition is already pending

    const next = queuePendingRef.current[0];
    if (!next) return;

    const current = queueStatusRef.current;
    const minMs = MIN_DISPLAY_MS[current] ?? 0;
    const elapsed = Date.now() - queueStateEnteredAtRef.current;

    const run = () => {
      queuePumpTimeoutRef.current = null;
      queuePendingRef.current.shift();
      queueStateEnteredAtRef.current = Date.now();
      queueStatusRef.current = next.status;
      setQueueState(next);
      pumpQueueState();
    };

    if (current !== next.status && minMs > elapsed) {
      queuePumpTimeoutRef.current = setTimeout(run, minMs - elapsed);
    } else {
      run();
    }
  }, []);

  const commitQueueState = useCallback(
    (next: { status: QueueStatus; message: string }) => {
      queuePendingRef.current.push(next);
      pumpQueueState();
    },
    [pumpQueueState],
  );

  // --- CHECKOUT STATE ---
  // An open order means a checkout is on screen. Nothing has been charged yet:
  // the money only moves once the gateway calls back and /verify accepts it.
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [isOpeningCheckout, setIsOpeningCheckout] = useState(false);
  const [razorpayReady, setRazorpayReady] = useState(false);

  // --- SEAT MAP WAITING QUEUE STATE ---
  const [mapQueueState, setMapQueueState] = useState<{
    isWaiting: boolean;
    position: number | null;
    message: string;
    connectionType: "websocket" | "polling" | "none";
  }>({
    isWaiting: false,
    position: null,
    message: "",
    connectionType: "none",
  });

  // --- DERIVED STATE ---
  const availableSeatsCount =
    seats.length > 0
      ? seats.filter((s) => s.status === "AVAILABLE").length
      : (event?.availableSeats ?? 0);

  const [activeBookingId, setActiveBookingId] = useState<number | null>(null);

  // --- FETCH SEATS MAP ---
  const fetchSeats = useCallback(async () => {
    try {
      const response = await api.get(`/api/events/${id}/seats`);
      if (response.data.status === "WAITING") {
        setMapQueueState((prev) => ({
          ...prev,
          isWaiting: true,
          position: response.data.queuePosition,
          message: response.data.message || "You are in the waiting queue.",
        }));
      } else {
        setMapQueueState((prev) => ({
          ...prev,
          isWaiting: false,
          position: null,
          message: "",
        }));
        setSeats(response.data.seats || []);

        console.log(seats);
      }
    } catch (err) {
      console.error("Failed to load seats map:", err);
      setError("Failed to load seats map.");
    }
  }, [id]);

  // --- POLLING FALLBACK FOR PAYMENT STATUS ---
  useEffect(() => {
    if (!activeBookingId || (queueState.status !== "waiting" && queueState.status !== "processing")) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/api/bookings/${activeBookingId}`);
        const booking = res.data?.booking;
        if (booking) {
          if (booking.status === "CONFIRMED" || booking.paymentStatus === "PAID") {
            commitQueueState({
              status: "success",
              message: "Your payment was processed successfully! Your ticket is confirmed.",
            });
            setActiveBookingId(null);
            fetchSeats();
          } else if (booking.status === "CANCELLED") {
            commitQueueState({
              status: "failed",
              message: "Payment processing failed. Your seat lock has been released.",
            });
            setActiveBookingId(null);
            fetchSeats();
          }
        }
      } catch (err) {
        console.error("Error polling booking status:", err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeBookingId, queueState.status, fetchSeats]);

  // --- FETCH DATA ON LOAD ---
  useEffect(() => {
    const fetchPageData = async () => {
      try {
        const eventResponse = await api.get(`/api/events/${id}`);
        setEvent(eventResponse.data.event);
        await fetchSeats();
      } catch (err) {
        setError("Failed to load event details.");
      } finally {
        setLoading(false); // Shuts off loading state
      }
    };

    fetchPageData();

    const token = localStorage.getItem("token");
    if (token) {
      socket.auth = { token };
      socket.connect();
    } else {
      setMapQueueState((prev) => ({
        ...prev,
        connectionType: "polling",
      }));
    }

    socket.on("connect", () => {
      console.log("Socket connected", socket.id);
      socket.emit("join_event_queue", id);
      socket.emit("join_seat_map", id);
      setMapQueueState((prev) => ({
        ...prev,
        connectionType: "websocket",
      }));
    });

    socket.on(
      "seat_status_changed",
      (payload: { seatId: number; status: string }) => {
        setSeats((prevSeats) =>
          prevSeats.map((s) =>
            s.id === payload.seatId
              ? { ...s, status: payload.status as seatType["status"] }
              : s,
          ),
        );
      },
    );

    socket.on("connect_error", (error: any) => {
      console.warn("Socket connect error:", error);
      setMapQueueState((prev) => ({
        ...prev,
        connectionType: "polling",
      }));
    });

    socket.on("disconnect", (reason: any) => {
      console.log("Socket disconnected:", reason);
    });

    // Listen for the success shout from paymentWorker.TS
    socket.on("booking_confirmed", (payload: any) => {
      commitQueueState({
        status: "success",
        message: payload.message || "Booking confirmed.",
      });
    });

    // Listen for the event when our worker is processing it at that time
    socket.on("payment_processing", (payload: any) => {
      commitQueueState({
        status: "processing",
        message: payload.message || "Your payment is being processed...",
      });
    });

    //listen for the FAILURE SHOUT
    socket.on("booking_failed", (payload: any) => {
      console.error("WebSocket Failure Receive :", payload);
      commitQueueState({
        status: "failed",
        message:
          payload.message ||
          "Booking failed. Your seat lock may have been released.",
      });
    });

    // Listen for the real time queue updates from queue.service.ts and update our mapQueueState
    socket.on("queue_update", (payload: any) => {
      setMapQueueState((prev) => ({
        ...prev,
        position: payload.queuePosition ?? prev.position,
        message: payload.message ?? prev.message,
      }));
    });

    socket.on("queue_promoted", (payload: any) => {
      setMapQueueState((prev) => ({
        ...prev,
        isWaiting: false,
        position: null,
        message: payload.message || "",
      }));
      fetchSeats();
    });

    socket.on("queue_moved", (payload: any) => {
      console.log("Queue moved received:", payload);
    });

    //cleanUp channnel on leave :always turn off walkie-talkies when leaving the page
    return () => {
      socket.off("connect");
      socket.off("connect_error");
      socket.off("disconnect");
      socket.off("booking_confirmed");
      socket.off("booking_failed");
      socket.off("queue_update");
      socket.off("queue_promoted");
      socket.off("queue_moved");
      socket.off("payment_processing");
      socket.off("seat_status_changed");
      socket.disconnect();
      if (queuePumpTimeoutRef.current) {
        clearTimeout(queuePumpTimeoutRef.current);
      }
      queuePendingRef.current = [];
    };
  }, [id, fetchSeats]);

  // Polling fallback when user is waiting in seat map queue
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (mapQueueState.isWaiting) {
      // Set connection type to polling if it's still 'none' after 2 seconds
      const timeoutId = setTimeout(() => {
        setMapQueueState((prev) => {
          if (prev.connectionType === "none") {
            return { ...prev, connectionType: "polling" };
          }
          return prev;
        });
      }, 2000);

      intervalId = setInterval(async () => {
        try {
          const response = await api.get(`/api/events/${id}/seats`);
          if (response.data.status === "ACTIVE") {
            setMapQueueState((prev) => ({
              ...prev,
              isWaiting: false,
              position: null,
              message: "",
            }));
            setSeats(response.data.seats || []);
          } else if (response.data.status === "WAITING") {
            setMapQueueState((prev) => ({
              ...prev,
              position: response.data.queuePosition,
              message: response.data.message || prev.message,
            }));
          }
        } catch (err) {
          console.error("Polling seat map failed:", err);
        }
      }, 5000);

      return () => {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
      };
    }
  }, [mapQueueState.isWaiting, id]);

  const handleReserveSeat = async () => {
    if (!selectedSeat) return;

    try {
      setIsLocking(true);

      const response = await api.post(
        `/api/seats/${id}/${selectedSeat.id}/lock`,
      );
      const expiresIn = response.data.lockExpiresIn ?? 300;

      setSeats((previousSeats) =>
        previousSeats.map((s) =>
          s.id === selectedSeat.id ? { ...s, status: "LOCKED" } : s,
        ),
      );

      setReservedSeat(selectedSeat);
      setSelectedSeat(null);
      setLockExpiresIn(expiresIn);
      setShowQueue(false);
      setQueueState({
        status: "idle",
        message: "Reserve your seat and then click Pay Now.",
      });
    } catch (err: any) {
      console.error(err);
      alert(
        err.response?.data?.message ||
          "Reservation failed. Please select a different seat.",
      );
    } finally {
      setIsLocking(false);
    }
  };

  // Step 1 of 2: open a gateway order. This creates the PENDING booking and
  // hands back what the checkout needs; it charges nothing.
  const handlePayNow = async () => {
    if (!reservedSeat || isOpeningCheckout) return;

    try {
      setIsOpeningCheckout(true);
      const response = await api.post("/api/payment/order", {
        eventId: id,
        seatId: reservedSeat.id,
        imageUrl: event?.imageUrl,
      });
      setOrder(response.data as PaymentOrder);
    } catch (err: any) {
      // The seat is still held here — the order never opened, so there is
      // nothing to roll back and no reason to send the user back to the map.
      alert(
        err.response?.data?.message ||
          "Could not open checkout. Please try again.",
      );
    } finally {
      setIsOpeningCheckout(false);
    }
  };

  // Step 2 of 2: relay the gateway's signed callback. The server re-checks the
  // signature — this call is a courier, not an authority.
  const handlePaid = useCallback(
    async (result: PaymentResult) => {
      if (!order) return;

      setOrder(null);
      setShowQueue(true);
      commitQueueState({
        status: "waiting",
        message: "Payment received. Confirming your seat...",
      });

      try {
        const response = await api.post("/api/payment/verify", {
          bookingId: order.bookingId,
          orderId: result.orderId,
          paymentId: result.paymentId,
          signature: result.signature,
          method: result.method,
        });

        if (response.data?.bookingId) {
          setActiveBookingId(response.data.bookingId);
        }
        // From here the existing socket listeners and the polling fallback
        // drive the rail; nothing else to do.
      } catch (err: any) {
        commitQueueState({
          status: "failed",
          message:
            err.response?.data?.message ||
            "We could not verify that payment. Your seat has been released.",
        });
        setActiveBookingId(null);
        fetchSeats();
      }
    },
    [order, fetchSeats, commitQueueState],
  );

  // Closing the checkout keeps the hold. The panel behind it promises the seat
  // is held for five minutes and shows a countdown plus an explicit Cancel, so
  // forfeiting it on a mis-click would break that promise. The Redis TTL still
  // bounds how long the seat can sit unpaid.
  const handleCheckoutDismiss = useCallback(() => {
    setOrder(null);
  }, []);

  const handleCancelReservation = async () => {
    try {
      const response = await api.delete(
        `/api/seats/${id}/${reservedSeat?.id}/lock`,
      );
      console.log(response);
    } catch (err: any) {
      console.error(err);
      alert(
        err.response?.data?.message ||
          "Something Went Wrong, return to Home page.",
      );
    }

    setSelectedSeat(null);
    setReservedSeat(null);
    setLockExpiresIn(null);
    setShowQueue(false);
    setQueueState({ status: "idle", message: "" });

    router.push("/events");
  };

  // Seats are a flat A1..An list. Chunking by array index alone gives the map
  // rows without touching the schema; it holds to roughly 600 seats, past
  // which this needs Seat.section / Seat.row and a zoomable map.
  const SEATS_PER_ROW = 20;
  const seatRows = Array.from(
    { length: Math.ceil(seats.length / SEATS_PER_ROW) },
    (_, r) => seats.slice(r * SEATS_PER_ROW, (r + 1) * SEATS_PER_ROW),
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-8 pt-10 pb-14">
        {loading && <p className="text-muted-foreground">Loading details…</p>}

        {error && (
          <div className="flex items-start gap-3.5 rounded-xl border border-destructive/30 bg-card p-6">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-ivory">{error}</p>
              <button
                onClick={() => location.reload()}
                className="mt-3.5 inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-4 text-label text-ink-100 transition hover:border-ink-700 hover:text-ivory"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {event && (
          <div className="flex flex-col gap-8">
            {/* HERO — photo band, hairline, ink header. No type on pixels. */}
            <div className="overflow-hidden rounded-3xl border border-border">
              <div
                className="h-80 w-full bg-cover bg-center"
                style={{ backgroundImage: `url(${event.imageUrl})` }}
              />

              <div className="border-t border-border bg-card p-8">
                <p className="text-kicker uppercase text-primary">
                  Event details
                </p>
                <h1 className="mt-3 text-hero">{event.name}</h1>

                <div className="mt-6.5 flex flex-col gap-6 border-t border-border pt-5.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-wrap gap-10">
                    <div>
                      <p className="text-kicker uppercase text-muted-foreground">
                        Venue
                      </p>
                      <p className="mt-2.5 flex items-center gap-1.5 text-label text-ink-100">
                        <MapPin className="size-4 text-muted-foreground" />
                        {event.venue}
                      </p>
                    </div>

                    <div>
                      <p className="text-kicker uppercase text-muted-foreground">
                        Event date
                      </p>
                      <p className="mt-2.5 flex items-center gap-1.5 text-label text-ink-100">
                        <CalendarDays className="size-4 text-muted-foreground" />
                        {new Date(event.date).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </p>
                    </div>

                    <div>
                      <p className="text-kicker uppercase text-muted-foreground">
                        Ticket price
                      </p>
                      <p className="mt-2.5 font-mono text-metric-sm text-primary">
                        {event.price > 0 ? formatPaise(event.price) : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 sm:text-right">
                    <p className="text-kicker uppercase text-muted-foreground">
                      Availability
                    </p>
                    <p className="mt-2 font-mono text-metric text-ivory">
                      {availableSeatsCount.toLocaleString("en-IN")}
                    </p>
                    <p className="mt-1.5 text-caption text-muted-foreground">
                      of {event.totalSeats.toLocaleString("en-IN")} seats
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* SEATING BOX */}
            <div className="rounded-xl border border-border bg-card p-7">
              <div className="mb-6.5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3>Select your seats</h3>
                  <p className="mt-1.5 text-caption text-muted-foreground">
                    Pick one seat. It is held for five minutes while you
                    confirm.
                  </p>
                </div>
                <div className="shrink-0 sm:text-right">
                  <p className="text-kicker uppercase text-muted-foreground">
                    Available
                  </p>
                  <p className="mt-1.5 flex items-baseline gap-1.5 sm:justify-end">
                    <span className="font-mono text-[20px] leading-none text-ivory">
                      {availableSeatsCount.toLocaleString("en-IN")}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      / {event.totalSeats.toLocaleString("en-IN")}
                    </span>
                  </p>
                </div>
              </div>

              {mapQueueState.isWaiting ? (
                <MapQueuePanel
                  queuePosition={mapQueueState.position}
                  message={mapQueueState.message}
                  connectionType={mapQueueState.connectionType}
                />
              ) : !reservedSeat && !showQueue ? (
                <>
                  {/* SEAT MAP — rows of 20, scrolls horizontally on phones */}
                  <div className="rounded-xl border border-border bg-surface p-6">
                    <div className="mx-auto max-w-[880px]">
                      <div className="mb-4.5 flex items-center gap-3">
                        <span className="h-px flex-1 bg-border" />
                        <span className="text-kicker uppercase tracking-[0.22em] text-muted-foreground">
                          Stage
                        </span>
                        <span className="h-px flex-1 bg-border" />
                      </div>

                      <div className="max-h-100 overflow-x-auto overflow-y-auto">
                        <div className="grid min-w-[620px] grid-cols-[1.5rem_repeat(20,minmax(0,1fr))] items-center gap-1.5">
                          {seatRows.map((row, r) => (
                            <React.Fragment key={r}>
                              <span className="pr-0.5 text-right font-mono text-[10px] text-muted-foreground">
                                {r + 1}
                              </span>
                              {row.map((singleSeat: seatType) => {
                                const isCurrentlySelected =
                                  selectedSeat?.id === singleSeat.id;
                                const booked = singleSeat.status === "BOOKED";
                                const locked = singleSeat.status === "LOCKED";

                                let tone =
                                  "bg-ink-700 text-ink-100 hover:bg-ink-700/80";
                                if (locked)
                                  tone =
                                    "cursor-not-allowed border-[1.5px] border-primary text-primary";
                                else if (booked)
                                  // Unlit: sits at the map's own ground with only
                                  // a hairline, and carries no label at all.
                                  tone =
                                    "cursor-not-allowed border border-border bg-surface";
                                if (isCurrentlySelected)
                                  tone =
                                    "bg-primary text-primary-foreground shadow-glow";

                                return (
                                  <button
                                    key={singleSeat.id}
                                    disabled={
                                      singleSeat.status !== "AVAILABLE" ||
                                      isLocking
                                    }
                                    aria-label={`Seat ${singleSeat.seatNumber}, ${
                                      booked
                                        ? "unavailable"
                                        : locked
                                          ? "held by someone else"
                                          : isCurrentlySelected
                                            ? "selected"
                                            : "available"
                                    }`}
                                    className={`flex h-8 items-center justify-center rounded-sm font-mono text-[11px] transition-colors ${tone}`}
                                    onClick={() => setSelectedSeat(singleSeat)}
                                  >
                                    {booked
                                      ? ""
                                      : singleSeat.seatNumber.replace(
                                          /^[A-Za-z]+/,
                                          "",
                                        )}
                                  </button>
                                );
                              })}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* LEGEND */}
                  <div className="mt-5.5 flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-2">
                      <span className="size-4.5 rounded-sm bg-ink-700" />
                      <span className="text-caption text-ink-300">
                        Available
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="size-4.5 rounded-sm border border-border bg-surface" />
                      <span className="text-caption text-ink-300">Booked</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="size-4.5 rounded-sm border-[1.5px] border-primary" />
                      <span className="text-caption text-ink-300">
                        Held by someone else
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="size-4.5 rounded-sm bg-primary" />
                      <span className="text-caption text-ink-300">
                        Your selection
                      </span>
                    </div>
                  </div>

                  {/* ACTION BAR — appears on selection */}
                  {selectedSeat && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 260,
                        damping: 24,
                      }}
                      className="mt-6 flex flex-col gap-5 rounded-xl border border-primary/28 bg-background p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-5">
                        {/* Echo of the selected seat, not a second call to
                            action — the glow stays on the seat and the CTA. */}
                        <div className="flex size-15 items-center justify-center rounded-md bg-primary font-mono text-[17px] text-primary-foreground">
                          {selectedSeat.seatNumber.replace(/^[A-Za-z]+/, "")}
                        </div>
                        <div>
                          <p className="text-kicker uppercase text-muted-foreground">
                            You selected
                          </p>
                          <p className="mt-1.5 font-mono text-[22px] leading-none text-ivory">
                            Seat {selectedSeat.seatNumber}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        {/* The slot the design reserved for a price, now
                            occupied by one. Nothing around it moved. */}
                        <div className="text-right">
                          <p className="text-kicker uppercase text-muted-foreground">
                            Price
                          </p>
                          <p className="mt-1.5 font-mono text-[18px] leading-none text-ivory">
                            {event.price > 0 ? formatPaise(event.price) : "—"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-kicker uppercase text-muted-foreground">
                            Held for
                          </p>
                          <p className="mt-1.5 font-mono text-[18px] leading-none text-primary">
                            5:00
                          </p>
                        </div>
                        <button
                          onClick={handleReserveSeat}
                          disabled={isLocking}
                          className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-6.5 text-base font-semibold text-primary-foreground shadow-glow transition hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isLocking ? "Reserving…" : "Reserve seat"}
                          <ArrowRight className="size-4" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </>
              ) : reservedSeat && !showQueue ? (
                <SeatLockInfo
                  seat={reservedSeat}
                  price={event.price ?? 0}
                  lockExpiresIn={lockExpiresIn}
                  onPayNow={handlePayNow}
                  onCancel={handleCancelReservation}
                  onTimeOut={handleTimeOut}
                  isOpeningCheckout={isOpeningCheckout}
                />
              ) : reservedSeat && showQueue ? (
                <PaymentQueuePanel
                  seat={reservedSeat}
                  queueState={queueState}
                />
              ) : null}
            </div>
          </div>
        )}
      </main>

      {/* Loaded only when an order actually needs it, so a mock-provider visit
          never pulls in a third-party script. lazyOnload defers it to browser
          idle time; the modal opens on onLoad. */}
      {order?.provider === "razorpay" && (
        <Script
          src={RAZORPAY_SCRIPT_SRC}
          strategy="lazyOnload"
          onLoad={() => setRazorpayReady(true)}
          onError={() => {
            setOrder(null);
            alert("Could not load the payment gateway. Your seat is still held.");
          }}
        />
      )}

      {order?.provider === "razorpay" && (
        <RazorpayCheckout
          order={order}
          scriptReady={razorpayReady}
          onPaid={handlePaid}
          onDismiss={handleCheckoutDismiss}
        />
      )}

      {order?.provider === "mock" && (
        <MockCheckoutSheet
          order={order}
          onPaid={handlePaid}
          onDismiss={handleCheckoutDismiss}
        />
      )}

      <Footer />
    </div>
  );
};

export default EventDetails;
