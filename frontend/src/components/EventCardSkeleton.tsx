/**
 * Mirrors EventCard's proportions — 16:9 band, title, venue line, footer rule —
 * so nothing shifts when the real content arrives. One shared pulse, not
 * per-element shimmer.
 */
const EventCardSkeleton = () => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="aspect-video w-full animate-pulse border-b border-border bg-muted" />
    <div className="flex flex-col gap-3 p-5">
      <div className="h-6 w-3/4 animate-pulse rounded-sm bg-muted" />
      <div className="h-4 w-1/2 animate-pulse rounded-sm bg-muted" />
      <div className="mt-3.5 flex items-center justify-between border-t border-border pt-3.5">
        <div className="h-4 w-32 animate-pulse rounded-sm bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded-sm bg-muted" />
      </div>
    </div>
  </div>
);

export default EventCardSkeleton;
