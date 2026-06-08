from __future__ import annotations

from datetime import datetime

from sqlalchemy import Identity, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TS3, Base, RoleEnum


class User(Base):
    __tablename__ = "User"
    # These are unique indexes in the database, not constraints. Modelling them
    # as indexes keeps the mapper an exact description of the physical schema.
    __table_args__ = (
        Index("User_email_key", "email", unique=True),
        Index("User_googleId_key", "googleId", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    # Nullable since the Google-auth migration -- OAuth users have no password.
    passwordHash: Mapped[str | None] = mapped_column(Text, nullable=True)
    googleId: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar: Mapped[str | None] = mapped_column(Text, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(
        TS3, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    role: Mapped[str] = mapped_column(RoleEnum, nullable=False, server_default=text("'CUSTOMER'"))
