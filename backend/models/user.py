from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class User(Base):
    __tablename__ = "users"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    organization_id = Column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
    )

    name = Column(
        String(150),
        nullable=False,
    )

    email = Column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )

    clerk_user_id = Column(
        String(255),
        unique=True,
        nullable=True,
        index=True,
    )

    role = Column(
        String(30),
        nullable=False,
        default="REVIEWER",
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    organization = relationship(
        "Organization",
        back_populates="users",
    )
