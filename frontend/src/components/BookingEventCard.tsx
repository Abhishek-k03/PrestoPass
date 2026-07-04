import { bookingType } from "@/lib/types";
import React from "react";
import * as motion from "motion/react-client";
import {
  CalendarDays,
  Clock,
  CreditCard,
  IndianRupee,
  Ticket,
} from "lucide-react";
import { formatPaise } from "@/lib/money";

interface bookingEventProps {
  booking: bookingType;
  handleCancel: (id: number) => Promise<void>;
}

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Booking status and payment status are separate axes — a booking can be
// confirmed but unpaid — so they stay two chips rather than collapsing.
const statusChip = (status: string) => {
  if (status === "CONFIRMED" || status === "PAID")
    return "bg-success/12 text-success";
  if (status === "PENDING") return "bg-warning/15 text-warning";
  return "bg-destructive/12 text-destructive";
};

const BookingEventCard: React.FC<bookingEventProps> = ({
  booking,
  handleCancel,
}) => {
  const cancelled = booking.status === "CANCELLED";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      key={booking.id}
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors duration-150 hover:border-ink-700"
    >
      {/* Photo band — unscrimmed, desaturated once the booking is spent */}
      <div
        className={`aspect-video w-full border-b border-border bg-cover bg-center ${
          cancelled ? "saturate-[.3]" : ""
        }`}
        style={{ backgroundImage: `url(${booking.imageUrl})` }}
      />

      <div className="flex flex-1 flex-col gap-3.5 p-5">
        <div className="flex items-start justify-between gap-3.5">
          <h2
            className={`font-display text-[22px] leading-tight ${
              cancelled ? "text-ink-300" : "text-ivory"
            }`}
          >
            {booking.seat?.event?.name || "Untitled Event"}
          </h2>
          <span className="shrink-0 font-mono text-label text-muted-foreground">
            #{booking.id}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-caption ${statusChip(
              booking.status,
            )}`}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {title(booking.status)}
          </span>

          <span
            className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-caption ${statusChip(
              booking.paymentStatus,
            )}`}
          >
            <CreditCard className="size-3.5" />
            {title(booking.paymentStatus)}
          </span>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border pt-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Ticket className="size-4" /> Seat
            </span>
            <span className="font-mono text-label text-ink-100">
              {booking.seat?.seatNumber}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <CalendarDays className="size-4" /> Event
            </span>
            <span className="font-mono text-label text-ink-100">
              {booking.seat?.event?.date
                ? new Date(booking.seat.event.date).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "N/A"}
            </span>
          </div>

          {/* What was actually paid, snapshotted at purchase — not looked up
              from the event, which an admin may have repriced since. */}
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <IndianRupee className="size-4" /> Amount
            </span>
            <span
              className={`font-mono text-label ${
                cancelled ? "text-muted-foreground" : "text-ivory"
              }`}
            >
              {booking.amount ? formatPaise(booking.amount) : "—"}
              {booking.paymentMethod ? (
                <span className="ml-1.5 text-caption text-muted-foreground uppercase">
                  {booking.paymentMethod}
                </span>
              ) : null}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Clock className="size-4" /> Booked
            </span>
            <span className="font-mono text-label text-ink-100">
              {new Date(booking.createdAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
        </div>

        <div className="mt-auto flex gap-2.5 pt-3.5">
          <a
            href={`/events/${booking.seat.eventId}`}
            className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-border text-label text-ink-100 transition hover:border-ink-700 hover:text-ivory"
          >
            View event
          </a>

          <button
            onClick={() => handleCancel(booking.id)}
            disabled={cancelled}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 px-4 text-label text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
          >
            {cancelled ? "Cancelled" : "Cancel"}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default BookingEventCard;
