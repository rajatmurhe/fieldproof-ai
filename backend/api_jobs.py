import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.auth import get_current_user
from backend.database.connection import get_db
from backend.models.analysis_job import AnalysisJob
from backend.models.audit_log import AuditLog
from backend.models.job import Job
from backend.models.user import User

logger = logging.getLogger("fieldproof.api.jobs")

router = APIRouter(
    prefix="/jobs",
    tags=["Jobs"],
)

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


from pydantic import BaseModel, ConfigDict


class JobCreate(BaseModel):
    job_id: str
    job_type: str
    video_filename: str


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: str
    job_type: str
    video_filename: str
    status: str
    organization_id: int
    created_at: datetime | None = None


class ReviewDecision(BaseModel):
    decision: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return aggregate job counts for the dashboard.
    Efficient single-query aggregation, avoids loading all rows.
    """
    org_id = current_user.organization_id

    rows = (
        db.query(Job.status, func.count(Job.id))
        .filter(Job.organization_id == org_id)
        .group_by(Job.status)
        .all()
    )

    counts: dict[str, int] = {}
    total = 0

    for status, count in rows:
        counts[status] = count
        total += count

    return {
        "total": total,
        "pending": counts.get("PENDING", 0),
        "queued": counts.get("QUEUED", 0),
        "analyzing": counts.get("ANALYZING", 0),
        "review": counts.get("REVIEW", 0),
        "pass": counts.get("PASS", 0),
        "approved": counts.get("APPROVED", 0),
        "rejected": counts.get("REJECTED", 0),
        "failed": counts.get("FAILED", 0),
    }


@router.post("/", response_model=JobResponse)
def create_job(
    job_data: JobCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    organization_id = current_user.organization_id

    # Validate job_id is not empty
    job_id = job_data.job_id.strip()
    if not job_id:
        raise HTTPException(status_code=400, detail="Job ID cannot be empty.")

    if len(job_id) > 50:
        raise HTTPException(
            status_code=400, detail="Job ID must be 50 characters or less."
        )

    job_type = job_data.job_type.strip().lower()
    if not job_type:
        raise HTTPException(status_code=400, detail="Job type cannot be empty.")

    existing_job = (
        db.query(Job)
        .filter(
            Job.job_id == job_id,
            Job.organization_id == organization_id,
        )
        .first()
    )

    if existing_job:
        logger.info(
            "Returning existing job: %s (org=%d)", job_id, organization_id
        )
        return existing_job

    job = Job(
        job_id=job_id,
        organization_id=organization_id,
        job_type=job_type,
        video_filename=job_data.video_filename,
        status="PENDING",
    )

    db.add(job)
    db.flush()

    audit = AuditLog(
        organization_id=current_user.organization_id,
        job_id=job.id,
        user_id=current_user.id,
        action="JOB_CREATED",
        from_status=None,
        to_status="PENDING",
        details={
            "job_type": job.job_type,
            "video_filename": job.video_filename,
            "created_by": current_user.name,
            "created_by_email": current_user.email,
        },
    )

    db.add(audit)
    db.commit()
    db.refresh(job)

    logger.info(
        "Job created: %s type=%s org=%d by=%s",
        job.job_id,
        job.job_type,
        organization_id,
        current_user.email,
    )

    return job


@router.get("/", response_model=list[JobResponse])
def list_jobs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Job)
        .filter(Job.organization_id == current_user.organization_id)
        .order_by(Job.created_at.desc())
        .all()
    )


@router.get("/{job_id}")
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = (
        db.query(Job)
        .filter(
            Job.job_id == job_id,
            Job.organization_id == current_user.organization_id,
        )
        .first()
    )

    if not job:
        raise HTTPException(
            status_code=404,
            detail=f"Job not found: {job_id}",
        )

    result = None

    if job.result_record:
        result = {
            "overall_status": job.result_record.overall_status,
            "model_name": job.result_record.model_name,
            "analyzed_at": (
                job.result_record.created_at.isoformat()
                if job.result_record.created_at
                else None
            ),
            "checks": [
                {
                    "check": finding.check,
                    "status": finding.status,
                    "confidence": finding.confidence,
                    "evidence_timestamp": finding.evidence_timestamp,
                    "reason": finding.reason,
                    "check_order": finding.check_order,
                }
                for finding in job.result_record.findings
            ],
        }

    # Also fetch queue status for in-progress visibility
    queue_entry = (
        db.query(AnalysisJob)
        .filter(AnalysisJob.job_id == job.id)
        .first()
    )

    queue_info = None
    if queue_entry:
        queue_info = {
            "queue_status": queue_entry.status,
            "attempts": queue_entry.attempts,
            "started_at": (
                queue_entry.started_at.isoformat()
                if queue_entry.started_at
                else None
            ),
            "completed_at": (
                queue_entry.completed_at.isoformat()
                if queue_entry.completed_at
                else None
            ),
            "error_message": queue_entry.error_message,
        }

    audit_logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.job_id == job.id,
            AuditLog.organization_id == current_user.organization_id,
        )
        .order_by(AuditLog.created_at.desc())
        .all()
    )

    audit_history = [
        {
            "id": audit.id,
            "action": audit.action,
            "from_status": audit.from_status,
            "to_status": audit.to_status,
            "details": audit.details,
            "user_name": audit.user.name if audit.user else None,
            "user_email": audit.user.email if audit.user else None,
            "created_at": (
                audit.created_at.isoformat() if audit.created_at else None
            ),
        }
        for audit in audit_logs
    ]

    return {
        "id": job.id,
        "job_id": job.job_id,
        "job_type": job.job_type,
        "video_filename": job.video_filename,
        "status": job.status,
        "organization_id": job.organization_id,
        "review_decision": job.review_decision,
        "reviewed_at": (
            job.reviewed_at.isoformat() if job.reviewed_at else None
        ),
        "created_at": (
            job.created_at.isoformat() if job.created_at else None
        ),
        "result": result,
        "queue": queue_info,
        "audit_history": audit_history,
    }


@router.post("/{job_id}/review")
def review_job(
    job_id: str,
    decision_data: ReviewDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    decision = decision_data.decision.upper().strip()

    if decision not in {"APPROVED", "REJECTED"}:
        raise HTTPException(
            status_code=400,
            detail="Decision must be APPROVED or REJECTED.",
        )

    job = (
        db.query(Job)
        .filter(
            Job.job_id == job_id,
            Job.organization_id == current_user.organization_id,
        )
        .first()
    )

    if not job:
        raise HTTPException(
            status_code=404,
            detail=f"Job not found: {job_id}",
        )

    if job.status != "REVIEW":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only jobs with status REVIEW can be reviewed. "
                f"This job is currently {job.status!r}."
            ),
        )

    previous_status = job.status

    job.review_decision = decision
    job.reviewed_at = datetime.utcnow()
    job.status = decision  # APPROVED or REJECTED

    audit = AuditLog(
        organization_id=current_user.organization_id,
        job_id=job.id,
        user_id=current_user.id,
        action="HUMAN_REVIEW",
        from_status=previous_status,
        to_status=job.status,
        details={
            "decision": decision,
            "reviewer_name": current_user.name,
            "reviewer_email": current_user.email,
            "reviewer_role": current_user.role,
        },
    )

    db.add(audit)
    db.commit()
    db.refresh(job)

    logger.info(
        "Job reviewed: %s decision=%s by=%s",
        job.job_id,
        decision,
        current_user.email,
    )

    return {
        "job_id": job.job_id,
        "status": job.status,
        "review_decision": job.review_decision,
        "reviewed_at": (
            job.reviewed_at.isoformat() if job.reviewed_at else None
        ),
        "reviewed_by": current_user.name,
    }
