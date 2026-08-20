"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { CreditCard, Lock, Smartphone, TriangleAlert, X } from "lucide-react";
import { formatPaise } from "@/lib/money";
import {
  PaymentOrder,
  PaymentResult,
  TEST_CARD_FAILURE,
  TEST_CARD_SUCCESS,
  TEST_UPI_FAILURE,
  TEST_UPI_SUCCESS,
} from "./types";

interface Props {
  order: PaymentOrder;
  onPaid: (result: PaymentResult) => void;
  onDismiss: () => void;
}

const FIELD =
  "h-11 w-full rounded-md border border-border bg-field px-3 font-mono text-label text-ink-100 placeholder:text-ink-500 focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15";

// Deterministic outcomes, so a test can assert a decline instead of hoping for
// one. Anything else succeeds.
const declines = (instrument: string) =>
  instrument.trim().toLowerCase().endsWith("@fail") ||
  instrument.trim().toLowerCase() === TEST_UPI_FAILURE ||
  instrument.replace(/\s/g, "") === TEST_CARD_FAILURE.replace(/\s/g, "");

const MockCheckoutSheet = ({ order, onPaid, onDismiss }: Props) => {
  const [tab, setTab] = useState<"upi" | "card">("upi");
  const [vpa, setVpa] = useState(TEST_UPI_SUCCESS);
  const [cardNumber, setCardNumber] = useState(TEST_CARD_SUCCESS);
  const [expiry, setExpiry] = useState("12/30");
  const [cvv, setCvv] = useState("123");
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);

  const instrument = tab === "upi" ? vpa : cardNumber;
  const canSubmit =
    tab === "upi"
      ? vpa.includes("@")
      : cardNumber.replace(/\s/g, "").length >= 12 && cvv.length >= 3;

  const submit = async () => {
    setBusy(true);
    setDeclined(false);

    // The one thing worth simulating: a gateway is not instant, and the UI has
    // to stay coherent while it thinks.
    await new Promise((resolve) => setTimeout(resolve, 900));

    if (declines(instrument)) {
      // A declined payment never fires the handler, so nothing is verified and
      // the booking stays PENDING — exactly what a real decline does. The seat
      // is only released if the user then dismisses.
      setBusy(false);
      setDeclined(true);
      return;
    }

    onPaid({
      orderId: order.orderId,
      paymentId: order.mockPaymentId ?? "",
      signature: order.mockSignature ?? "",
      method: tab,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-1000/80 p-4 sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 26 }}
        role="dialog"
        aria-modal="true"
        aria-label="Mock payment checkout"
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div>
            <p className="text-kicker uppercase text-primary">
              Simulated gateway
            </p>
            <p className="mt-2 font-mono text-metric leading-none text-ivory">
              {formatPaise(order.amount)}
            </p>
            <p className="mt-2 text-caption text-muted-foreground">
              {order.eventName} · Seat {order.seatNumber}
            </p>
          </div>
          <button
            onClick={onDismiss}
            disabled={busy}
            aria-label="Cancel payment"
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-ink-700 hover:text-ivory disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex gap-2 border-b border-border p-4">
          {(["upi", "card"] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setTab(value);
                setDeclined(false);
              }}
              disabled={busy}
              className={`inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md text-label transition disabled:cursor-not-allowed ${
                tab === value
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "border border-border text-ink-300 hover:border-ink-700 hover:text-ivory"
              }`}
            >
              {value === "upi" ? (
                <Smartphone className="size-4" />
              ) : (
                <CreditCard className="size-4" />
              )}
              {value === "upi" ? "UPI" : "Card"}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "upi" ? (
            <label className="block">
              <span className="mb-2 block text-caption text-ink-300">
                UPI ID
              </span>
              <input
                value={vpa}
                onChange={(e) => setVpa(e.target.value)}
                disabled={busy}
                placeholder="yourname@bank"
                className={FIELD}
              />
            </label>
          ) : (
            <div className="grid gap-4.5">
              <label className="block">
                <span className="mb-2 block text-caption text-ink-300">
                  Card number
                </span>
                <input
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  disabled={busy}
                  inputMode="numeric"
                  className={FIELD}
                />
              </label>
              <div className="grid grid-cols-2 gap-4.5">
                <label className="block">
                  <span className="mb-2 block text-caption text-ink-300">
                    Expiry
                  </span>
                  <input
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    disabled={busy}
                    placeholder="MM/YY"
                    className={FIELD}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-caption text-ink-300">
                    CVV
                  </span>
                  <input
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value)}
                    disabled={busy}
                    inputMode="numeric"
                    maxLength={4}
                    className={FIELD}
                  />
                </label>
              </div>
            </div>
          )}

          {declined && (
            <div className="mt-5 flex items-start gap-3 rounded-md bg-destructive/12 p-4">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p className="text-label text-destructive">
                Payment declined. Your seat is still held — try another
                instrument, or cancel to release it.
              </p>
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy || !canSubmit}
            className="mt-6 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary text-base font-semibold text-primary-foreground shadow-glow transition hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
          >
            {busy ? (
              "Contacting bank…"
            ) : (
              <>
                <Lock className="size-4" />
                Pay {formatPaise(order.amount)}
              </>
            )}
          </button>

          {/* Self-documenting on purpose: this sheet exists to be tested, and a
              tester should not have to read the source to find the values. */}
          <div className="mt-5 rounded-md border border-border bg-surface p-4">
            <p className="text-kicker uppercase text-muted-foreground">
              Test instruments
            </p>
            <dl className="mt-3 grid gap-1.5 font-mono text-caption">
              <div className="flex justify-between gap-4">
                <dt className="text-success">succeeds</dt>
                <dd className="text-ink-300">
                  {tab === "upi" ? TEST_UPI_SUCCESS : TEST_CARD_SUCCESS}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-destructive">declines</dt>
                <dd className="text-ink-300">
                  {tab === "upi" ? TEST_UPI_FAILURE : TEST_CARD_FAILURE}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-caption text-muted-foreground">
              No money moves. Set PAYMENT_PROVIDER=razorpay for a real test-mode
              gateway.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default MockCheckoutSheet;
