"""Natural sort matching JS ``a.localeCompare(b, undefined, {numeric: true})``.

The seat map must read A1, A2, ..., A9, A10, A11 -- not A1, A10, A11, A2.
"""

from __future__ import annotations

import re

_CHUNK = re.compile(r"(\d+)")


def natural_key(s: str) -> list[tuple[int, int, str]]:
    """Sort key for seat numbers.

    Every element is the *same shape* -- ``(kind, number, text)`` -- because a
    plain "int chunk or str chunk" list raises ``TypeError: '<' not supported
    between 'int' and 'str'`` the moment two values differ in shape ("1A" vs
    "A1"). ``kind`` 0 (digits) sorts before 1 (letters), matching ICU; letters
    compare case-insensitively.
    """
    out: list[tuple[int, int, str]] = []
    for part in _CHUNK.split(s):
        if not part:
            continue
        if part.isdigit():
            out.append((0, int(part), ""))
        else:
            out.append((1, 0, part.casefold()))
    return out
