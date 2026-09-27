from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

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

    job_id = Column(
        Integer,
        ForeignKey("jobs.id"),
        nullable=False,
        index=True,
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )

    action = Column(
        String(100),
        nullable=False,
    )

    from_status = Column(
        String(30),
        nullable=True,
    )

    to_status = Column(
        String(30),
        nullable=True,
    )

    details = Column(
        JSON,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    organization = relationship(
        "Organization",
    )

    job = relationship(
        "Job",
    )

    user = relationship(
        "User",
    )
