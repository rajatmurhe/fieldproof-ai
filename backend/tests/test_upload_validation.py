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


def test_storage_rejects_keys_that_escape_upload_root(isolated_storage):
    """Storage keys can never resolve outside the upload directory."""
    from backend.services.storage import LocalStorage

    storage = LocalStorage(isolated_storage)

    for bad_key in ["../secrets.txt", "1/../../etc/passwd", "/etc/passwd"]:
        with pytest.raises(ValueError):
            storage.exists(bad_key)


def test_cross_tenant_video_streaming_forbidden(client_a, client_b, db_session, seed_tenants):
    """Tenant B cannot stream a video belonging to Tenant A's job."""
    client_a.post(
        "/jobs/",
        json={"job_id": "J-SECRET-VID", "job_type": "cleaning", "video_filename": "private_recording.mp4"},
    )
    res = client_a.post(
        "/upload/",
        data={"job_id": "J-SECRET-VID"},
        files={"file": ("private_recording.mp4", io.BytesIO(b"secret"), "video/mp4")},
    )
    assert res.status_code == 200

    # Bob in Tenant B attempts to stream Alice's job video
    res = client_b.get("/jobs/J-SECRET-VID/video")
    assert res.status_code == 404
