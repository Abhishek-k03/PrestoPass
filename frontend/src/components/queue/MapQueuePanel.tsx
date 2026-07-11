"use client";

import { Users } from "lucide-react";

interface MapQueuePanelProps {
  queuePosition: number | null;
  message: string;
  connectionType: "websocket" | "polling" | "none";
}

// MAX_ACTIVE_USERS on the backend. The honest number to show, since the
// backend computes queue position only and has no wait estimate to give.
const CONCURRENT_VIEWERS = 5;

const MapQueuePanel = ({
  queuePosition,
  message,
  connectionType,
}: MapQueuePanelProps) => {
  const status =
    connectionType === "websocket"
      ? {
          text: "Live updates",
          dot: "bg-success animate-pulse",
          chip: "bg-success/12 text-success",
        }
      : connectionType === "polling"
        ? {
            text: "Auto-refresh active",
            dot: "bg-accent animate-pulse",
            chip: "bg-accent/12 text-accent",
          }
        : {
            text: "Connecting…",
            dot: "bg-muted-foreground animate-ping",
            chip: "bg-muted text-muted-foreground",
          };

  return (
    <div className="rounded-xl border border-border bg-surface px-8 py-13">
      <div className="flex flex-col items-center text-center">
        <span
          className={`mb-9.5 inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-caption ${status.chip}`}
        >
          <span className={`size-1.5 rounded-full ${status.dot}`} />
          {status.text}
        </span>

        {/* Radar — the one looping animation on this screen, and it stands
            for live state rather than decoration. */}
        <div className="relative mb-8.5 flex size-30 items-center justify-center">
          <span className="absolute size-14 animate-ping rounded-full border-[1.5px] border-primary opacity-50" />
          <span
            className="absolute size-14 animate-ping rounded-full border-[1.5px] border-primary opacity-50"
            style={{ animationDelay: "0.8s" }}
          />
          <span
            className="absolute size-14 animate-ping rounded-full border-[1.5px] border-primary opacity-50"
            style={{ animationDelay: "1.6s" }}
          />
          <span className="relative flex size-14 items-center justify-center rounded-full border border-primary/30 bg-primary/12 text-primary">
            <Users className="size-6" />
          </span>
        </div>

        <h3 className="font-display text-[34px] leading-[1.08] text-ivory">
          Busy event traffic
        </h3>
        <p className="mt-3 max-w-lg text-base text-ink-300">
          This event is in extremely high demand, so you have been placed in the
          waiting queue to view the seat map.
        </p>

        <div className="mt-9 rounded-xl border border-border bg-background px-14 py-6.5">
          <p className="text-kicker uppercase text-muted-foreground">
            Queue position
          </p>
          <p className="mt-3.5 font-mono text-[52px] leading-none tracking-[-0.02em] text-primary">
            #{queuePosition?.toLocaleString("en-IN") ?? "—"}
          </p>
        </div>

        <p className="mt-6 max-w-md text-caption text-muted-foreground">
          {CONCURRENT_VIEWERS} people view the seat map at a time. You will
          enter automatically when a place opens — keep this page open.
        </p>

        {message && (
          <div className="mt-6 max-w-md rounded-md bg-accent/12 px-4 py-2.5 text-caption text-accent">
            {message}
          </div>
        )}
      </div>
    </div>
  );
};

export default MapQueuePanel;
