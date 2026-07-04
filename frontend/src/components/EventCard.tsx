import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { eventType } from "@/lib/types";
import { formatPaise } from "@/lib/money";
import * as motion from "motion/react-client";

const EventCard = ({ event }: { event: eventType }) => {
  const date = new Date(event.date);
  const imageUrl = event.imageUrl;
  const soldOut = event.availableSeats === 0;
  const lowStock =
    event.availableSeats > 0 && event.availableSeats <= event.totalSeats * 0.1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <Link
        href={`/events/${event.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors duration-150 hover:border-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {/* Photo band — unscrimmed. No type ever sits on the image. */}
        <div
          className="aspect-video w-full border-b border-border bg-cover bg-center transition-[filter] duration-150 group-hover:brightness-[1.04]"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />

        {/* Ink body — everything readable lives here */}
        <div className="flex flex-1 flex-col gap-3 p-5">
          <h3
            className={`font-display text-title ${
              soldOut ? "text-ink-300" : "text-ivory"
            }`}
          >
            {event.name}
          </h3>

          <div className="flex items-center gap-1.5 text-muted-foreground transition-colors duration-150 group-hover:text-ink-300">
            <MapPin className="size-4 shrink-0" />
            <span className="text-label">{event.venue}</span>
          </div>

          {(soldOut || lowStock) && (
            <div className="flex gap-2">
              {soldOut ? (
                <span className="inline-flex h-[26px] items-center rounded-md bg-destructive px-2.5 text-caption font-semibold text-destructive-foreground">
                  Sold out
                </span>
              ) : (
                <span className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-warning/15 px-2.5 text-caption text-warning">
                  <span className="size-1.5 rounded-full bg-warning" />
                  Few seats left
                </span>
              )}
            </div>
          )}

          <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3.5">
            <div className="flex items-center gap-1.5 text-muted-foreground transition-colors duration-150 group-hover:text-ink-300">
              <CalendarDays className="size-4 shrink-0" />
              <span className="text-label">
                {date.toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>

            {/* The metric slot the design reserved for a price. The price takes
                it; the seat count drops to the caption beneath, so the row's
                geometry is unchanged. */}
            <div className="text-right">
              <span
                className={`block font-mono text-metric-sm ${
                  soldOut ? "text-muted-foreground" : "text-ivory"
                }`}
              >
                {event.price > 0 ? `From ${formatPaise(event.price)}` : "—"}
              </span>
              <span
                className={`mt-1 block text-caption ${
                  lowStock && !soldOut ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {event.availableSeats.toLocaleString("en-IN")} /{" "}
                {event.totalSeats.toLocaleString("en-IN")} seats
              </span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
};

export default EventCard;
