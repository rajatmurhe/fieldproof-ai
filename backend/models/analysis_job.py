from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    job_id = Column(
        Integer,
        ForeignKey("jobs.id"),
        unique=True,
        nullable=False,
        index=True,
    )

    status = Column(
        String(30),
        nullable=False,
        default="QUEUED",
        index=True,
    )

    attempts = Column(
        Integer,
        nullable=False,
        default=0,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    started_at = Column(
        DateTime,
        nullable=True,
    )

    completed_at = Column(
        DateTime,
        nullable=True,
    )

    error_message = Column(
        Text,
        nullable=True,
    )

    job = relationship(
        "Job",
    )
