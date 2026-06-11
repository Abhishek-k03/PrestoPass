"""Safe integer parsing for path and query parameters."""

from __future__ import annotations


def get_integer_id(v: str | int | None) -> int | None:
    """Parse a path/param id, or ``None`` if it isn't one."""
    if v is None:
        return None
    if isinstance(v, int):
        return v
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None
