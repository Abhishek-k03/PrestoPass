// Money is carried as integer PAISE everywhere -- the API, the database, and
// Razorpay's wire format all agree on that unit, so nothing divides by 100 until
// the moment a number becomes text. Floats never touch a price.

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// Paise are dropped in display, not in storage: Indian ticket prices are whole
// rupees, and "₹1,499" reads as a price where "₹1,499.00" reads as an invoice.
const INR_WITH_PAISE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

/** 149900 -> "₹1,499" (or "₹1,499.50" when the price is not a whole rupee). */
export const formatPaise = (paise: number): string =>
  paise % 100 === 0 ? INR.format(paise / 100) : INR_WITH_PAISE.format(paise / 100);

/** Admin input is in rupees; round on the boundary so 14.99 cannot become 1498. */
export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);

export const paiseToRupees = (paise: number): number => paise / 100;
