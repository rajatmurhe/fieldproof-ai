import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.models.analysis_job import AnalysisJob  # noqa: F401
from backend.models.audit_log import AuditLog  # noqa: F401
from backend.models.checklist import Checklist  # noqa: F401
from backend.models.job import Job  # noqa: F401
from backend.models.job_finding import JobFinding  # noqa: F401
from backend.models.job_result import JobResult  # noqa: F401
from backend.models.organization import Organization  # noqa: F401
from backend.models.user import User  # noqa: F401

from backend.api_checklists import router as checklists_router
from backend.api_jobs import router as jobs_router
from backend.api_upload import router as upload_router
from backend.api_analyze import router as analyze_router
from backend.api_videos import router as videos_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)

logger = logging.getLogger("fieldproof")

# The schema is owned by Alembic (`alembic upgrade head`), not created at
# import time — importing the app must never touch a database.

_allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost",
    ).split(",")
    if origin.strip()
]

if "*" in _allowed_origins:
    logger.warning(
        "CORS_ALLOWED_ORIGINS contains '*'. Set it to your frontend origin "
        "in production."
    )


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    """
    Optionally run the analysis worker inside the API process.

    Free PaaS tiers (e.g. Render free) don't include separate background
    worker services, and they spin idle services down. Running the worker in
    the API's lifespan ties both to the same process, so the worker is
    supervised, restarted and stopped together with the API. With
    docker-compose, leave this off and run `python -m backend.worker`.
    """
    stop_event = threading.Event()
    worker_thread = None

    if _env_flag("RUN_WORKER_IN_PROCESS"):
        from backend.worker import run_worker

        worker_thread = threading.Thread(
            target=run_worker,
            kwargs={"stop_event": stop_event},
            name="fieldproof-worker",
            daemon=True,
        )
        worker_thread.start()
        logger.info("In-process analysis worker started.")

    yield

    if worker_thread:
        stop_event.set()
        worker_thread.join(timeout=10)


app = FastAPI(
    title="FieldProof AI",
    description="AI-powered field-service video QA platform",
    version="1.0.0",
    lifespan=lifespan,
)

# Auth uses a Bearer token, not cookies, so credentials are not needed.
# This also keeps a wildcard origin from ever being combined with credentials.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs_router)
app.include_router(upload_router)
app.include_router(analyze_router)
app.include_router(videos_router)
app.include_router(checklists_router)


@app.get("/")
def root():
    return {
        "product": "FieldProof AI",
        "status": "running",
        "version": "1.0.0",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "fieldproof-api",
    }


@app.get("/health/db")
def health_db():
    from backend.database.connection import engine as _engine
    from sqlalchemy import text

    try:
        with _engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {
            "status": "connected",
            "database": "postgresql",
        }
    except Exception as exc:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=503,
            detail=f"Database unreachable: {exc}",
        )
