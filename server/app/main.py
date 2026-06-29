from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app import realtime
from app.config import settings
from app.db import engine
from app.errors import (
    ApiError,
    api_error_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from app.redis_client import clear_existing_queues, redis_client
from app.routers import auth, bookings, events, health, payment, seats
from app.socket_server import sio
from app.tasks.broker import broker

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
log = logging.getLogger(__name__)

# Importing the task module registers "processPaymentJob" so .kiq() can resolve it.
import app.tasks.payment  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Force the Redis pub/sub SUBSCRIBE loop up now. python-socketio starts it
    # lazily on the first browser connection, so without this a payment that
    # finishes before anyone opens a tab publishes into a channel with no
    # subscribers -- and Redis pub/sub does not buffer, so the event is lost.
    if not getattr(sio, "manager_initialized", False):
        sio.manager_initialized = True
        sio.manager.initialize()
    realtime.set_emitter(sio)

    await redis_client.ping()
    # API-only: doing this in the worker would wipe live queues on every restart.
    await clear_existing_queues(redis_client)

    if not broker.is_worker_process:
        await broker.startup()

    log.info("API ready on port %s (CORS: %s)", settings.PORT, settings.cors_origins)
    yield

    if not broker.is_worker_process:
        await broker.shutdown()
    realtime.set_emitter(None)
    await redis_client.aclose()
    await engine.dispose()


app = FastAPI(
    title="PrestoPass API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

# A 307 to add a trailing slash drops the Authorization header on a cross-origin
# request in some browsers, so exact paths only.
app.router.redirect_slashes = False

# Holds Authlib's OAuth state; same_site="lax" so the cookie survives Google's
# top-level redirect back.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_SECRET,
    same_site="lax",
    https_only=settings.is_production,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Starlette matches on type(exc).__mro__, so ApiError wins over the generic
# HTTPException handler automatically.
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

app.include_router(health.router)  # /health is at the root, not under /api
app.include_router(auth.router, prefix="/api/auth")
app.include_router(events.router, prefix="/api/events")
app.include_router(seats.router, prefix="/api/seats")
app.include_router(bookings.router, prefix="/api/bookings")
app.include_router(payment.router, prefix="/api/payment")

# Routes /socket.io/* to Engine.IO and everything else to FastAPI, on one port.
# on_startup/on_shutdown are deliberately not passed: supplying either stops the
# lifespan scope being delegated to FastAPI.
asgi_app = socketio.ASGIApp(sio, other_asgi_app=app)
