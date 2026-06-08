from __future__ import annotations

from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


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
        """Configured origins plus the two known dev ports, with trailing slashes stripped."""
        candidates = (
            self.FRONTEND_URL,
            self.FRONTEND_URL_ALT,
            "http://localhost:3000",
            "http://localhost:4000",
        )
        return sorted({o.rstrip("/") for o in candidates if o})


settings = Settings()
