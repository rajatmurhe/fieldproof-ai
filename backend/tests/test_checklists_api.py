"""
FieldProof AI — Checklists API Unit & Integration Tests
"""

import pytest


def test_auto_seed_default_templates(client_a):
    """When a new organization lists checklists, standard defaults are seeded."""
    res = client_a.get("/checklists/")
    assert res.status_code == 200
    checklists = res.json()
    types = [c["job_type"] for c in checklists]
    assert "cleaning" in types
    assert "hvac" in types
    assert "maintenance" in types
    assert "plumbing" in types


def test_create_and_delete_custom_checklist(client_a):
    """Custom checklist creation and deletion."""
    create_res = client_a.post(
        "/checklists/",
        json={
            "job_type": "dock_inspection",
            "checks": ["Mooring lines taut", "Safety railings secure"],
        },
    )
    assert create_res.status_code == 200
    assert create_res.json()["job_type"] == "dock_inspection"
    assert create_res.json()["count"] == 2

    # Verify retrieval
    get_res = client_a.get("/checklists/dock_inspection")
    assert get_res.status_code == 200
    assert get_res.json()["checks"] == ["Mooring lines taut", "Safety railings secure"]

    # Delete
    del_res = client_a.delete("/checklists/dock_inspection")
    assert del_res.status_code == 200

    # Ensure 404 after delete
    get_after = client_a.get("/checklists/dock_inspection")
    assert get_after.status_code == 404


def test_job_type_format_validation(client_a):
    """Job type format must be lowercase alphanumeric, hyphens or underscores."""
    invalid_types = ["Job Type With Spaces", "HVAC_UPPERCASE", "test$special!"]

    for bad_type in invalid_types:
        res = client_a.post(
            "/checklists/",
            json={"job_type": bad_type, "checks": ["Sample check"]},
        )
        assert res.status_code == 400
