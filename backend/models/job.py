from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class Job(Base):

    __table_args__ = (
        Index(
            "ix_jobs_organization_job_id",
            "organization_id",
            "job_id",
            unique=True,
        ),
    )
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)

    job_id = Column(
        String(50),
        unique=False,
        nullable=False,
        index=False,
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

    video_filename = Column(
        String(255),
        nullable=False,
    )

    status = Column(
        String(30),
        nullable=False,
        default="PENDING",
    )

    review_decision = Column(
        String(30),
        nullable=True,
    )

    reviewed_at = Column(
        DateTime,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    organization = relationship(
        "Organization",
        back_populates="jobs",
    )

    result_record = relationship(
        "JobResult",
        back_populates="job",
        uselist=False,
        cascade="all, delete-orphan",
    )
