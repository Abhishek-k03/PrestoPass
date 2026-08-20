// The shape POST /api/payment/order returns, for either provider.

export interface PaymentOrder {
  bookingId: number;
  orderId: string;
  amount: number; // PAISE
  currency: string;
  keyId: string; // Razorpay publishable key; empty for the mock provider
  provider: "mock" | "razorpay";
  eventName: string;
  seatNumber: string;
  prefill: { name: string; email: string };
  // Mock provider only: there is no third party to sign the callback, so the
  // server mints one. /verify still refuses anything it did not sign.
  mockPaymentId?: string;
  mockSignature?: string;
}

/** What both checkouts hand back once the gateway says yes. */
export interface PaymentResult {
  orderId: string;
  paymentId: string;
  signature: string;
  method: "upi" | "card" | string;
}

// Razorpay's own test instruments; the mock provider honours the same ones so
// muscle memory carries between the two.
export const TEST_UPI_SUCCESS = "success@razorpay";
export const TEST_UPI_FAILURE = "failure@razorpay";
export const TEST_CARD_SUCCESS = "4111 1111 1111 1111";
export const TEST_CARD_FAILURE = "4000 0000 0000 0002";
