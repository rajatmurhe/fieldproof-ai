"""
FieldProof AI — Secure Video Streaming Endpoint

Serves video files to authenticated users who own the associated job.

Security:
  - Organization scoping: video is only served if the job belongs to the
    authenticated user's organization.
  - Filename sanitization: Path().name is used to strip any directory
    components, preventing path traversal attacks.
  - File existence check: returns 404 if the file is missing on disk.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.auth import get_current_user
from backend.database.connection import get_db
from backend.models.job import Job
from backend.models.user import User

logger = logging.getLogger("fieldproof.api.videos")

router = APIRouter(prefix="/videos", tags=["Videos"])

UPLOAD_DIR = Path("uploads")

MEDIA_TYPES: dict[str, str] = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
}


@router.get("/{filename}")
def get_video(
    filename: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Stream a video file for an authenticated user.

    Only serves videos that belong to a job in the current user's organization.
    """
    # Sanitize filename — strip any directory components
    safe_filename = Path(filename).name

    if not safe_filename or safe_filename != filename:
        # If stripping changed the value, the caller sent a path traversal
        raise HTTPException(status_code=400, detail="Invalid filename.")

    # Verify ownership via the jobs table
    job = (
        db.query(Job)
        .filter(
            # Match on the base filename so the query works regardless of
            # whether video_filename was stored with or without a directory prefix.
            Job.organization_id == current_user.organization_id,
        )
        .filter(
            Job.video_filename.like(f"%{safe_filename}"),
        )
        .order_by(Job.created_at.desc())
        .first()
    )

    if not job:
        raise HTTPException(status_code=404, detail="Video not found.")

    video_path = UPLOAD_DIR / safe_filename

    if not video_path.exists():
        logger.warning(
            "Video file missing on disk: %s (job=%s org=%d)",
            safe_filename,
            job.job_id,
            current_user.organization_id,
        )
        raise HTTPException(
            status_code=404,
            detail="Video file is not available on this server.",
        )

    extension = video_path.suffix.lower()
    media_type = MEDIA_TYPES.get(extension, "application/octet-stream")

    logger.info(
        "Serving video: %s (job=%s org=%d to=%s)",
        safe_filename,
        job.job_id,
        current_user.organization_id,
        current_user.email,
    )

    return FileResponse(
        path=video_path,
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{safe_filename}"',
            "Cache-Control": "private, no-store",
        },
    )
