"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Search, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { eventType } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Nav";
import EventCard from "@/components/EventCard";
import EventCardSkeleton from "@/components/EventCardSkeleton";
import Searchbar from "@/components/Searchbar";
import Footer from "@/components/Footer";

const EventContent = () => {
  const { loading: authLoading } = useAuth();
  const [events, setEvents] = useState<eventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const query = searchParams.get("query") || "";

  useEffect(() => {
    if (authLoading) return;

    const fetchEvents = async () => {
      try {
        setLoading(true);
        setError("");
        const res = await api.get(
          `/api/events?query=${encodeURIComponent(query)}`,
        );
        setEvents(res.data.events);
      } catch (err) {
        setError("Failed to load events");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [authLoading, query]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <main className="mx-auto w-full max-w-6xl flex-1 px-8 pt-10 pb-14">
        <div className="mb-8 rounded-3xl border border-border bg-card p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-kicker uppercase text-muted-foreground">
                {loading ? "Loading" : `${events.length} events on sale`}
              </p>
              <h1 className="mt-2.5">Upcoming Events</h1>
              <p className="mt-2.5 text-base text-ink-300">
                Pick an event and grab your seat.
              </p>
            </div>
            <div className="w-full md:max-w-md">
              <Searchbar placeholder="Search events by name or venue..." />
            </div>
          </div>
        </div>

        {loading && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-3.5 rounded-xl border border-destructive/30 bg-card p-6">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-ivory">Could not load events</p>
              <p className="mt-1.5 text-caption text-muted-foreground">
                The server did not respond. Your connection may have dropped.
              </p>
              <button
                onClick={() => location.reload()}
                className="mt-3.5 inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-4 text-label text-ink-100 transition hover:border-ink-700 hover:text-ivory"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="flex flex-col items-center rounded-xl border border-border bg-card px-8 py-14 text-center">
            <Search className="mb-4 size-8 text-muted-foreground" strokeWidth={1.6} />
            <p className="font-semibold text-ivory">
              {query ? `No events match “${query}”` : "No events on sale"}
            </p>
            <p className="mt-1.5 max-w-xs text-caption text-muted-foreground">
              {query
                ? "Check the spelling, or clear the search to see everything."
                : "New shows appear here as soon as they go on sale."}
            </p>
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default function Event() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          Loading…
        </div>
      }
    >
      <EventContent />
    </Suspense>
  );
}
