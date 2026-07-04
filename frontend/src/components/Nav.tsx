"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Ticket } from "lucide-react";
import { ROLE } from "../context/AuthContext";
import { useAuth } from "@/context/AuthContext";

const LINKS = [
  { href: "/home", label: "Home" },
  { href: "/events", label: "Events" },
  { href: "/bookings", label: "My Bookings" },
];

const Nav = () => {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/events") {
      return pathname === "/events" || pathname.startsWith("/events/");
    }
    return pathname === href;
  };

  return (
    <nav className="border-b border-border bg-background px-8">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6">
        <div className="flex items-center gap-7">
          <Link
            href="/events"
            className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ivory"
          >
            <Ticket className="size-[18px] text-primary" />
            PrestoPass
          </Link>

          <div className="flex items-center gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`inline-flex h-8 items-center rounded-md px-3 text-label transition ${
                  isActive(link.href)
                    ? "bg-muted text-ivory"
                    : "text-muted-foreground hover:text-ink-300"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user?.role === ROLE.ADMIN && (
            <Link
              href="/admin"
              className={`inline-flex h-8 items-center rounded-md border px-3 text-label transition ${
                isActive("/admin")
                  ? "border-success/35 bg-success/10 text-success"
                  : "border-border text-ink-300 hover:border-ink-700"
              }`}
            >
              Edit events
            </Link>
          )}

          <span className="text-caption text-muted-foreground">{user?.name}</span>

          <button
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-ink-700 hover:text-ink-100"
          >
            <LogOut className="size-[15px]" />
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Nav;
