import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database.connection import Base, engine
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

Base.metadata.create_all(bind=engine)

_allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost",
    ).split(",")
    if origin.strip()
]

app = FastAPI(
    title="FieldProof AI",
    description="AI-powered field-service video QA platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
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
