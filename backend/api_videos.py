"""
FieldProof AI — Secure Video Streaming Endpoint

Serves a job's video to authenticated users in the job's organization.

Security:
  - Videos are addressed by job, never by filename: the job is looked up
    within the caller's organization, and its server-generated storage key
    decides which file is served. Another tenant's job (or a reused
    filename) can therefore never resolve to this tenant's video.
  - Range requests are supported for local storage so the player can seek.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.auth import get_current_user
from backend.database.connection import get_db
from backend.models.job import Job
from backend.models.user import User
from backend.services.storage import get_storage

logger = logging.getLogger("fieldproof.api.videos")

router = APIRouter(tags=["Videos"])


@router.get("/jobs/{job_id}/video")
def get_job_video(
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

    if not job or not job.storage_key:
        raise HTTPException(status_code=404, detail="Video not found.")

    logger.info(
        "Serving video: job=%s org=%d to=%s",
        job.job_id,
        current_user.organization_id,
        current_user.email,
    )

    display_name = Path(job.video_filename).name.replace('"', "")

    return get_storage().response(job.storage_key, display_name)
