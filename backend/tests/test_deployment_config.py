"""
FieldProof AI — Deployment & Configuration Regression Tests
"""

import importlib
import threading
from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from fastapi.testclient import TestClient

from backend.database.connection import Base

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_requirements_include_multipart():
    """FastAPI Form/File routes crash at import without python-multipart."""
    requirements = (REPO_ROOT / "requirements.txt").read_text().lower()
    assert "python-multipart" in requirements


def test_gemini_models_are_configurable(monkeypatch):
    import backend.services.gemini_service as gemini_service

    monkeypatch.setenv("GEMINI_MODEL", "custom-primary")
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "custom-fallback")
    reloaded = importlib.reload(gemini_service)
    assert reloaded.PRIMARY_MODEL == "custom-primary"
    assert reloaded.FALLBACK_MODEL == "custom-fallback"

    monkeypatch.delenv("GEMINI_MODEL")
    monkeypatch.delenv("GEMINI_FALLBACK_MODEL")
    reloaded = importlib.reload(gemini_service)
    assert not reloaded.PRIMARY_MODEL.startswith("gemini-2.0")


def _alembic_config(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    return Config(str(REPO_ROOT / "alembic.ini"))


def test_migrations_build_fresh_database_matching_models(tmp_path, monkeypatch):
    """`alembic upgrade head` must create the full schema from nothing."""
    db_url = f"sqlite:///{tmp_path / 'fresh.db'}"
    command.upgrade(_alembic_config(db_url, monkeypatch), "head")

    engine = sa.create_engine(db_url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)

    assert diff == []


def test_migrations_upgrade_database_created_by_create_all(tmp_path, monkeypatch):
    """Databases built by the old create_all() path upgrade in place."""
    db_url = f"sqlite:///{tmp_path / 'legacy.db'}"
    engine = sa.create_engine(db_url)
    Base.metadata.create_all(engine)

    with engine.begin() as conn:
        # Simulate the pre-migration schema.
        conn.execute(sa.text("ALTER TABLE jobs DROP COLUMN storage_key"))
        conn.execute(sa.text("ALTER TABLE analysis_jobs DROP COLUMN next_attempt_at"))
        conn.execute(sa.text(
            "INSERT INTO organizations (id, name, slug, created_at) "
            "VALUES (1, 'Org', 'org', CURRENT_TIMESTAMP)"
        ))
        conn.execute(sa.text(
            "INSERT INTO jobs (organization_id, job_id, job_type, video_filename, status, created_at) "
            "VALUES (1, 'OLD-1', 'cleaning', 'old.mp4', 'PASS', CURRENT_TIMESTAMP)"
        ))

    command.upgrade(_alembic_config(db_url, monkeypatch), "head")

    with engine.connect() as conn:
        key = conn.execute(sa.text("SELECT storage_key FROM jobs")).scalar_one()
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)

    # Existing videos in uploads/ keep resolving after the upgrade.
    assert key == "old.mp4"
    assert diff == []


def test_app_import_does_not_create_tables():
    source = (REPO_ROOT / "backend" / "main.py").read_text()
    assert "create_all" not in source


def test_cors_never_allows_credentials():
    from backend.main import app

    cors = next(m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert cors.kwargs["allow_credentials"] is False


def test_in_process_worker_follows_app_lifespan(monkeypatch):
    import backend.main as main
    import backend.worker as worker

    started = threading.Event()
    stopped = threading.Event()

    def fake_run_worker(stop_event):
        started.set()
        stop_event.wait(5)
        stopped.set()

    monkeypatch.setattr(worker, "run_worker", fake_run_worker)
    monkeypatch.setenv("RUN_WORKER_IN_PROCESS", "true")

    with TestClient(main.app):
        assert started.wait(2)
        assert not stopped.is_set()

    assert stopped.wait(2)


def test_worker_not_started_by_default(monkeypatch):
    import backend.main as main
    import backend.worker as worker

    calls = []
    monkeypatch.setattr(worker, "run_worker", lambda **kwargs: calls.append(kwargs))
    monkeypatch.delenv("RUN_WORKER_IN_PROCESS", raising=False)

    with TestClient(main.app):
        pass

    assert calls == []
