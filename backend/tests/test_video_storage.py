"""
FieldProof AI — Tenant-Safe Video Storage Regression Tests

Regression for a cross-tenant leak: videos used to be stored flat in
uploads/ under the client-supplied filename and served by filename. Tenant B
could register a job with the same filename as Tenant A's video, then stream
and overwrite Tenant A's file.
"""

import io

from backend.models.job import Job


def _create_and_upload(client, job_id, filename, content):
    res = client.post(
        "/jobs/",
        json={"job_id": job_id, "job_type": "cleaning", "video_filename": filename},
    )
    assert res.status_code == 200, res.text

    res = client.post(
        "/upload/",
        data={"job_id": job_id},
        files={"file": (filename, io.BytesIO(content), "video/mp4")},
    )
    assert res.status_code == 200, res.text


def test_same_filename_in_two_tenants_cannot_read_or_overwrite(client_a, client_b):
    _create_and_upload(client_a, "A-1", "site.mp4", b"TENANT-A-SECRET")
    _create_and_upload(client_b, "B-1", "site.mp4", b"TENANT-B-VIDEO")

    # Each tenant still gets its own bytes: no read across tenants and no
    # overwrite of the other tenant's file.
    assert client_a.get("/jobs/A-1/video").content == b"TENANT-A-SECRET"
    assert client_b.get("/jobs/B-1/video").content == b"TENANT-B-VIDEO"

    # And B cannot address A's job at all.
    assert client_b.get("/jobs/A-1/video").status_code == 404


def test_storage_key_is_server_generated_and_org_scoped(client_a, db_session, seed_tenants):
    _create_and_upload(client_a, "A-KEY", "my video.mp4", b"x")

    job = db_session.query(Job).filter(Job.job_id == "A-KEY").one()

    org_id = seed_tenants["org_a"].id
    assert job.storage_key.startswith(f"{org_id}/{job.id}-")
    assert job.storage_key.endswith(".mp4")
    assert "my video" not in job.storage_key
    # The original name is kept for display only.
    assert job.video_filename == "my video.mp4"


def test_files_are_written_under_org_directory(client_a, seed_tenants, isolated_storage):
    _create_and_upload(client_a, "A-DIR", "clip.mp4", b"x")

    org_dir = isolated_storage / str(seed_tenants["org_a"].id)
    assert [p.name for p in org_dir.iterdir()][0].endswith(".mp4")
    # Nothing is written at the root under the client's filename.
    assert not (isolated_storage / "clip.mp4").exists()


def test_reupload_replaces_previous_video(client_a, db_session, isolated_storage):
    _create_and_upload(client_a, "A-RE", "clip.mp4", b"first")
    old_key = db_session.query(Job).filter(Job.job_id == "A-RE").one().storage_key

    res = client_a.post(
        "/upload/",
        data={"job_id": "A-RE"},
        files={"file": ("clip.mp4", io.BytesIO(b"second"), "video/mp4")},
    )
    assert res.status_code == 200

    assert client_a.get("/jobs/A-RE/video").content == b"second"
    assert not (isolated_storage / old_key).exists()


def test_upload_rejected_while_job_is_being_analyzed(client_a, db_session):
    _create_and_upload(client_a, "A-BUSY", "clip.mp4", b"x")

    job = db_session.query(Job).filter(Job.job_id == "A-BUSY").one()
    job.status = "ANALYZING"
    db_session.commit()

    res = client_a.post(
        "/upload/",
        data={"job_id": "A-BUSY"},
        files={"file": ("clip.mp4", io.BytesIO(b"y"), "video/mp4")},
    )
    assert res.status_code == 409


def test_analyze_requires_uploaded_video(client_a):
    client_a.post(
        "/jobs/",
        json={"job_id": "A-NOVID", "job_type": "cleaning", "video_filename": "clip.mp4"},
    )

    res = client_a.post("/analyze/", json={"job_id": "A-NOVID"})
    assert res.status_code == 400

    _create_and_upload(client_a, "A-VID", "clip.mp4", b"x")
    res = client_a.post("/analyze/", json={"job_id": "A-VID"})
    assert res.status_code == 200
    assert res.json()["queue_status"] == "QUEUED"


def test_video_supports_range_requests(client_a):
    _create_and_upload(client_a, "A-RANGE", "clip.mp4", b"0123456789")

    res = client_a.get("/jobs/A-RANGE/video", headers={"Range": "bytes=2-5"})
    assert res.status_code == 206
    assert res.content == b"2345"
