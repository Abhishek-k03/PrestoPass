"""Importing this package registers every mapper (Alembic and the app rely on it)."""

from app.models.base import Base
from app.models.booking import Booking
from app.models.event import Event
from app.models.seat import Seat
from app.models.user import User

__all__ = ["Base", "Booking", "Event", "Seat", "User"]
