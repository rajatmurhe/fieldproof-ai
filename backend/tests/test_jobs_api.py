"""
FieldProof AI — Jobs API Unit & Integration Tests
"""

import pytest
from backend.models.job import Job
from backend.models.audit_log import AuditLog
from backend.models.job_result import JobResult
from backend.models.job_finding import JobFinding


def test_create_job_validation(client_a):
    """Empty or oversized job IDs are rejected with 400 Bad Request."""
    res_empty = client_a.post(
        "/jobs/",
        json={"job_id": "   ", "job_type": "cleaning", "video_filename": "vid.mp4"},
    )
    assert res_empty.status_code == 400

    res_long = client_a.post(
        "/jobs/",
        json={"job_id": "X" * 55, "job_type": "cleaning", "video_filename": "vid.mp4"},
    )
    assert res_long.status_code == 400


def test_create_job_idempotent(client_a):
    """Creating the same job twice returns the existing job without error."""
    res1 = client_a.post(
        "/jobs/",
        json={"job_id": "JOB-IDEMP", "job_type": "cleaning", "video_filename": "vid.mp4"},
    )
    assert res1.status_code == 200
    job1_id = res1.json()["id"]

    res2 = client_a.post(
        "/jobs/",
        json={"job_id": "JOB-IDEMP", "job_type": "cleaning", "video_filename": "vid.mp4"},
    )
    assert res2.status_code == 200
    assert res2.json()["id"] == job1_id


def test_get_stats_aggregation(client_a, db_session, seed_tenants):
    """The /jobs/stats endpoint computes accurate aggregate counts."""
    org_id = seed_tenants["org_a"].id

    # Seed 3 jobs with different statuses
    j1 = Job(job_id="J1", organization_id=org_id, job_type="cleaning", video_filename="v1.mp4", status="REVIEW")
    j2 = Job(job_id="J2", organization_id=org_id, job_type="hvac", video_filename="v2.mp4", status="APPROVED")
    j3 = Job(job_id="J3", organization_id=org_id, job_type="cleaning", video_filename="v3.mp4", status="QUEUED")
    db_session.add_all([j1, j2, j3])
    db_session.commit()

    stats_res = client_a.get("/jobs/stats")
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert stats["total"] >= 3
    assert stats["review"] >= 1
    assert stats["approved"] >= 1
    assert stats["queued"] >= 1


def test_review_validation_rules(client_a, db_session, seed_tenants):
    """Reviewing is only allowed for REVIEW status and requires APPROVED/REJECTED."""
    org_id = seed_tenants["org_a"].id
    job = Job(job_id="J-RULE", organization_id=org_id, job_type="cleaning", video_filename="v.mp4", status="PENDING")
    db_session.add(job)
    db_session.commit()

    # Attempting to review a PENDING job -> 400
    res_pending = client_a.post("/jobs/J-RULE/review", json={"decision": "APPROVED"})
    assert res_pending.status_code == 400

    # Transition to REVIEW
    job.status = "REVIEW"
    db_session.commit()

    # Invalid decision string -> 400
    res_bad_dec = client_a.post("/jobs/J-RULE/review", json={"decision": "MAYBE"})
    assert res_bad_dec.status_code == 400

    # Valid approval -> 200
    res_ok = client_a.post("/jobs/J-RULE/review", json={"decision": "approved"})
    assert res_ok.status_code == 200
    assert res_ok.json()["status"] == "APPROVED"
    assert res_ok.json()["review_decision"] == "APPROVED"

    # Verify audit log was created
    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.job_id == job.id, AuditLog.action == "HUMAN_REVIEW")
        .first()
    )
    assert audit is not None
    assert audit.from_status == "REVIEW"
    assert audit.to_status == "APPROVED"


def test_health_endpoints(client_a):
    """Root and health endpoints respond predictably."""
    res_root = client_a.get("/")
    assert res_root.status_code == 200
    assert res_root.json()["status"] == "running"

    res_health = client_a.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "healthy"
