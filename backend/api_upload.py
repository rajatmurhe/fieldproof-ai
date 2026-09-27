"""
FieldProof AI — Video Upload API

Accepts authenticated video uploads for existing jobs.

Security:
  - Organization scoping: only jobs belonging to the current org accepted
  - Filename sanitization: Path(filename).name strips any directory component
  - Extension allowlist: only video formats accepted
  - File size limit: MAX_FILE_SIZE_MB enforced
  - Filename match: uploaded file must match the job's registered filename
"""

import logging
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

logger = logging.getLogger("fieldproof.api.upload")

router = APIRouter(prefix="/upload", tags=["Upload"])

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

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

    destination = UPLOAD_DIR / safe_filename

    bytes_written = 0
    chunk_size = 1024 * 1024  # 1 MB chunks

    try:
        with destination.open("wb") as buffer:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break

                bytes_written += len(chunk)

                if bytes_written > MAX_FILE_SIZE_BYTES:
                    # Remove partially-written file
                    destination.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"File too large. Maximum allowed size is "
                            f"{MAX_FILE_SIZE_MB} MB."
                        ),
                    )

                buffer.write(chunk)

    except HTTPException:
        raise
    except Exception as exc:
        destination.unlink(missing_ok=True)
        logger.exception("Upload failed for job %s: %s", job_id, exc)
        raise HTTPException(
            status_code=500,
            detail="File upload failed due to a server error.",
        ) from exc

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
        "filename": destination.name,
        "size_bytes": bytes_written,
        "size_mb": round(size_mb, 2),
        "status": "uploaded",
        "job_id": job.job_id,
        "organization_id": current_user.organization_id,
    }
