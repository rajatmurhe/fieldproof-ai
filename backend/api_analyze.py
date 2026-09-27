"""
FieldProof AI — Analysis Queue API

Queues a job for background Gemini video analysis.

The actual analysis is performed by the background worker (worker.py).
This endpoint is idempotent: if a job is already QUEUED or PROCESSING,
it returns immediately without creating a duplicate queue entry.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.auth import get_current_user
from backend.database.connection import get_db
from backend.models.analysis_job import AnalysisJob
from backend.models.audit_log import AuditLog
from backend.models.job import Job
from backend.models.user import User

logger = logging.getLogger("fieldproof.api.analyze")

router = APIRouter(
    prefix="/analyze",
    tags=["Analysis"],
)

UPLOAD_DIR = Path("uploads")


class AnalyzeRequest(BaseModel):
    job_id: str


@router.post("/")
def queue_analysis(
    request: AnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Queue a job for AI video analysis.

    Returns immediately — analysis runs in the background.
    Poll GET /jobs/{job_id} to check status.
    """
    job = (
        db.query(Job)
        .filter(
            Job.job_id == request.job_id,
            Job.organization_id == current_user.organization_id,
        )
        .first()
    )

    if not job:
        raise HTTPException(
            status_code=404,
            detail=f"Job not found: {request.job_id}",
        )

    # Idempotency: already in the queue or actively processing
    queue_job = (
        db.query(AnalysisJob)
        .filter(AnalysisJob.job_id == job.id)
        .first()
    )

    if queue_job and queue_job.status in {"QUEUED", "PROCESSING"}:
        logger.info(
            "Analysis already in progress: job=%s queue_status=%s",
            job.job_id,
            queue_job.status,
        )
        return {
            "job_id": job.job_id,
            "queue_status": queue_job.status,
            "message": "Analysis is already in progress.",
        }

    # Verify the video file is present before queuing
    video_path = UPLOAD_DIR / Path(job.video_filename).name

    if not video_path.exists():
        raise HTTPException(
            status_code=400,
            detail=(
                "Video file not found. "
                "Please upload the video before requesting analysis."
            ),
        )

    if queue_job is None:
        queue_job = AnalysisJob(
            job_id=job.id,
            status="QUEUED",
            attempts=0,
            error_message=None,
        )
        db.add(queue_job)
    else:
        # Re-queuing a previously completed/failed job
        queue_job.status = "QUEUED"
        queue_job.attempts = 0
        queue_job.started_at = None
        queue_job.completed_at = None
        queue_job.error_message = None

    previous_status = job.status
    job.status = "QUEUED"

    # Audit the analysis request
    db.add(
        AuditLog(
            organization_id=current_user.organization_id,
            job_id=job.id,
            user_id=current_user.id,
            action="ANALYSIS_QUEUED",
            from_status=previous_status,
            to_status="QUEUED",
            details={
                "requested_by": current_user.name,
                "requested_by_email": current_user.email,
            },
        )
    )

    db.commit()
    db.refresh(queue_job)

    logger.info(
        "Analysis queued: job=%s org=%d by=%s",
        job.job_id,
        current_user.organization_id,
        current_user.email,
    )

    return {
        "job_id": job.job_id,
        "queue_status": "QUEUED",
        "message": (
            "Analysis queued successfully. "
            "The background worker will process this job shortly. "
            "Poll GET /jobs/{job_id} to check progress."
        ),
    }
