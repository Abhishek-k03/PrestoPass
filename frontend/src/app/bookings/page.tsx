"use client";

import { useEffect, useState } from "react";
import { TicketX, TriangleAlert } from "lucide-react";
import { fetchMyBookings, cancelMyBooking } from "@/lib/api";
import { bookingType } from "@/lib/types";
import Navbar from "@/components/Nav";
import Footer from "@/components/Footer";
import BookingEventCard from "@/components/BookingEventCard";

type Filter = "all" | "CONFIRMED" | "PENDING" | "CANCELLED";

// PENDING was missing from this list while the state type allowed it, so a
// pending booking was visible under All and unreachable by any filter.
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "PENDING", label: "Pending" },
  { key: "CANCELLED", label: "Cancelled" },
];

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<bookingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fetchMyBookings()
      .then((data) => setBookings(data.bookings))
      .catch(() => setError("Failed to load bookings"))
      .finally(() => setLoading(false));
  }, []);

  const handleCancel = async (id: number) => {
    try {
      await cancelMyBooking(id);
      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: "CANCELLED" } : b)),
      );
    } catch {
      setError("Could not cancel that booking. Nothing was changed.");
    }
  };

  const countFor = (key: Filter) =>
    key === "all"
      ? bookings.length
      : bookings.filter((b) => b.status === key).length;

  const filtered =
    filter === "all" ? bookings : bookings.filter((b) => b.status === filter);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <main className="mx-auto w-full max-w-6xl flex-1 px-8 pt-10 pb-14">
        <div className="mb-8 rounded-3xl border border-border bg-card p-8">
          <div className="max-w-3xl">
            <p className="text-kicker uppercase text-muted-foreground">
              {loading
                ? "Loading"
                : `${bookings.length} ${
                    bookings.length === 1 ? "reservation" : "reservations"
                  }`}
            </p>
            <h1 className="mt-2.5">My Bookings</h1>
            <p className="mt-2.5 text-base text-ink-300">
              All your ticket reservations.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`inline-flex h-8.5 cursor-pointer items-center rounded-md px-4 text-label transition ${
                  filter === f.key
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "border border-border text-ink-300 hover:border-ink-700 hover:text-ivory"
                }`}
              >
                {f.label} · {countFor(f.key)}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <p className="text-muted-foreground">Loading bookings…</p>
        )}

        {error && (
          <div className="mb-6 flex items-start gap-3.5 rounded-xl border border-destructive/30 bg-card p-6">
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

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center rounded-xl border border-border bg-card px-8 py-14 text-center">
            <TicketX
              className="mb-4 size-8 text-muted-foreground"
              strokeWidth={1.6}
            />
            <p className="font-semibold text-ivory">
              {filter === "all"
                ? "No bookings yet"
                : `No ${filter.toLowerCase()} bookings`}
            </p>
            <p className="mt-1.5 max-w-xs text-caption text-muted-foreground">
              Once you book a seat it appears here with your reference and seat
              number.
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((booking) => (
              <BookingEventCard
                booking={booking}
                handleCancel={handleCancel}
                key={booking.id}
              />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
