"""
FieldProof AI — Multi-Tenancy Security Tests

Validates strict data isolation across tenant organizations:
- Jobs in Org A are invisible to Org B (404 Not Found)
- The same job_id (e.g. "JOB-1001") can exist independently in both Org A and Org B
- Review actions cannot be performed across tenant boundaries
- Checklists are compartmentalized per organization
"""

import pytest
from backend.models.job import Job
from backend.models.checklist import Checklist


def test_cross_tenant_job_isolation(client_a, client_b):
    """Tenant A creates a job; Tenant B cannot view or list it."""
    # Alice creates a job in Tenant A
    create_res = client_a.post(
        "/jobs/",
        json={
            "job_id": "JOB-1001",
            "job_type": "cleaning",
            "video_filename": "job1001.mp4",
        },
    )
    assert create_res.status_code == 200
    assert create_res.json()["job_id"] == "JOB-1001"

    # Alice in Tenant A can see it
    get_res_a = client_a.get("/jobs/JOB-1001")
    assert get_res_a.status_code == 200
    assert get_res_a.json()["job_id"] == "JOB-1001"

    # Bob in Tenant B attempts to fetch Tenant A's job -> MUST return 404
    get_res_b = client_b.get("/jobs/JOB-1001")
    assert get_res_b.status_code == 404

    # Bob lists jobs -> Tenant A's job must NOT appear
    list_res_b = client_b.get("/jobs/")
    assert list_res_b.status_code == 200
    b_job_ids = [j["job_id"] for j in list_res_b.json()]
    assert "JOB-1001" not in b_job_ids


def test_same_job_id_in_different_tenants(client_a, client_b):
    """Both Tenant A and Tenant B can create JOB-2000 without collision."""
    res_a = client_a.post(
        "/jobs/",
        json={
            "job_id": "JOB-2000",
            "job_type": "cleaning",
            "video_filename": "video_a.mp4",
        },
    )
    assert res_a.status_code == 200
    assert res_a.json()["video_filename"] == "video_a.mp4"

    res_b = client_b.post(
        "/jobs/",
        json={
            "job_id": "JOB-2000",
            "job_type": "hvac",
            "video_filename": "video_b.mp4",
        },
    )
    assert res_b.status_code == 200
    assert res_b.json()["video_filename"] == "video_b.mp4"

    # Verify each tenant sees their own job details
    get_a = client_a.get("/jobs/JOB-2000")
    get_b = client_b.get("/jobs/JOB-2000")
    assert get_a.json()["video_filename"] == "video_a.mp4"
    assert get_b.json()["video_filename"] == "video_b.mp4"
    assert get_a.json()["job_type"] == "cleaning"
    assert get_b.json()["job_type"] == "hvac"


def test_cross_tenant_review_prohibited(client_a, client_b, db_session, seed_tenants):
    """Tenant B cannot submit a review decision for a job in Tenant A."""
    # Alice creates a job
    client_a.post(
        "/jobs/",
        json={
            "job_id": "JOB-REVIEW-TEST",
            "job_type": "cleaning",
            "video_filename": "review.mp4",
        },
    )

    # Set status to REVIEW in DB
    job_a = (
        db_session.query(Job)
        .filter(Job.job_id == "JOB-REVIEW-TEST", Job.organization_id == seed_tenants["org_a"].id)
        .first()
    )
    job_a.status = "REVIEW"
    db_session.commit()

    # Bob attempts to approve Alice's job -> MUST return 404
    review_res = client_b.post(
        "/jobs/JOB-REVIEW-TEST/review",
        json={"decision": "APPROVED"},
    )
    assert review_res.status_code == 404

    # Alice can legitimately approve her own job
    alice_review = client_a.post(
        "/jobs/JOB-REVIEW-TEST/review",
        json={"decision": "APPROVED"},
    )
    assert alice_review.status_code == 200
    assert alice_review.json()["status"] == "APPROVED"


def test_cross_tenant_checklist_isolation(client_a, client_b):
    """Custom checklists created in Tenant A are not visible to Tenant B."""
    # Alice creates custom checklist for 'solar_maintenance'
    create_res = client_a.post(
        "/checklists/",
        json={
            "job_type": "solar_maintenance",
            "checks": ["Inverter display operational", "Panels clean"],
        },
    )
    assert create_res.status_code == 200

    # Alice sees it
    res_a = client_a.get("/checklists/solar_maintenance")
    assert res_a.status_code == 200

    # Bob cannot see Alice's custom checklist
    res_b = client_b.get("/checklists/solar_maintenance")
    assert res_b.status_code == 404
