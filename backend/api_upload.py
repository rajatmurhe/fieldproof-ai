"""
FieldProof AI — Video Upload API

Accepts authenticated video uploads for existing jobs.

Security:
  - Organization scoping: only jobs belonging to the current org accepted
  - Server-generated storage keys: the client filename is display-only and
    never decides where the file is written (see services/storage.py)
  - Extension allowlist: only video formats accepted
  - File size limit: MAX_FILE_SIZE_MB enforced
  - Filename match: uploaded file must match the job's registered filename
"""

import logging
import os
import tempfile
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from sqlalchemy.orm import Session

from backend.auth import get_current_user
from backend.database.connection import get_db
from backend.models.job import Job
from backend.models.user import User
from backend.services.storage import build_storage_key, get_storage

logger = logging.getLogger("fieldproof.api.upload")

router = APIRouter(prefix="/upload", tags=["Upload"])

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}

# Maximum allowed upload size in megabytes
MAX_FILE_SIZE_MB = 500
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024


@router.post("/")
async def upload_video(
    request: Request,
    job_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected.")

    # Strip directory components — prevent any path traversal
    safe_filename = Path(file.filename).name

    if not safe_filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    extension = Path(safe_filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported video format '{extension}'. "
                f"Accepted formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
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

    # Uploaded filename must match what was registered with the job
    expected_filename = Path(job.video_filename).name
    if safe_filename != expected_filename:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Uploaded filename '{safe_filename}' does not match "
                f"the expected filename '{expected_filename}' for this job."
            ),
        )

    if job.status in {"QUEUED", "ANALYZING"}:
        raise HTTPException(
            status_code=409,
            detail="This job is being analyzed. Wait for it to finish before replacing the video.",
        )

    handle, temp_name = tempfile.mkstemp(suffix=extension)
    temp_path = Path(temp_name)

    bytes_written = 0
    chunk_size = 1024 * 1024  # 1 MB chunks

    try:
        with os.fdopen(handle, "wb") as buffer:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break

                bytes_written += len(chunk)

                if bytes_written > MAX_FILE_SIZE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"File too large. Maximum allowed size is "
                            f"{MAX_FILE_SIZE_MB} MB."
                        ),
                    )

                buffer.write(chunk)

        storage = get_storage()
        storage_key = build_storage_key(
            current_user.organization_id,
            job.id,
            extension,
        )
        storage.put_file(storage_key, temp_path)

    except HTTPException:
        temp_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        logger.exception("Upload failed for job %s: %s", job_id, exc)
        raise HTTPException(
            status_code=500,
            detail="File upload failed due to a server error.",
        ) from exc

    previous_key = job.storage_key
    job.storage_key = storage_key
    db.commit()

    # Replace semantics: a re-upload supersedes the previous video.
    if previous_key and previous_key != storage_key:
        try:
            storage.delete(previous_key)
        except Exception:
            logger.warning("Could not delete superseded video %s", previous_key)

    size_mb = bytes_written / (1024 * 1024)

    logger.info(
        "Video uploaded: job=%s file=%s size=%.1fMB org=%d by=%s",
        job_id,
        safe_filename,
        size_mb,
        current_user.organization_id,
        current_user.email,
    )

    return {
        "filename": safe_filename,
        "size_bytes": bytes_written,
        "size_mb": round(size_mb, 2),
        "status": "uploaded",
        "job_id": job.job_id,
        "organization_id": current_user.organization_id,
    }
