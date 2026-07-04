"use client";

import Nav from "@/components/Nav";
import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { eventType } from "@/lib/types";
import Link from "next/link";
import * as motion from "motion/react-client";
import { CalendarDays, MapPin, TriangleAlert } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import Footer from "@/components/Footer";

const Home = () => {
  const [events, setEvents] = useState<eventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await api.get("/api/events");
        setEvents(res.data.events);
      } catch (err) {
        setError("Failed to load events");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Nav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-8 pt-10 pb-14">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="mb-8 rounded-3xl border border-border bg-card p-8"
        >
          <p className="text-kicker uppercase text-muted-foreground">
            On sale now
          </p>
          <h1 className="mt-2.5">Featured Events</h1>
          <p className="mt-2.5 text-base text-ink-300">
            Discover and book your next unforgettable experience.
          </p>
        </motion.div>

        {loading && (
          <div className="h-112 w-full animate-pulse rounded-xl border border-border bg-card" />
        )}

        {!loading && error && (
          <div className="flex items-start gap-3.5 rounded-xl border border-destructive/30 bg-card p-6">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-ivory">Could not load events</p>
              <p className="mt-1.5 text-caption text-muted-foreground">
                The server did not respond. Your connection may have dropped.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="rounded-xl border border-border bg-card px-8 py-14 text-center">
            <p className="font-semibold text-ivory">No events on sale</p>
            <p className="mt-1.5 text-caption text-muted-foreground">
              New shows appear here as soon as they go on sale.
            </p>
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <Carousel opts={{ align: "start", loop: true }} className="w-full">
            <CarouselContent className="ml-0">
              {events.map((event, index) => {
                const date = new Date(event.date);
                const soldOut = event.availableSeats === 0;
                const lowStock =
                  event.availableSeats > 0 &&
                  event.availableSeats <= event.totalSeats * 0.1;

                return (
                  <CarouselItem key={event.id} className="basis-full pl-0">
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 260,
                        damping: 24,
                        delay: index === 0 ? 0.1 : 0,
                      }}
                      className="mb-4"
                    >
                      <Link
                        href={`/events/${event.id}`}
                        className="group relative block h-112 overflow-hidden rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {/* Photo runs at full colour — no scrim. */}
                        <div
                          className="absolute inset-x-0 top-0 bottom-50 bg-cover bg-center transition-[filter] duration-150 group-hover:brightness-[1.04]"
                          style={{ backgroundImage: `url(${event.imageUrl})` }}
                        />

                        {/* A chip is a solid shape, so it may sit on pixels. */}
                        {(soldOut || lowStock) && (
                          <div className="absolute top-5 right-5">
                            {soldOut ? (
                              <span className="inline-flex h-[30px] items-center rounded-md bg-destructive px-3 text-caption font-semibold text-destructive-foreground">
                                Sold out
                              </span>
                            ) : (
                              <span className="inline-flex h-[30px] items-center gap-1.5 rounded-md bg-warning/15 px-3 text-caption text-warning backdrop-blur-none">
                                <span className="size-1.5 rounded-full bg-warning" />
                                Few seats left
                              </span>
                            )}
                          </div>
                        )}

                        {/* The ink shelf: type never sits on pixels. Hard top
                            edge rather than a gradient fade. */}
                        <div className="absolute inset-x-0 bottom-0 flex h-50 items-end justify-between gap-14 border-t border-border bg-background p-8">
                          <div className="min-w-0">
                            <p className="text-kicker uppercase text-primary">
                              Featured event
                            </p>
                            <h2 className="mt-3 truncate text-[52px] leading-[1.02] tracking-[-0.02em]">
                              {event.name}
                            </h2>
                            <div className="mt-3 flex items-center gap-1.5 text-muted-foreground">
                              <MapPin className="size-4 shrink-0" />
                              <span className="text-label">{event.venue}</span>
                            </div>
                          </div>

                          <div className="flex shrink-0 gap-12 text-right">
                            <div>
                              <p className="text-kicker uppercase text-muted-foreground">
                                Event date
                              </p>
                              <p className="mt-2.5 flex items-center gap-1.5 font-mono text-metric-sm text-ink-100">
                                <CalendarDays className="size-4 text-muted-foreground" />
                                {date.toLocaleDateString("en-GB", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            </div>

                            <div>
                              <p className="text-kicker uppercase text-muted-foreground">
                                Availability
                              </p>
                              <p
                                className={`mt-2 font-mono text-metric ${
                                  soldOut
                                    ? "text-muted-foreground"
                                    : lowStock
                                      ? "text-primary"
                                      : "text-ivory"
                                }`}
                              >
                                {event.availableSeats.toLocaleString("en-IN")}
                              </p>
                              <p className="mt-1.5 text-caption text-muted-foreground">
                                of {event.totalSeats.toLocaleString("en-IN")}{" "}
                                seats
                              </p>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  </CarouselItem>
                );
              })}
            </CarouselContent>

            <CarouselPrevious className="absolute top-32 left-5 size-10 rounded-md border border-border bg-background/70 text-ivory hover:bg-background" />
            <CarouselNext className="absolute top-32 right-5 size-10 rounded-md border border-border bg-background/70 text-ivory hover:bg-background" />
          </Carousel>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default Home;
