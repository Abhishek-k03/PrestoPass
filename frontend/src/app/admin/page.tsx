"use client";

import { useMemo, useState, useEffect } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import {
  CalendarDays,
  Check,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
} from "lucide-react";
import AdminEventCard from "@/components/admin/AdminEventCard";
import AdminEventForm from "@/components/admin/AdminEventForm";
import AdminProtect from "@/middleware/AdminProtect";
import { eventType } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

const Admin = () => {
  /* I have Made our admin page as in Three sections, see all the events, see the events and data, a simple search field for the events that searches the things only on the frontend only, there is a common Events editor to avoid complexity for all the actions and you can only change the specific feilds in our editor (The AdminEventForm components does all the job) serving as a universal form*/

  // Now there are functions one for the fetchEvents which is the same copy as the one in our /events just fetches all the events and then updates our state on the UI

  const [events, setEvents] = useState<eventType[]>([]);
  const { loading: authLoading } = useAuth();

  const [selectedEvent, setSelectedEvent] = useState<eventType | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formEvent, setFormEvent] = useState<Partial<eventType>>({});
  const [searchQuery, setSearchQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = useState<number | null>(null);

  // this function is the common error state generator in out page pretty straightforward
  const getErrorMessage = (error: unknown) => {
    if (typeof error === "object" && error !== null) {
      if ("response" in error && (error as any).response?.data?.error) {
        return String((error as any).response.data.error);
      }
      if ("message" in error) return String((error as any).message);
    }

    return "An unexpected error occurred.";
  };

  const fetchEvents = async () => {
    setPageError("");
    try {
      setLoading(true);
      const res = await api.get("/api/events");
      setEvents(res.data.events || []);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchEvents();
  }, [authLoading]);

  const filteredEvents = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return events.filter(
      (event) =>
        event.name.toLowerCase().includes(query) ||
        event.venue.toLowerCase().includes(query),
    );
  }, [events, searchQuery]);

  //   Function that will be fired on clicking Edit for any event and its details will be changes to of this event now admin and see and modify the events using the AdminEventForm
  const handleEdit = (event: eventType) => {
    setSelectedEvent(event);
    setFormEvent(event);
    setIsFormOpen(true);
    setFormError("");
    setSuccessMessage("");
  };

  //   Function directly calling out DELETE Api to delete a function with a simple confirmation
  const handleDelete = async (eventId: number) => {
    const confirmed = window.confirm(
      "Delete this event? This cannot be undone.",
    );
    if (!confirmed) return;

    setDeleteLoadingId(eventId);
    setPageError("");
    setSuccessMessage("");

    try {
      await api.delete(`/api/events/${eventId}`);
      await fetchEvents();
      if (selectedEvent?.id === eventId) {
        setSelectedEvent(null);
        setFormEvent({});
        setIsFormOpen(false);
      }
      setSuccessMessage("Event deleted successfully.");
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setDeleteLoadingId(null);
    }
  };

  //   Function that handles creation of an event setting our all data in our selected event set and form event to null and then we can add a few things and save changes using our AdminFormEvent
  const handleCreate = () => {
    setSelectedEvent(null);
    setFormEvent({
      name: "",
      venue: "",
      imageUrl: "",
      date: new Date().toISOString().slice(0, 16),
      totalSeats: 50,
      availableSeats: 50,
      price: 149900, // paise
    });
    setIsFormOpen(true);
    setFormError("");
    setSuccessMessage("");
  };

  //   Universal Function again to update the changes that will be seen on our AdminFormEvent
  const handleChange = (field: string, value: string | number) => {
    setFormEvent((current) => ({ ...current, [field]: value }));
  };

  //   This is the main save changes function now this makes a required payload to be passed as json to our api and logically if an event is selected we update it using our put and if it is selected then user might just be asking to create an event
  const handleSave = async () => {
    if (
      !formEvent.name ||
      !formEvent.venue ||
      !formEvent.date ||
      !formEvent.imageUrl ||
      !formEvent.totalSeats
    ) {
      setFormError("Please fill out all event fields before saving.");
      return;
    }

    // An unpriced event cannot be sold: /api/payment/order rejects it, so the
    // seat map would look bookable and then refuse at checkout.
    if (!formEvent.price || Number(formEvent.price) <= 0) {
      setFormError("Set a ticket price before saving — an unpriced event cannot be booked.");
      return;
    }

    if (
      selectedEvent &&
      Number(formEvent.totalSeats) < selectedEvent.availableSeats
    ) {
      setFormError(
        `Total seats cannot be lower than current available seats (${selectedEvent.availableSeats}).`,
      );
      return;
    }

    setActionLoading(true);
    setPageError("");
    setFormError("");
    setSuccessMessage("");

    const payload = {
      name: String(formEvent.name),
      venue: String(formEvent.venue),
      imageUrl: String(formEvent.imageUrl),
      date: new Date(String(formEvent.date)).toISOString(),
      totalSeats: Number(formEvent.totalSeats),
      price: Number(formEvent.price), // already paise; the form converted it
    };

    try {
      if (selectedEvent) {
        await api.put(`/api/events/${selectedEvent.id}`, payload);
        setSuccessMessage("Event updated successfully.");
      } else {
        await api.post("/api/events", payload);
        setSuccessMessage("Event created successfully.");
      }

      await fetchEvents();
      setSelectedEvent(null);
      setFormEvent({});
      setIsFormOpen(false);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  //   Function to cancel or nullify our everything selected on to the form compoenent
  const handleCancel = () => {
    setSelectedEvent(null);
    setFormEvent({});
    setFormError("");
    setIsFormOpen(false);
  };

  const seatsOnSale = events.reduce((n, e) => n + e.availableSeats, 0);
  const lowStockCount = events.filter(
    (e) => e.availableSeats > 0 && e.availableSeats <= e.totalSeats * 0.1,
  ).length;
  const soldOutCount = events.filter((e) => e.availableSeats === 0).length;

  return (
    <AdminProtect>
      <div className="flex min-h-screen flex-col bg-background">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-8 pt-10 pb-14">
          <div className="mb-5 rounded-3xl border border-border bg-card p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-kicker uppercase text-primary">
                  Admin dashboard
                </p>
                <h1 className="mt-2.5">Manage events &amp; sessions</h1>
                <p className="mt-2.5 max-w-2xl text-base text-ink-300">
                  Preview event details, edit metadata, and prepare new shows
                  before publishing.
                </p>
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={actionLoading}
                className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 text-label font-semibold text-primary-foreground shadow-glow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" />
                New event
              </button>
            </div>

            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md bg-muted p-[18px]">
                <p className="text-kicker uppercase text-muted-foreground">
                  Total events
                </p>
                <p className="mt-2.5 font-mono text-metric text-ivory">
                  {events.length}
                </p>
              </div>
              <div className="rounded-md bg-muted p-[18px]">
                <p className="text-kicker uppercase text-muted-foreground">
                  Seats on sale
                </p>
                <p className="mt-2.5 font-mono text-metric text-ivory">
                  {seatsOnSale.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="rounded-md bg-muted p-[18px]">
                <p className="text-kicker uppercase text-muted-foreground">
                  Low stock
                </p>
                <p className="mt-2.5 font-mono text-metric text-primary">
                  {lowStockCount}
                </p>
              </div>
              <div className="rounded-md bg-muted p-[18px]">
                <p className="text-kicker uppercase text-muted-foreground">
                  Sold out
                </p>
                <p className="mt-2.5 font-mono text-metric text-destructive">
                  {soldOutCount}
                </p>
              </div>
            </div>
          </div>

          {/* This used to render with bg-secondary/10 text-secondary-foreground,
              and --secondary is a near-white grey, so a success message was
              indistinguishable from a neutral notice. --success was defined
              for exactly this and had never been used anywhere. */}
          {successMessage && (
            <div className="mb-7 flex items-center gap-3 rounded-md border border-success/28 bg-success/12 px-5 py-4">
              <Check className="size-[17px] shrink-0 text-success" />
              <p className="text-label text-success">{successMessage}</p>
            </div>
          )}

          {pageError && (
            <div className="mb-7 flex items-center gap-3 rounded-md border border-destructive/28 bg-destructive/12 px-5 py-4">
              <TriangleAlert className="size-[17px] shrink-0 text-destructive" />
              <p className="text-label text-destructive">{pageError}</p>
            </div>
          )}

          <section className="grid gap-8 xl:grid-cols-[1fr_400px]">
            <div>
              <label className="relative mb-5 block">
                <span className="sr-only">Search events</span>
                <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search events or venue"
                  className="h-11 w-full rounded-md border border-border bg-field pr-4 pl-10 text-label text-ink-100 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15"
                />
              </label>

              {loading ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-[18px]"
                    >
                      <div className="h-20 animate-pulse rounded-md bg-muted" />
                      <div className="h-4 w-2/3 animate-pulse rounded-sm bg-muted" />
                      <div className="h-3 w-4/5 animate-pulse rounded-sm bg-muted" />
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="h-13 animate-pulse rounded-md bg-muted" />
                        <div className="h-13 animate-pulse rounded-md bg-muted" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {filteredEvents.map((event) => (
                    <AdminEventCard
                      key={event.id}
                      event={event}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      isDeleting={deleteLoadingId === event.id}
                    />
                  ))}
                  {filteredEvents.length === 0 && (
                    <div className="rounded-xl border border-dashed border-ink-700 px-8 py-14 text-center xl:col-span-2">
                      <p className="font-semibold text-ivory">
                        No matching events
                      </p>
                      <p className="mx-auto mt-1.5 max-w-xs text-caption text-muted-foreground">
                        Try another search term, or create a new event to get
                        started.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sticky top-6">
              {isFormOpen ? (
                <>
                  {formError && (
                    <div className="mb-4 flex items-center gap-3 rounded-md border border-destructive/28 bg-destructive/12 px-4 py-3">
                      <TriangleAlert className="size-4 shrink-0 text-destructive" />
                      <p className="text-caption text-destructive">
                        {formError}
                      </p>
                    </div>
                  )}
                  <AdminEventForm
                    event={formEvent}
                    onChange={handleChange}
                    onSubmit={handleSave}
                    onCancel={handleCancel}
                    isSubmitting={actionLoading}
                  />
                </>
              ) : (
                <div className="rounded-xl border border-border bg-card p-6">
                  <p className="text-kicker uppercase text-muted-foreground">
                    Event editor
                  </p>
                  <h2 className="mt-2.5 text-title">Nothing selected</h2>
                  <p className="mt-1.5 text-caption text-muted-foreground">
                    Select an event to edit, or create a new one.
                  </p>

                  <div className="mt-5 rounded-md border border-dashed border-ink-700 p-5">
                    <p className="mb-4 text-kicker uppercase text-muted-foreground">
                      Quick actions
                    </p>
                    <ul className="flex flex-col gap-3.5">
                      <li className="flex items-start gap-2.5">
                        <Pencil className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span className="text-caption text-ink-300">
                          Click <strong className="text-ivory">Edit</strong> on
                          an existing event
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <Plus className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span className="text-caption text-ink-300">
                          Press <strong className="text-ivory">New event</strong>{" "}
                          to open the editor
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span className="text-caption text-ink-300">
                          Change date, venue, or seat count
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </AdminProtect>
  );
};

export default Admin;
