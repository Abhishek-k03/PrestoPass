"""Redis key names, TTLs, and Socket.IO room-name builders shared across the app."""

from __future__ import annotations


class RedisKeys:
    @staticmethod
    def seat_lock(event_id: int | str, seat_id: int | str) -> str:
        """String holding the lock owner's userId, with a TTL."""
        return f"seat_lock:{event_id}:{seat_id}"

    @staticmethod
    def waiting_queue(event_id: int | str) -> str:
        """Sorted set: member = userId, score = join timestamp in ms."""
        return f"waiting_queue:{event_id}"

    @staticmethod
    def active_users(event_id: int | str) -> str:
        """Set of users currently allowed to view the seat map."""
        return f"active_users:{event_id}"

    @staticmethod
    def event_seats(event_id: int | str) -> str:
        """Hash: field = seatId, value = ``"{seatNumber}:{STATUS}"``."""
        return f"event_seats:{event_id}"


REDIS_KEYS = RedisKeys

LOCK_TTL_SECONDS = 300  # 5 minutes
MAX_ACTIVE_USERS = 5  # users allowed past the waiting room at once
QUEUE_TTL_SECONDS = 86400  # 24 hours


# Socket.IO room names. Always built from an int so the API, the worker, and the
# client's join_seat_map("3") all land on the same room.
def room_user(user_id: int | str) -> str:
    return f"user:{user_id}"


def room_event_queue(event_id: int) -> str:
    return f"event_queue:{event_id}"


def room_seat_map(event_id: int) -> str:
    return f"seat_map:{event_id}"
