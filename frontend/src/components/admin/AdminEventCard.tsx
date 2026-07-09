"use client";

import { eventType } from "@/lib/types";
import * as motion from "motion/react-client";
import { Pencil, Trash2 } from "lucide-react";

interface AdminEventCardProps {
  event: eventType;
  onEdit: (event: eventType) => void;
  onDelete: (eventId: number) => void;
  isDeleting?: boolean;
}

const AdminEventCard = ({
  event,
  onEdit,
  onDelete,
  isDeleting = false,
}: AdminEventCardProps) => {
  const date = new Date(event.date);
  const soldOut = event.availableSeats === 0;
  // Same 10% rule as the storefront — admin used to use 15%, which meant a
  // card could read "Low Stock" here and normal on /events.
  const lowStock =
    event.availableSeats > 0 && event.availableSeats <= event.totalSeats * 0.1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors duration-150 hover:border-ink-700"
    >
      <div
        className="h-26 w-full border-b border-border bg-cover bg-center"
        style={{ backgroundImage: `url(${event.imageUrl})` }}
      />

      <div className="flex flex-1 flex-col gap-3 p-[18px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl leading-tight text-ivory">
              {event.name}
            </h3>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {event.venue}
            </p>
          </div>
          <span className="shrink-0 font-mono text-caption text-muted-foreground">
            #{event.id}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-caption text-ink-300">
            {date.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}{" "}
            ·{" "}
            {date.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>

          {soldOut ? (
            <span className="inline-flex h-[26px] items-center rounded-md bg-destructive px-2.5 text-caption font-semibold text-destructive-foreground">
              Sold out
            </span>
          ) : lowStock ? (
            <span className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-warning/15 px-2.5 text-caption text-warning">
              <span className="size-1.5 rounded-full bg-warning" />
              Low stock
            </span>
          ) : (
            <span className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-success/12 px-2.5 text-caption text-success">
              <span className="size-1.5 rounded-full bg-success" />
              Active
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-md bg-muted p-3">
            <p className="text-kicker uppercase text-muted-foreground">
              Total seats
            </p>
            <p className="mt-1.5 font-mono text-metric-sm text-ink-100">
              {event.totalSeats.toLocaleString("en-IN")}
            </p>
          </div>

          <div className="rounded-md bg-muted p-3">
            <p className="text-kicker uppercase text-muted-foreground">
              Available
            </p>
            <p
              className={`mt-1.5 font-mono text-metric-sm ${
                soldOut
                  ? "text-muted-foreground"
                  : lowStock
                    ? "text-primary"
                    : "text-success"
              }`}
            >
              {event.availableSeats.toLocaleString("en-IN")}
            </p>
          </div>
        </div>

        <div className="mt-auto flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => onEdit(event)}
            className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border text-label text-ink-100 transition hover:border-ink-700 hover:text-ivory"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>

          <button
            type="button"
            onClick={() => onDelete(event.id)}
            disabled={isDeleting}
            aria-label={`Delete ${event.name}`}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-4 text-label text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
            {isDeleting ? "Deleting…" : ""}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminEventCard;
