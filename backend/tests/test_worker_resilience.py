"""
FieldProof AI — Worker Resilience & Concurrency Tests
"""

from datetime import datetime, timedelta
from unittest.mock import patch

from backend.models.analysis_job import AnalysisJob
from backend.models.audit_log import AuditLog
from backend.models.job import Job
from backend.worker import (
    MAX_ATTEMPTS,
    claim_one_job,
    recover_stale_jobs,
)
from backend.tests.conftest import TestingSessionLocal


def test_claim_one_job_lifecycle(db_session, seed_tenants):
    """Worker claims a QUEUED job, updates status to PROCESSING/ANALYZING, logs audit."""
    org_id = seed_tenants["org_a"].id

    job = Job(
        job_id="CLAIM-TEST",
        organization_id=org_id,
        job_type="cleaning",
        video_filename="claim.mp4",
        status="QUEUED",
    )
    db_session.add(job)
    db_session.flush()

    analysis_job = AnalysisJob(
        job_id=job.id,
        status="QUEUED",
        attempts=0,
    )
    db_session.add(analysis_job)
    db_session.commit()
    target_id = analysis_job.id

    with patch("backend.worker.SessionLocal", side_effect=TestingSessionLocal):
        claimed_id = claim_one_job()

    assert claimed_id == target_id

    # Verify state updates in fresh session
    verify_session = TestingSessionLocal()
    updated_analysis = verify_session.query(AnalysisJob).filter(AnalysisJob.id == target_id).first()
    updated_job = verify_session.query(Job).filter(Job.id == job.id).first()

    assert updated_analysis.status == "PROCESSING"
    assert updated_analysis.attempts == 1
    assert updated_analysis.started_at is not None
    assert updated_job.status == "ANALYZING"

    # Verify audit log
    audit = (
        verify_session.query(AuditLog)
        .filter(AuditLog.job_id == job.id, AuditLog.action == "AI_ANALYSIS_STARTED")
        .first()
    )
    assert audit is not None
    assert audit.from_status == "QUEUED"
    assert audit.to_status == "ANALYZING"
    verify_session.close()


def test_stale_processing_job_recovery(db_session, seed_tenants):
    """Jobs stuck in PROCESSING past the stale threshold are safely reset to QUEUED."""
    org_id = seed_tenants["org_a"].id

    job = Job(
        job_id="STALE-TEST",
        organization_id=org_id,
        job_type="cleaning",
        video_filename="stale.mp4",
        status="ANALYZING",
    )
    db_session.add(job)
    db_session.flush()

    # Started 45 minutes ago (> 30 min threshold)
    forty_five_mins_ago = datetime.utcnow() - timedelta(minutes=45)
    analysis_job = AnalysisJob(
        job_id=job.id,
        status="PROCESSING",
        attempts=1,
        started_at=forty_five_mins_ago,
    )
    db_session.add(analysis_job)
    db_session.commit()
    target_id = analysis_job.id

    with patch("backend.worker.SessionLocal", side_effect=TestingSessionLocal):
        recovered_count = recover_stale_jobs()

    assert recovered_count == 1

    verify_session = TestingSessionLocal()
    updated_analysis = verify_session.query(AnalysisJob).filter(AnalysisJob.id == target_id).first()
    updated_job = verify_session.query(Job).filter(Job.id == job.id).first()

    # Job is back to QUEUED for retry
    assert updated_analysis.status == "QUEUED"
    assert updated_analysis.started_at is None
    assert updated_job.status == "QUEUED"
    verify_session.close()


def test_stale_job_max_attempts_exceeded(db_session, seed_tenants):
    """A stale job that has reached MAX_ATTEMPTS is permanently marked FAILED."""
    org_id = seed_tenants["org_a"].id

    job = Job(
        job_id="MAX-TEST",
        organization_id=org_id,
        job_type="cleaning",
        video_filename="max.mp4",
        status="ANALYZING",
    )
    db_session.add(job)
    db_session.flush()

    analysis_job = AnalysisJob(
        job_id=job.id,
        status="PROCESSING",
        attempts=MAX_ATTEMPTS,
        started_at=datetime.utcnow() - timedelta(minutes=40),
    )
    db_session.add(analysis_job)
    db_session.commit()
    target_id = analysis_job.id

    with patch("backend.worker.SessionLocal", side_effect=TestingSessionLocal):
        recover_stale_jobs()

    verify_session = TestingSessionLocal()
    updated_analysis = verify_session.query(AnalysisJob).filter(AnalysisJob.id == target_id).first()
    updated_job = verify_session.query(Job).filter(Job.id == job.id).first()

    assert updated_analysis.status == "FAILED"
    assert updated_job.status == "FAILED"
    assert "Permanently failed" in updated_analysis.error_message
    verify_session.close()
