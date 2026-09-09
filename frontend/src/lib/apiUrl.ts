// Single source of truth for the backend origin, shared by the axios client and
// the socket.io client.
//
// NEXT_PUBLIC_* values are inlined at build time, so this must stay a static
// reference to process.env.NEXT_PUBLIC_API_URL -- not a dynamic lookup.
//
// This runs in the visitor's browser, so the value must be a public origin. Do
// not wire it to Render's `fromService: property: host`, which resolves to the
// private-network hostname; the scheme fallback below would turn that into a
// plausible-looking https:// URL that no browser can resolve.

const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "http://localhost:5000";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const API_BASE_URL = normalizeOrigin(RAW_API_URL);
