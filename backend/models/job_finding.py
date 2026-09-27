from sqlalchemy import Column, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class JobFinding(Base):
    __tablename__ = "job_findings"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    job_result_id = Column(
        Integer,
        ForeignKey("job_results.id"),
        nullable=False,
        index=True,
    )

    check_order = Column(
        Integer,
        nullable=False,
    )

    check = Column(
        String(500),
        nullable=False,
    )

    status = Column(
        String(30),
        nullable=False,
    )

    confidence = Column(
        Float,
        nullable=False,
    )

    evidence_timestamp = Column(
        String(50),
        nullable=True,
    )

    reason = Column(
        Text,
        nullable=False,
    )

    job_result = relationship(
        "JobResult",
        back_populates="findings",
    )
