"use client";

import { useEffect, useRef } from "react";
import { PaymentOrder, PaymentResult } from "./types";

interface Props {
  order: PaymentOrder;
  /** Ready only once checkout.js has executed; see RazorpayScript below. */
  scriptReady: boolean;
  onPaid: (result: PaymentResult) => void;
  onDismiss: () => void;
}

// Razorpay attaches a constructor to window; it has no types package worth a
// dependency for four fields.
type RazorpayOptions = Record<string, unknown>;
interface RazorpayInstance {
  open: () => void;
  close: () => void;
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/**
 * Opens Razorpay's hosted modal, which is where the UPI tab and card form
 * actually live. Renders nothing itself — the modal is Razorpay's own iframe.
 */
const RazorpayCheckout = ({ order, scriptReady, onPaid, onDismiss }: Props) => {
  // The modal must open exactly once per order. Without this guard a re-render
  // (a socket event, a countdown tick) stacks a second modal on the first.
  const opened = useRef(false);

  useEffect(() => {
    if (!scriptReady || opened.current || !window.Razorpay) return;
    opened.current = true;

    const instance = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount, // paise — the same unit we store
      currency: order.currency,
      name: "PrestoPass",
      description: `${order.eventName} · Seat ${order.seatNumber}`,
      prefill: order.prefill,
      // The Midnight Marquee amber, so the third-party modal does not fight the
      // shell it opens over.
      theme: { color: "#FEA91E" },
      handler: (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) =>
        onPaid({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
          // Razorpay does not report the method to the handler; the webhook
          // carries it, and the server records whichever arrives.
          method: "",
        }),
      modal: {
        // Closing the modal returns to the reservation panel with the hold
        // intact. The page promises "held for you for five minutes" with a
        // visible countdown and an explicit Cancel, so silently forfeiting the
        // seat on a mis-click would contradict it. The lock TTL still bounds it.
        ondismiss: onDismiss,
      },
    });

    instance.open();
  }, [scriptReady, order, onPaid, onDismiss]);

  return null;
};

export default RazorpayCheckout;
