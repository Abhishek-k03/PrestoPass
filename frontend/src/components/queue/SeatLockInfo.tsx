"use client";

import { useEffect, useState } from "react";
import { Clock, Hourglass, Lock } from "lucide-react";
import { seatType } from "@/lib/types";
import { formatPaise } from "@/lib/money";

interface Props {
  seat: seatType | null;
  /** Ticket price in paise. 0 means the event is not priced yet. */
  price: number;
  lockExpiresIn: number | null;
  onPayNow: () => void;
  onCancel: () => void;
  onTimeOut: () => void;
  isOpeningCheckout?: boolean;
}

const LOCK_SECONDS = 300;

const SeatLockInfo = ({
  seat,
  price,
  lockExpiresIn,
  onPayNow,
  onCancel,
  onTimeOut,
  isOpeningCheckout = false,
}: Props) => {
  const [remaining, setRemaining] = useState(lockExpiresIn ?? 0);

  useEffect(() => {
    setRemaining(lockExpiresIn ?? 0);
  }, [lockExpiresIn]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [remaining]);

  if (!seat) return null;

  const isExpired = remaining <= 0;
  const isLastTenSeconds = remaining > 0 && remaining <= 10;

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const pct = Math.max(0, Math.min(100, (remaining / LOCK_SECONDS) * 100));

  if (isExpired) {
    return (
      <div className="rounded-xl border border-destructive/35 bg-destructive/10 p-7">
        <div className="flex items-start gap-5.5">
          <span className="flex size-13 shrink-0 items-center justify-center rounded-md bg-destructive/15 text-destructive">
            <Hourglass className="size-6" />
          </span>

          <div className="flex-1">
            <h3 className="font-display text-[28px] leading-tight text-ivory">
              Reservation expired
            </h3>
            <p className="mt-2 max-w-xl text-label text-destructive">
              Your time to confirm ran out and seat {seat.seatNumber} has been
              released back to the map. Pick a seat again — it may still be
              free.
            </p>

            <div className="mt-5.5 flex flex-wrap items-center gap-6">
              <div>
                <p className="text-kicker uppercase text-destructive">
                  Time left
                </p>
                <p className="mt-2 font-mono text-[34px] leading-none text-destructive">
                  0:00
                </p>
              </div>
              <button
                onClick={onTimeOut}
                className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md bg-destructive px-6 text-label font-semibold text-destructive-foreground transition hover:bg-destructive/90"
              >
                Back to seat selection
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border p-7 transition-colors ${
        isLastTenSeconds ? "border-destructive/35" : "border-primary/25"
      }`}
    >
      <div className="mb-6 flex items-center justify-between gap-5">
        <span
          className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-caption ${
            isLastTenSeconds
              ? "animate-pulse bg-destructive/12 text-destructive"
              : "bg-warning/15 text-warning"
          }`}
        >
          <Clock className="size-3.5" />
          {isLastTenSeconds ? "Expiring" : "Seat reserved"}
        </span>
      </div>

      <div className="mb-5.5 flex items-center gap-5">
        {/* Held, not actionable — the glow belongs to the CTA below. */}
        <div className="flex size-16 items-center justify-center rounded-md bg-primary font-mono text-[18px] text-primary-foreground">
          {seat.seatNumber.replace(/^[A-Za-z]+/, "")}
        </div>
        <div>
          <p className="text-kicker uppercase text-muted-foreground">
            Your seat
          </p>
          <p className="mt-1.5 font-mono text-2xl leading-none text-ivory">
            {seat.seatNumber}
          </p>
        </div>
      </div>

      <p className="text-label text-ink-300">
        This seat is held for you while you pay. Nobody else can take it until
        the timer runs out.
      </p>

      {/* The reserved price slot, now carrying a real amount. */}
      <div className="mt-5.5 flex items-end justify-between gap-5 border-t border-border pt-5">
        <div>
          <p className="text-kicker uppercase text-muted-foreground">
            Total payable
          </p>
          <p className="mt-2 font-mono text-metric leading-none text-ivory">
            {price > 0 ? formatPaise(price) : "—"}
          </p>
        </div>
        <p className="text-caption text-muted-foreground">1 ticket</p>
      </div>

      <div
        className={`mt-6 rounded-xl border bg-background p-5.5 ${
          isLastTenSeconds ? "border-destructive/35" : "border-border"
        }`}
      >
        <div className="flex items-end justify-between gap-5">
          <div>
            <p
              className={`text-kicker uppercase ${
                isLastTenSeconds ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              Time left to confirm
            </p>
            <p
              className={`mt-3 font-mono text-[44px] leading-none tracking-[-0.02em] ${
                isLastTenSeconds
                  ? "animate-pulse text-destructive"
                  : "text-primary"
              }`}
            >
              {minutes}:{seconds.toString().padStart(2, "0")}
            </p>
          </div>
          <p className="text-caption text-muted-foreground">of 5:00</p>
        </div>

        <div className="mt-4.5 h-1 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
              isLastTenSeconds ? "bg-destructive" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {/* The label states the amount because there finally is one: Booking
            carries it and a gateway collects it. */}
        <button
          onClick={onPayNow}
          disabled={isOpeningCheckout || price <= 0}
          className="inline-flex h-11.5 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary text-base font-semibold text-primary-foreground shadow-glow transition hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
        >
          {isOpeningCheckout ? (
            "Opening secure checkout…"
          ) : price > 0 ? (
            <>
              <Lock className="size-4" />
              Pay {formatPaise(price)}
            </>
          ) : (
            "Not available for sale"
          )}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex h-11.5 cursor-pointer items-center justify-center rounded-md border border-border px-6 text-label text-ink-100 transition hover:border-ink-700 hover:text-ivory"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default SeatLockInfo;
