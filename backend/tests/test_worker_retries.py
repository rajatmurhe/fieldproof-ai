"""
FieldProof AI — Worker Retry Semantics Regression Tests

Regression: any exception in process_job used to mark the job FAILED
permanently, so MAX_ATTEMPTS only applied to crashed workers and a single
Gemini 429/503 killed the job.
"""

from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from backend.models.analysis_job import AnalysisJob
from backend.models.audit_log import AuditLog
from backend.models.checklist import Checklist
from backend.models.job import Job
from backend.models.job_result import JobResult
from backend.services.gemini_service import Analysis, CheckResult, QAResult, VideoRejectedError
from backend.services.storage import LocalStorage
from backend.tests.conftest import TestingSessionLocal
from backend.worker import MAX_ATTEMPTS, claim_one_job, process_job


@pytest.fixture
def queued_job(db_session, seed_tenants, isolated_storage):
    org_id = seed_tenants["org_a"].id

    storage_key = f"{org_id}/clip.mp4"
    (isolated_storage / str(org_id)).mkdir(parents=True)
    (isolated_storage / storage_key).write_bytes(b"video")

    job = Job(
        job_id="RETRY-1",
        organization_id=org_id,
        job_type="cleaning",
        video_filename="clip.mp4",
        storage_key=storage_key,
        status="QUEUED",
    )
    db_session.add(job)
    db_session.flush()

    db_session.add(
        Checklist(organization_id=org_id, job_type="cleaning", checks=["Floor is clean."])
    )
    queue_job = AnalysisJob(job_id=job.id, status="QUEUED", attempts=0)
    db_session.add(queue_job)
    db_session.commit()

    return job.id, queue_job.id


def _run_once(analyze_side_effect):
    with patch("backend.worker.SessionLocal", side_effect=TestingSessionLocal), patch(
        "backend.worker.analyze_video", side_effect=analyze_side_effect
    ):
        claimed = claim_one_job()
        if claimed is not None:
            process_job(claimed)
        return claimed


def _state(job_pk, queue_pk):
    session = TestingSessionLocal()
    return (
        session.query(Job).filter(Job.id == job_pk).one(),
        session.query(AnalysisJob).filter(AnalysisJob.id == queue_pk).one(),
        session,
    )


def _make_due(queue_pk):
    session = TestingSessionLocal()
    queue_job = session.query(AnalysisJob).filter(AnalysisJob.id == queue_pk).one()
    queue_job.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
    session.commit()
    session.close()


def test_transient_error_schedules_retry_with_backoff(queued_job):
    job_pk, queue_pk = queued_job

    _run_once(RuntimeError("503 service_unavailable"))

    job, queue_job, session = _state(job_pk, queue_pk)
    assert queue_job.status == "QUEUED"
    assert job.status == "QUEUED"
    assert queue_job.attempts == 1
    assert queue_job.next_attempt_at > datetime.utcnow()
    assert "503" in queue_job.error_message

    audit = (
        session.query(AuditLog)
        .filter(AuditLog.job_id == job_pk, AuditLog.action == "AI_ANALYSIS_RETRY_SCHEDULED")
        .one()
    )
    assert audit.details["retry_in_seconds"] > 0


def test_retry_is_not_claimed_before_backoff_expires(queued_job):
    _, queue_pk = queued_job

    _run_once(RuntimeError("429 rate limited"))

    # Still backing off: nothing to claim.
    assert _run_once(RuntimeError("unused")) is None

    _make_due(queue_pk)
    assert _run_once(RuntimeError("429 rate limited")) == queue_pk


def test_backoff_grows_exponentially(queued_job):
    _, queue_pk = queued_job

    delays = []
    for _ in range(MAX_ATTEMPTS - 1):
        before = datetime.utcnow()
        _run_once(RuntimeError("503"))
        _, queue_job, _ = _state(*queued_job)
        delays.append((queue_job.next_attempt_at - before).total_seconds())
        _make_due(queue_pk)

    assert delays[1] > delays[0] * 1.5


def test_job_fails_after_max_attempts(queued_job):
    job_pk, queue_pk = queued_job

    for _ in range(MAX_ATTEMPTS):
        _run_once(RuntimeError("503"))
        _make_due(queue_pk)

    job, queue_job, _ = _state(job_pk, queue_pk)
    assert queue_job.status == "FAILED"
    assert job.status == "FAILED"
    assert queue_job.attempts == MAX_ATTEMPTS


def test_recovers_after_transient_error(queued_job):
    job_pk, queue_pk = queued_job

    _run_once(RuntimeError("503"))
    _make_due(queue_pk)

    result = QAResult(
        overall_status="PASS",
        checks=[CheckResult(check="Floor is clean.", status="PASS", confidence=0.9, reason="Clean.")],
    )
    _run_once(lambda *args: Analysis(result=result, model_name="test-model"))

    job, queue_job, session = _state(job_pk, queue_pk)
    assert queue_job.status == "COMPLETED"
    assert job.status == "PASS"
    assert queue_job.attempts == 2

    # The result records exactly what the model was asked.
    stored = session.query(JobResult).filter(JobResult.job_id == job_pk).one()
    assert stored.checklist_snapshot == ["Floor is clean."]
    assert stored.prompt_version
    assert stored.guardrail_events == []


@pytest.mark.parametrize(
    "error",
    [VideoRejectedError("bad file"), FileNotFoundError("gone")],
)
def test_permanent_errors_fail_immediately(queued_job, error):
    job_pk, queue_pk = queued_job

    _run_once(error)

    job, queue_job, _ = _state(job_pk, queue_pk)
    assert queue_job.status == "FAILED"
    assert job.status == "FAILED"
    assert queue_job.attempts == 1


def test_missing_video_fails_without_calling_gemini(queued_job, isolated_storage):
    job_pk, queue_pk = queued_job
    job, _, session = _state(job_pk, queue_pk)
    LocalStorage(isolated_storage).delete(job.storage_key)
    session.close()

    calls = []
    _run_once(lambda *args: calls.append(args))

    _, queue_job, _ = _state(job_pk, queue_pk)
    assert queue_job.status == "FAILED"
    assert calls == []


def test_max_attempts_audit_records_previous_status(queued_job):
    job_pk, queue_pk = queued_job
    session = TestingSessionLocal()
    queue_job = session.query(AnalysisJob).filter(AnalysisJob.id == queue_pk).one()
    queue_job.attempts = MAX_ATTEMPTS
    session.commit()
    session.close()

    _run_once(RuntimeError("unused"))

    _, _, session = _state(job_pk, queue_pk)
    audit = (
        session.query(AuditLog)
        .filter(AuditLog.job_id == job_pk, AuditLog.action == "AI_ANALYSIS_FAILED")
        .one()
    )
    assert audit.from_status == "QUEUED"
    assert audit.to_status == "FAILED"
