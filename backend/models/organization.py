from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    name = Column(
        String(150),
        nullable=False,
    )

    slug = Column(
        String(100),
        unique=True,
        nullable=False,
        index=True,
    )

    clerk_org_id = Column(
        String(255),
        unique=True,
        nullable=True,
        index=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    jobs = relationship(
        "Job",
        back_populates="organization",
    )

    users = relationship(
        "User",
        back_populates="organization",
    )

    checklists = relationship(
        "Checklist",
        back_populates="organization",
    )
