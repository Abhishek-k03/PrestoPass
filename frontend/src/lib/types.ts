interface eventType {
  id: number;
  name: string;
  venue: string;
  date: string;
  imageUrl: string;
  totalSeats: number;
  availableSeats: number;
  price: number; // PAISE. Format with formatPaise(); never divide by 100 inline.
}

enum ROLE {
  ADMIN = "ADMIN",
  CUSTOMER = "CUSTOMER",
}

interface userType {
  name: string;
  id: number;
  role: ROLE;
  email: string;
}

interface AuthContextType {
  user: userType | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

interface seatType {
  id: number;
  seatNumber: string;
  status: "AVAILABLE" | "LOCKED" | "BOOKED";
}

interface bookingType {
  id: number;
  status: string;
  paymentStatus: string;
  imageUrl: string;
  createdAt: string;
  amount?: number; // PAISE, snapshotted at purchase time
  currency?: string;
  paymentMethod?: string; // "upi" | "card" | "" — recorded, never trusted
  seat: {
    seatNumber: string;
    eventId: number; // ✅ only eventId, no event object
    event?: eventType; // Optional event object, can be undefined
  };
}

export type { eventType, seatType, bookingType, userType, AuthContextType };
export { ROLE };
