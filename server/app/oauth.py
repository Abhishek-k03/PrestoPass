"""Google OAuth client (Authlib). Replaces passport-google-oauth20."""

from __future__ import annotations

from authlib.integrations.starlette_client import OAuth

from app.config import settings

oauth = OAuth()

if settings.google_enabled:
    oauth.register(
        name="google",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        server_metadata_url=("https://accounts.google.com/.well-known/openid-configuration"),
        client_kwargs={"scope": "openid email profile"},
    )
