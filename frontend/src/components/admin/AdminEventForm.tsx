"use client";

import { useMemo } from "react";
import { eventType } from "@/lib/types";
import { paiseToRupees, rupeesToPaise } from "@/lib/money";

interface AdminEventFormProps {
  event?: Partial<eventType>;
  onChange: (field: string, value: string | number) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

const FIELD =
  "h-10 w-full rounded-md border border-border bg-field px-3 text-label text-ink-100 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15";

const AdminEventForm = ({
  event,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: AdminEventFormProps) => {
  const eventDate = useMemo(() => {
    // useMemo() hook caches or memoizes the result of an expensive calculation re render
    if (!event?.date) return "";
    return new Date(event.date).toISOString().slice(0, 16);
  }, [event?.date]);

  return (
    <div className="rounded-xl border border-border bg-card p-7">
      <div className="mb-6 flex items-start justify-between gap-5">
        <div>
          <h2 className="font-display text-[26px] leading-tight text-ivory">
            {event ? "Edit event" : "Create new event"}
          </h2>
          <p className="mt-1 text-caption text-muted-foreground">
            Update event details or add a brand new show.
          </p>
        </div>
        {event?.id !== undefined && (
          <span className="shrink-0 font-mono text-label text-muted-foreground">
            #{event.id}
          </span>
        )}
      </div>

      <div className="grid gap-[18px] sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-caption text-ink-300">Name</span>
          <input
            value={event?.name || ""}
            onChange={(e) => onChange("name", e.target.value)}
            placeholder="Event name"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-caption text-ink-300">Venue</span>
          <input
            value={event?.venue || ""}
            onChange={(e) => onChange("venue", e.target.value)}
            placeholder="Venue name"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-caption text-ink-300">
            Date &amp; time
          </span>
          <input
            type="datetime-local"
            value={eventDate}
            onChange={(e) => onChange("date", e.target.value)}
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-caption text-ink-300">
            Total seats
          </span>
          <input
            type="number"
            min={1}
            value={event?.totalSeats || ""}
            onChange={(e) => onChange("totalSeats", Number(e.target.value))}
            placeholder="100"
            className={`${FIELD} font-mono`}
          />
        </label>

        {/* Stored in paise, entered in rupees. The conversion happens here, at
            the one boundary where a human types money, and nowhere else. */}
        <label className="block">
          <span className="mb-1.5 block text-caption text-ink-300">
            Ticket price
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-label text-muted-foreground">
              ₹
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={
                event?.price !== undefined && event.price > 0
                  ? paiseToRupees(event.price)
                  : ""
              }
              onChange={(e) =>
                onChange("price", rupeesToPaise(Number(e.target.value)))
              }
              placeholder="1499"
              className={`${FIELD} pl-7 font-mono`}
            />
          </div>
        </label>

        <div className="flex items-end">
          <p className="text-caption text-muted-foreground">
            One price for every seat in this event. Charged at checkout via UPI
            or card.
          </p>
        </div>
      </div>

      <label className="mt-[18px] block">
        <span className="mb-1.5 block text-caption text-ink-300">Image URL</span>
        <input
          value={event?.imageUrl || ""}
          onChange={(e) => onChange("imageUrl", e.target.value)}
          placeholder="https://images.example.com/event.jpg"
          className={FIELD}
        />
      </label>

      <div className="mt-7 flex justify-end gap-3 border-t border-border pt-5">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-border px-5 text-label text-ink-100 transition hover:border-ink-700 hover:text-ivory disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting}
          className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md bg-primary px-6 text-label font-semibold text-primary-foreground shadow-glow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
};

export default AdminEventForm;
