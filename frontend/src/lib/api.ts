import axios from "axios";

import { API_BASE_URL } from "./apiUrl";

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Attach Our token automatically for every request

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// GET /api/bookings/my → getMyBookingsHandler
export const fetchMyBookings = async ()=>{
  const res = await api.get(`/api/bookings/my`);
  return res.data;
  //token is auto attached to it by api.interceptors
};

// GET /api/bookings/:id → getBookingByIdHandler
export const fetchBookingById = async(id:number)=>{
  const res = await api.get(`/api/bookings/${id}`);
  return res.data;
};

// DELETE /api/bookings/:id → cancelBookingHandler
export const cancelMyBooking = async(id:number)=>{
  const res = await api.delete(`/api/bookings/${id}`);
}

export { api };
