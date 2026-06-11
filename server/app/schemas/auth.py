from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class RegisterIn(BaseModel):
    # Every field optional, so a missing one produces our own 400 message
    # rather than FastAPI's 422 validation body.
    model_config = ConfigDict(extra="ignore")

    name: str | None = None
    email: str | None = None
    password: str | None = None


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: str | None = None
    password: str | None = None
