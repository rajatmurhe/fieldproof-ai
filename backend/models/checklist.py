from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class Checklist(Base):
    __tablename__ = "checklists"
    __table_args__ = (
        Index(
            "ix_checklists_org_job_type",
            "organization_id",
            "job_type",
            unique=True,
        ),
    )

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

    job_type = Column(
        String(100),
        nullable=False,
    )

    checks = Column(
        JSON,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    organization = relationship(
        "Organization",
        back_populates="checklists",
    )
