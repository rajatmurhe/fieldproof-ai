from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class JobResult(Base):
    __tablename__ = "job_results"

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

    overall_status = Column(
        String(30),
        nullable=False,
    )

    model_name = Column(
        String(100),
        nullable=True,
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

    job = relationship(
        "Job",
        back_populates="result_record",
    )

    findings = relationship(
        "JobFinding",
        back_populates="job_result",
        cascade="all, delete-orphan",
        order_by="JobFinding.check_order",
    )
