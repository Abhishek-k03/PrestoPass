from __future__ import annotations

from functools import cached_property
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Managed Postgres providers (Render, Heroku, Neon, Supabase) hand out libpq-style
# URLs. asyncpg rejects every one of these query params, and the "postgres://" /
# "postgresql://" scheme picks the sync psycopg driver instead of asyncpg.
_DROPPED_URL_PARAMS = frozenset({"channel_binding", "schema", "connection_limit", "pgbouncer"})
_SSLMODE_TO_ASYNCPG = {
    "require": "require",
    "verify-ca": "require",
    "verify-full": "require",
    "prefer": "prefer",
    # "disable" and "allow" map to no param at all -- asyncpg's own default.
}


def normalize_database_url(url: str) -> str:
    """Rewrite a provider-issued Postgres URL into one asyncpg accepts.

    Idempotent: a URL that is already ``postgresql+asyncpg://`` with clean params
    comes back unchanged, so this is safe to apply to a hand-written local URL.
    """
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    elif not scheme.startswith("postgresql+"):
        # Not a Postgres URL (sqlite in tests, say) -- leave it entirely alone.
        return url

    kept: list[tuple[str, str]] = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        low = key.lower()
        if low in _DROPPED_URL_PARAMS:
            continue
        if low == "sslmode":
            translated = _SSLMODE_TO_ASYNCPG.get(value.lower())
            if translated:
                kept.append(("ssl", translated))
            continue
        kept.append((key, value))

    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))


def _with_scheme(origin: str) -> str:
    """A bare hostname becomes an https origin; anything explicit is left as-is.

    Render's ``fromService: property: host`` yields a hostname with no scheme, and
    a CORS allow-list entry without a scheme never matches an Origin header.
    """
    origin = origin.strip().rstrip("/")
    if not origin or "://" in origin:
        return origin
    return f"https://{origin}"


_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})


def _is_loopback(origin: str) -> bool:
    return (urlsplit(origin).hostname or "").lower() in _LOOPBACK_HOSTS


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    PORT: int = 5000

    DATABASE_URL: str = "postgresql+asyncpg://ticket:ticket@localhost:5433/ticket_booking_platform"
    REDIS_URL: str = "redis://localhost:6379/0"

    # Sized for a generous local Postgres. Managed free tiers cap total connections
    # far lower (Render's free plan allows ~97), and the API and the payment worker
    # each open their own pool -- so both are overridable per environment.
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 20
    WORKER_DB_POOL_SIZE: int = 10
    WORKER_DB_MAX_OVERFLOW: int = 10

    JWT_SECRET: str = "dev-jwt-secret-change-me-in-production-0123456789"
    JWT_EXPIRES_DAYS: int = 7
    SESSION_SECRET: str = "dev-session-secret-change-me-in-production-0123456789"

    FRONTEND_URL: str = "http://localhost:4000"
    FRONTEND_URL_ALT: str = "http://localhost:3000"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_CALLBACK_URL: str = "http://localhost:5000/api/auth/google/callback"

    # ---- payments ----
    # "mock" keeps the app runnable with no keys, offline, and drivable by
    # Playwright (Razorpay's checkout is a cross-origin iframe). "razorpay"
    # switches to real test-mode checkout with a UPI tab and cards.
    PAYMENT_PROVIDER: str = "mock"
    PAYMENT_CURRENCY: str = "INR"
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    # Set separately in the Razorpay dashboard; it is NOT the key secret.
    RAZORPAY_WEBHOOK_SECRET: str = ""

    NODE_ENV: str = "development"
    SOCKETIO_CHANNEL: str = "socketio"

    # Behind a reverse proxy (Render, nginx, Fly) uvicorn must be told to trust
    # X-Forwarded-Proto, or every request looks like plain http to the app and
    # the OAuth callback redirects to the wrong scheme. Uvicorn's default only
    # trusts 127.0.0.1, which is never the proxy's address on a PaaS.
    FORWARDED_ALLOW_IPS: str = "127.0.0.1"

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_db_url(cls, value: str) -> str:
        return normalize_database_url(value)

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"

    @property
    def google_enabled(self) -> bool:
        return bool(self.GOOGLE_CLIENT_ID and self.GOOGLE_CLIENT_SECRET)

    @property
    def razorpay_enabled(self) -> bool:
        return bool(self.RAZORPAY_KEY_ID and self.RAZORPAY_KEY_SECRET)

    @cached_property
    def cors_origins(self) -> list[str]:
        """Configured origins, normalised to full origins with a scheme.

        Production drops every loopback origin, including the localhost default
        of FRONTEND_URL_ALT -- allowing them against a deployed API widens the
        allow-list for no benefit.
        """
        candidates = [self.FRONTEND_URL, self.FRONTEND_URL_ALT]
        if not self.is_production:
            candidates += ["http://localhost:3000", "http://localhost:4000"]

        origins = {o for o in (_with_scheme(c) for c in candidates) if o}
        if self.is_production:
            origins = {o for o in origins if not _is_loopback(o)}
        return sorted(origins)


settings = Settings()
