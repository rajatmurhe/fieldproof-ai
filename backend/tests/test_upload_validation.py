"""
FieldProof AI — Video Upload & Streaming Security Tests
"""

import io
from pathlib import Path
import pytest
from backend.models.job import Job


def test_upload_unsupported_extension_rejected(client_a):
    """Files with non-video extensions are rejected with 400 Bad Request."""
    client_a.post(
        "/jobs/",
        json={"job_id": "J-EXT", "job_type": "cleaning", "video_filename": "script.sh"},
    )

    fake_file = io.BytesIO(b"echo 'malicious'")
    res = client_a.post(
        "/upload/",
        data={"job_id": "J-EXT"},
        files={"file": ("script.sh", fake_file, "text/x-shellscript")},
    )
    assert res.status_code == 400
    assert "Unsupported video format" in res.json()["detail"]


def test_upload_filename_mismatch_rejected(client_a):
    """Uploaded filename must match the registered job video filename."""
    client_a.post(
        "/jobs/",
        json={"job_id": "J-MATCH", "job_type": "cleaning", "video_filename": "expected.mp4"},
    )

    fake_file = io.BytesIO(b"test video content")
    res = client_a.post(
        "/upload/",
        data={"job_id": "J-MATCH"},
        files={"file": ("different.mp4", fake_file, "video/mp4")},
    )
    assert res.status_code == 400
    assert "does not match" in res.json()["detail"]


def test_video_endpoint_path_traversal_blocked(client_a):
    """Path traversal attacks on /videos/{filename} are rejected."""
    # Attempting to escape the uploads directory
    traversal_filenames = [
        "../secrets.txt",
        "..%2F..%2Fetc%2Fpasswd",
        "nested/sub/video.mp4",
    ]

    for bad_name in traversal_filenames:
        res = client_a.get(f"/videos/{bad_name}")
        assert res.status_code in (400, 404)


def test_cross_tenant_video_streaming_forbidden(client_a, client_b, db_session, seed_tenants, tmp_path):
    """Tenant B cannot stream a video file belonging to Tenant A's job."""
    # Register job in Tenant A
    org_a_id = seed_tenants["org_a"].id
    job = Job(
        job_id="J-SECRET-VID",
        organization_id=org_a_id,
        job_type="cleaning",
        video_filename="private_recording.mp4",
        status="PASS",
    )
    db_session.add(job)
    db_session.commit()

    # Bob in Tenant B attempts to stream Alice's video
    res = client_b.get("/videos/private_recording.mp4")
    assert res.status_code == 404
