"""Dual-stack entrypoint.

    uv run python run.py [--reload]

Why this exists instead of a plain ``uvicorn`` command:

On Windows, ``localhost`` resolves to ``::1`` (IPv6) *before* ``127.0.0.1``.
``--host 0.0.0.0`` listens on IPv4 only, so a client that tries IPv6 first stalls
for ~2s on every single request before falling back -- and the frontend talks to
``http://localhost:5000``. ``--host ::`` has the mirror-image problem, because
Windows defaults ``IPV6_V6ONLY`` to true, so plain IPv4 clients cannot connect
at all.

Creating the socket here lets us clear ``IPV6_V6ONLY`` and accept both families
on one listener.
"""

from __future__ import annotations

import argparse
import socket
import sys

import uvicorn

from app.config import settings

APP_PATH = "app.main:asgi_app"


def make_dual_stack_socket(host: str, port: int) -> socket.socket:
    """A listening socket that serves IPv4 and IPv6 clients alike."""
    try:
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        # 0 = accept IPv4-mapped addresses too. Windows defaults this to 1.
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    except (AttributeError, OSError):
        # No usable IPv6 on this machine -- fall back to IPv4-only.
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", port))
        sock.listen(2048)
        sock.set_inheritable(True)
        return sock

    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    sock.listen(2048)
    sock.set_inheritable(True)
    return sock


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the PrestoPass API.")
    parser.add_argument("--host", default="::", help="bind address (default: ::)")
    parser.add_argument("--port", type=int, default=settings.PORT)
    parser.add_argument("--reload", action="store_true", help="auto-reload on edits")
    args = parser.parse_args()

    sock = make_dual_stack_socket(args.host, args.port)
    config = uvicorn.Config(APP_PATH, log_level="info", reload=args.reload)
    server = uvicorn.Server(config)

    print(f"Listening on http://localhost:{args.port} (IPv4 + IPv6)")

    if args.reload:
        # The same path uvicorn's own CLI uses to combine --reload with a
        # pre-created socket.
        from uvicorn.supervisors import ChangeReload

        ChangeReload(config, target=server.run, sockets=[sock]).run()
    else:
        server.run(sockets=[sock])
    return 0


if __name__ == "__main__":
    sys.exit(main())
