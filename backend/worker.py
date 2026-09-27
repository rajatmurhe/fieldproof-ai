"""
FieldProof AI — Background Analysis Worker

Picks QUEUED analysis jobs, calls Gemini, persists results.

Resilience features:
  - WITH FOR UPDATE SKIP LOCKED: safe concurrent worker claiming
  - Stale PROCESSING recovery: jobs stuck >30min are reset to QUEUED
  - Max retry limit: after MAX_ATTEMPTS failures, job is permanently FAILED
  - Structured logging: every lifecycle event is logged with job context
"""

import logging
import time
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from backend.database.connection import SessionLocal
from backend.models.analysis_job import AnalysisJob
from backend.models.audit_log import AuditLog
from backend.models.checklist import Checklist
from backend.models.job import Job
from backend.models.job_finding import JobFinding
from backend.models.job_result import JobResult

from backend.services.gemini_service import analyze_video

logger = logging.getLogger("fieldproof.worker")

UPLOAD_DIR = Path("uploads")

# Maximum times a job will be attempted before being permanently failed.
MAX_ATTEMPTS = 3

# Jobs stuck in PROCESSING for longer than this are considered stale
# (worker crashed mid-job) and will be reset to QUEUED for retry.
STALE_THRESHOLD_MINUTES = 30

# How long the worker sleeps between polls when there is nothing to do.
POLL_INTERVAL_SECONDS = 5


def add_audit_log(
    db: Session,
    *,
    organization_id: int,
    job_id: int,
    action: str,
    from_status: str | None,
    to_status: str | None,
    details: dict | None = None,
):
    db.add(
        AuditLog(
            organization_id=organization_id,
            job_id=job_id,
            user_id=None,
            action=action,
            from_status=from_status,
            to_status=to_status,
            details=details or {},
        )
    )


def recover_stale_jobs() -> int:
    """
    Reset PROCESSING jobs that have been running too long back to QUEUED
    so they can be retried, unless they have exhausted MAX_ATTEMPTS.

    Returns the number of jobs recovered.
    """
    db = SessionLocal()
    recovered = 0

    try:
        threshold = datetime.utcnow() - timedelta(
            minutes=STALE_THRESHOLD_MINUTES
        )

        stale_queue_jobs = (
            db.query(AnalysisJob)
            .filter(
                AnalysisJob.status == "PROCESSING",
                AnalysisJob.started_at < threshold,
            )
            .all()
        )

        for queue_job in stale_queue_jobs:
            job = (
                db.query(Job)
                .filter(Job.id == queue_job.job_id)
                .first()
            )

            if queue_job.attempts >= MAX_ATTEMPTS:
                # Permanently fail
                queue_job.status = "FAILED"
                queue_job.completed_at = datetime.utcnow()
                queue_job.error_message = (
                    f"Permanently failed after {queue_job.attempts} attempts "
                    f"(stale recovery)."
                )

                if job:
                    previous_status = job.status
                    job.status = "FAILED"

                    add_audit_log(
                        db,
                        organization_id=job.organization_id,
                        job_id=job.id,
                        action="AI_ANALYSIS_FAILED",
                        from_status=previous_status,
                        to_status="FAILED",
                        details={
                            "reason": queue_job.error_message,
                            "worker_attempt": queue_job.attempts,
                        },
                    )

                    logger.error(
                        "Permanently failed stale job",
                        extra={
                            "job_id": job.job_id,
                            "queue_job_id": queue_job.id,
                            "attempts": queue_job.attempts,
                        },
                    )
            else:
                # Reset to QUEUED for retry
                queue_job.status = "QUEUED"
                queue_job.started_at = None
                queue_job.error_message = (
                    f"Reset after stale PROCESSING "
                    f"(attempt {queue_job.attempts} of {MAX_ATTEMPTS})."
                )

                if job:
                    job.status = "QUEUED"

                    logger.warning(
                        "Recovered stale processing job",
                        extra={
                            "job_id": job.job_id,
                            "queue_job_id": queue_job.id,
                            "attempts": queue_job.attempts,
                        },
                    )

            recovered += 1

        if recovered:
            db.commit()
            logger.info("Stale job recovery: %d jobs recovered.", recovered)

    except Exception as exc:
        db.rollback()
        logger.error("Stale job recovery failed: %s", exc)
    finally:
        db.close()

    return recovered


def claim_one_job() -> int | None:
    """
    Atomically claim one QUEUED job for processing.
    Uses SELECT FOR UPDATE SKIP LOCKED for safe concurrent claiming.
    Returns the claimed AnalysisJob.id, or None if nothing is available.
    """
    db = SessionLocal()

    try:
        queue_job = (
            db.query(AnalysisJob)
            .filter(
                AnalysisJob.status == "QUEUED",
            )
            .order_by(AnalysisJob.created_at.asc())
            .with_for_update(skip_locked=True)
            .first()
        )

        if not queue_job:
            return None

        job = (
            db.query(Job)
            .filter(Job.id == queue_job.job_id)
            .first()
        )

        if not job:
            queue_job.status = "FAILED"
            queue_job.completed_at = datetime.utcnow()
            queue_job.error_message = "Linked job record not found."
            db.commit()
            logger.error(
                "Claimed queue job %d but linked Job not found.",
                queue_job.id,
            )
            return None

        if queue_job.attempts >= MAX_ATTEMPTS:
            queue_job.status = "FAILED"
            queue_job.completed_at = datetime.utcnow()
            queue_job.error_message = (
                f"Permanently failed: exceeded {MAX_ATTEMPTS} attempts."
            )
            job.status = "FAILED"

            add_audit_log(
                db,
                organization_id=job.organization_id,
                job_id=job.id,
                action="AI_ANALYSIS_FAILED",
                from_status=job.status,
                to_status="FAILED",
                details={
                    "reason": queue_job.error_message,
                    "worker_attempt": queue_job.attempts,
                },
            )

            db.commit()
            logger.error(
                "Job %s permanently failed (max attempts exceeded).",
                job.job_id,
            )
            return None

        previous_status = job.status

        queue_job.status = "PROCESSING"
        queue_job.attempts += 1
        queue_job.started_at = datetime.utcnow()
        queue_job.error_message = None

        job.status = "ANALYZING"

        add_audit_log(
            db,
            organization_id=job.organization_id,
            job_id=job.id,
            action="AI_ANALYSIS_STARTED",
            from_status=previous_status,
            to_status="ANALYZING",
            details={
                "worker_attempt": queue_job.attempts,
            },
        )

        db.commit()

        logger.info(
            "Claimed job for analysis: %s (queue_job_id=%d, attempt=%d)",
            job.job_id,
            queue_job.id,
            queue_job.attempts,
        )

        return queue_job.id

    finally:
        db.close()


def process_job(queue_job_id: int) -> None:
    """
    Execute Gemini analysis for a claimed queue job and persist results.
    On failure, marks the job and queue entry as FAILED with error detail.
    """
    db = SessionLocal()

    try:
        queue_job = (
            db.query(AnalysisJob)
            .filter(AnalysisJob.id == queue_job_id)
            .first()
        )

        if not queue_job:
            logger.error("Queue job %d not found.", queue_job_id)
            return

        job = (
            db.query(Job)
            .filter(Job.id == queue_job.job_id)
            .first()
        )

        if not job:
            queue_job.status = "FAILED"
            queue_job.error_message = "Linked job record not found."
            queue_job.completed_at = datetime.utcnow()
            db.commit()
            logger.error(
                "Queue job %d: linked Job not found.",
                queue_job_id,
            )
            return

        checklist = (
            db.query(Checklist)
            .filter(
                Checklist.organization_id == job.organization_id,
                Checklist.job_type == job.job_type,
            )
            .first()
        )

        if not checklist:
            raise RuntimeError(
                f"No checklist configured for job type '{job.job_type}' "
                f"in organization {job.organization_id}."
            )

        video_path = UPLOAD_DIR / Path(job.video_filename).name

        if not video_path.exists():
            raise FileNotFoundError(
                f"Video file not found on disk: {video_path}"
            )

        logger.info(
            "Starting Gemini analysis: job=%s type=%s video=%s",
            job.job_id,
            job.job_type,
            video_path.name,
        )

        started = datetime.utcnow()

        result, active_model = analyze_video(
            str(video_path),
            job.job_type,
            checklist.checks,
        )

        duration_seconds = int(
            (datetime.utcnow() - started).total_seconds()
        )

        # Clear any existing result (idempotent re-analysis)
        existing_result = (
            db.query(JobResult)
            .filter(JobResult.job_id == job.id)
            .first()
        )

        if existing_result:
            db.delete(existing_result)
            db.flush()

        job_result = JobResult(
            job_id=job.id,
            overall_status=result.overall_status,
            model_name=active_model,
        )

        db.add(job_result)
        db.flush()

        finding_count = 0

        for index, finding in enumerate(result.checks, start=1):
            db.add(
                JobFinding(
                    job_result_id=job_result.id,
                    check_order=index,
                    check=finding.check,
                    status=finding.status,
                    confidence=finding.confidence,
                    evidence_timestamp=finding.evidence_timestamp,
                    reason=finding.reason,
                )
            )
            finding_count += 1

        previous_status = job.status
        job.status = result.overall_status

        queue_job.status = "COMPLETED"
        queue_job.completed_at = datetime.utcnow()
        queue_job.error_message = None

        add_audit_log(
            db,
            organization_id=job.organization_id,
            job_id=job.id,
            action="AI_ANALYSIS_COMPLETED",
            from_status=previous_status,
            to_status=job.status,
            details={
                "model": active_model,
                "overall_status": result.overall_status,
                "finding_count": finding_count,
                "worker_attempt": queue_job.attempts,
                "duration_seconds": duration_seconds,
            },
        )

        db.commit()

        logger.info(
            "Analysis completed: job=%s result=%s model=%s findings=%d duration=%ds",
            job.job_id,
            job.status,
            active_model,
            finding_count,
            duration_seconds,
        )

    except Exception as exc:
        db.rollback()

        logger.exception(
            "Analysis failed for queue_job_id=%d: %s",
            queue_job_id,
            exc,
        )

        try:
            queue_job = (
                db.query(AnalysisJob)
                .filter(AnalysisJob.id == queue_job_id)
                .first()
            )

            if queue_job:
                job = (
                    db.query(Job)
                    .filter(Job.id == queue_job.job_id)
                    .first()
                )

                error_message = str(exc)

                if job:
                    previous_status = job.status
                    job.status = "FAILED"

                    add_audit_log(
                        db,
                        organization_id=job.organization_id,
                        job_id=job.id,
                        action="AI_ANALYSIS_FAILED",
                        from_status=previous_status,
                        to_status="FAILED",
                        details={
                            "reason": error_message,
                            "worker_attempt": queue_job.attempts,
                        },
                    )

                queue_job.status = "FAILED"
                queue_job.completed_at = datetime.utcnow()
                queue_job.error_message = error_message

                db.commit()

        except Exception as inner_exc:
            logger.exception(
                "Failed to record failure for queue_job_id=%d: %s",
                queue_job_id,
                inner_exc,
            )

    finally:
        db.close()


def run_worker(
    poll_interval: int = POLL_INTERVAL_SECONDS,
    stale_check_interval: int = 300,
) -> None:
    """
    Main worker loop.

    Polls for QUEUED jobs, claims and processes them.
    Periodically checks for stale PROCESSING jobs.
    """
    logger.info(
        "FieldProof analysis worker started "
        "(poll_interval=%ds, stale_threshold=%dm, max_attempts=%d)",
        poll_interval,
        STALE_THRESHOLD_MINUTES,
        MAX_ATTEMPTS,
    )

    last_stale_check = datetime.utcnow()

    while True:
        # Periodically recover stale PROCESSING jobs
        now = datetime.utcnow()
        if (now - last_stale_check).total_seconds() >= stale_check_interval:
            recover_stale_jobs()
            last_stale_check = now

        queue_job_id = claim_one_job()

        if queue_job_id is None:
            time.sleep(poll_interval)
            continue

        process_job(queue_job_id)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    )

    run_worker()
