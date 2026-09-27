"""
FieldProof AI — Checklist Management API

Manages job-type checklists per organization.

Checklists define the specific criteria that Gemini evaluates when analyzing
a field-service completion video. NOT_VISIBLE criteria require human review.
"""

import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.auth import get_current_user
from backend.database.connection import get_db
from backend.models.checklist import Checklist
from backend.models.user import User

logger = logging.getLogger("fieldproof.api.checklists")

router = APIRouter(
    prefix="/checklists",
    tags=["Checklists"],
)

JOB_TYPE_PATTERN = re.compile(r"^[a-z0-9_-]+$")

DEFAULT_TEMPLATES: dict[str, list[str]] = {
    "cleaning": [
        "Floor area is visibly clean and free of dirt.",
        "No visible trash or debris remains on the floor.",
        "Basin and sink surfaces are visibly sanitized.",
        "Tap fixtures and surrounding counter area are wiped down.",
        "Surrounding work surfaces and mirrors are visibly clean.",
        "Under-furniture and corners were thoroughly inspected.",
    ],
    "hvac": [
        "Condenser coils and fins are clean and unobstructed.",
        "Refrigerant line insulation is intact without cracks.",
        "Electrical disconnect box is securely closed and mounted.",
        "Air filter is newly installed with correct airflow direction.",
        "Drain line has clear condensate flow with no leaks.",
        "Thermostat controls respond properly to temperature setpoint.",
    ],
    "maintenance": [
        "Work area is clean and free of leftover debris or packaging.",
        "Safety covers and protective panels are securely re-fastened.",
        "No fluid leaks or uncontained spills around the unit.",
        "All warning and identification labels are clearly visible.",
        "Tools and testing equipment have been packed away.",
    ],
    "plumbing": [
        "All pipe joints and fittings show no visible moisture or leaks.",
        "Shut-off valves operate smoothly and are in correct operating position.",
        "Drain fixtures demonstrate proper drainage without backup or slow flow.",
        "Surrounding walls and subfloor are dry and undamaged.",
        "Water pressure test completed with no vibration or hammer.",
    ],
}


class ChecklistUpdate(BaseModel):
    checks: list[str] = Field(
        min_length=1,
        max_length=30,
    )


class ChecklistCreate(BaseModel):
    job_type: str
    checks: list[str] = Field(
        min_length=1,
        max_length=30,
    )


def validate_job_type(job_type: str) -> str:
    cleaned = job_type.strip()
    if not JOB_TYPE_PATTERN.fullmatch(cleaned):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid job type format. Job types must use only lowercase "
                "alphanumeric characters, hyphens, and underscores (e.g. 'hvac', 'deep_cleaning')."
            ),
        )
    return cleaned


def clean_checks(checks: list[str]) -> list[str]:
    cleaned: list[str] = []

    for check in checks:
        value = check.strip()

        if not value:
            continue

        if len(value) > 250:
            raise HTTPException(
                status_code=400,
                detail="Checklist items must be 250 characters or less.",
            )

        if value not in cleaned:
            cleaned.append(value)

    if not cleaned:
        raise HTTPException(
            status_code=400,
            detail="At least one checklist item is required.",
        )

    return cleaned


def _seed_defaults_for_org(db: Session, organization_id: int):
    """Seed standard default checklists if the organization has none."""
    for job_type, checks in DEFAULT_TEMPLATES.items():
        existing = (
            db.query(Checklist)
            .filter(
                Checklist.organization_id == organization_id,
                Checklist.job_type == job_type,
            )
            .first()
        )
        if not existing:
            db.add(
                Checklist(
                    organization_id=organization_id,
                    job_type=job_type,
                    checks=checks,
                )
            )
    db.commit()


@router.get("/")
def list_checklists(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    checklists = (
        db.query(Checklist)
        .filter(Checklist.organization_id == current_user.organization_id)
        .order_by(Checklist.job_type.asc())
        .all()
    )

    # Auto-seed standard templates if this organization has none yet
    if not checklists:
        _seed_defaults_for_org(db, current_user.organization_id)
        checklists = (
            db.query(Checklist)
            .filter(Checklist.organization_id == current_user.organization_id)
            .order_by(Checklist.job_type.asc())
            .all()
        )

    return [
        {
            "job_type": checklist.job_type,
            "checks": checklist.checks,
            "count": len(checklist.checks),
        }
        for checklist in checklists
    ]


@router.get("/{job_type}")
def get_checklist(
    job_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job_type = validate_job_type(job_type)

    checklist = (
        db.query(Checklist)
        .filter(
            Checklist.organization_id == current_user.organization_id,
            Checklist.job_type == job_type,
        )
        .first()
    )

    if not checklist:
        # Check if we have a template for this job_type
        if job_type in DEFAULT_TEMPLATES:
            checklist = Checklist(
                organization_id=current_user.organization_id,
                job_type=job_type,
                checks=DEFAULT_TEMPLATES[job_type],
            )
            db.add(checklist)
            db.commit()
            db.refresh(checklist)
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Checklist not found for job type: {job_type}",
            )

    return {
        "job_type": checklist.job_type,
        "checks": checklist.checks,
        "count": len(checklist.checks),
    }


@router.post("/")
def create_checklist(
    checklist_data: ChecklistCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job_type = validate_job_type(checklist_data.job_type)
    checks = clean_checks(checklist_data.checks)

    existing = (
        db.query(Checklist)
        .filter(
            Checklist.organization_id == current_user.organization_id,
            Checklist.job_type == job_type,
        )
        .first()
    )

    if existing:
        existing.checks = checks
        checklist = existing
    else:
        checklist = Checklist(
            organization_id=current_user.organization_id,
            job_type=job_type,
            checks=checks,
        )
        db.add(checklist)

    db.commit()
    db.refresh(checklist)

    logger.info(
        "Checklist created/updated: org=%d job_type=%s count=%d by=%s",
        current_user.organization_id,
        job_type,
        len(checks),
        current_user.email,
    )

    return {
        "job_type": checklist.job_type,
        "checks": checklist.checks,
        "count": len(checklist.checks),
        "status": "created",
    }


@router.put("/{job_type}")
def update_checklist(
    job_type: str,
    checklist_data: ChecklistUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job_type = validate_job_type(job_type)
    checks = clean_checks(checklist_data.checks)

    checklist = (
        db.query(Checklist)
        .filter(
            Checklist.organization_id == current_user.organization_id,
            Checklist.job_type == job_type,
        )
        .first()
    )

    if checklist:
        checklist.checks = checks
    else:
        checklist = Checklist(
            organization_id=current_user.organization_id,
            job_type=job_type,
            checks=checks,
        )
        db.add(checklist)

    db.commit()
    db.refresh(checklist)

    logger.info(
        "Checklist saved: org=%d job_type=%s count=%d by=%s",
        current_user.organization_id,
        job_type,
        len(checks),
        current_user.email,
    )

    return {
        "job_type": checklist.job_type,
        "checks": checklist.checks,
        "count": len(checklist.checks),
        "status": "saved",
    }


@router.delete("/{job_type}")
def delete_checklist(
    job_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job_type = validate_job_type(job_type)

    checklist = (
        db.query(Checklist)
        .filter(
            Checklist.organization_id == current_user.organization_id,
            Checklist.job_type == job_type,
        )
        .first()
    )

    if not checklist:
        raise HTTPException(
            status_code=404,
            detail=f"Checklist not found: {job_type}",
        )

    db.delete(checklist)
    db.commit()

    logger.info(
        "Checklist deleted: org=%d job_type=%s by=%s",
        current_user.organization_id,
        job_type,
        current_user.email,
    )

    return {
        "job_type": job_type,
        "status": "deleted",
    }
