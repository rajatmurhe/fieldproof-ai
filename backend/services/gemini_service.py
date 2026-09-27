"""
FieldProof AI — Gemini Video Analysis Service

Analyzes a field-service completion video against a job-type checklist
using Gemini agentic video understanding and produces structured QA output.

Output schema:
  - PASS / FAIL / NOT_VISIBLE per checklist item
  - Confidence (0–1)
  - Evidence timestamp (or null if not observable)
  - Short reason
  - Overall status: PASS only when every check passes, else REVIEW

Key design principles:
  - NOT_VISIBLE ≠ FAIL (missing evidence surfaces for human review)
  - Structured JSON output validated via Pydantic
  - Primary model → fallback model on quota/transient error
  - Retry with backoff for transient 503 errors
"""

import logging
import time
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from google import genai
from pydantic import BaseModel, Field

load_dotenv()

logger = logging.getLogger("fieldproof.gemini")

# Prefer the most capable model; fall back to lite if daily quota is exhausted.
PRIMARY_MODEL = "gemini-2.0-flash"
FALLBACK_MODEL = "gemini-2.0-flash-lite"


class CheckResult(BaseModel):
    check: str
    status: Literal["PASS", "FAIL", "NOT_VISIBLE"]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_timestamp: str | None = None
    reason: str


class QAResult(BaseModel):
    overall_status: Literal["PASS", "REVIEW"]
    checks: list[CheckResult]


def _is_daily_quota_error(error_text: str) -> bool:
    return (
        "requests per day" in error_text
        or "per day on free tier" in error_text
        or "generate_requests_per_day" in error_text
        or "too_many_requests" in error_text
        or "quota" in error_text
    )


def _is_transient_error(error_text: str) -> bool:
    return (
        "503" in error_text
        or "service_unavailable" in error_text
        or "currently experiencing high demand" in error_text
        or "temporarily unavailable" in error_text
        or "internal error" in error_text
    )


def analyze_video(
    video_path: str,
    job_type: str,
    checklist: list[str],
) -> tuple[QAResult, str]:
    """
    Analyze a field-service completion video against a checklist.

    Args:
        video_path: Absolute or relative path to the video file.
        job_type: Job type label (e.g. "cleaning", "hvac").
        checklist: List of observable check descriptions.

    Returns:
        Tuple of (QAResult, model_name_used).

    Raises:
        FileNotFoundError: If the video file does not exist.
        ValueError: If the checklist is empty.
        RuntimeError: If Gemini analysis fails on all attempts.
    """
    video_file_path = Path(video_path)

    if not video_file_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_file_path}")

    if not checklist:
        raise ValueError(
            f"Checklist is empty for job type '{job_type}'. "
            "Configure checklist items before running analysis."
        )

    client = genai.Client()

    logger.info(
        "Uploading video to Gemini Files API: %s (%.1f MB)",
        video_file_path.name,
        video_file_path.stat().st_size / (1024 * 1024),
    )

    video_file = client.files.upload(file=str(video_file_path))

    # Wait for Gemini to finish processing the video file.
    poll_attempts = 0
    while not video_file.state or video_file.state.name != "ACTIVE":
        poll_attempts += 1
        logger.info(
            "Waiting for Gemini video processing... (attempt %d, state=%s)",
            poll_attempts,
            getattr(video_file.state, "name", "UNKNOWN") if video_file.state else "UNKNOWN",
        )

        time.sleep(5)

        video_file = client.files.get(name=video_file.name)

        if video_file.state and video_file.state.name == "FAILED":
            raise RuntimeError(
                f"Gemini rejected the video file '{video_file_path.name}'. "
                "Check that the file is a supported format and not corrupted."
            )

    logger.info("Video ready for analysis: %s", video_file.name)

    checklist_text = "\n".join(
        f"{idx + 1}. {item}" for idx, item in enumerate(checklist)
    )

    prompt = f"""You are a field-service quality assurance system.

Job type: {job_type}

Evaluate the video against these required checks:

{checklist_text}

For every check, determine whether the video provides sufficient visual evidence
to evaluate it, then assign the appropriate status:

PASS:
  Use ONLY when visible evidence in the video clearly confirms the requirement
  was completed. You must be able to describe what you saw.

FAIL:
  Use ONLY when visible evidence in the video clearly shows the requirement
  was NOT satisfied. You must be able to describe what you observed.

NOT_VISIBLE:
  Use when the video does not show sufficient evidence to verify the
  requirement in either direction. This is NOT a failure — it means
  a human reviewer must decide.

IMPORTANT: Do NOT invent evidence. Do NOT convert "I can't see it" into FAIL.
If you cannot observe the required element, use NOT_VISIBLE.

For each check return:
  - check: the exact check text from above
  - status: PASS, FAIL, or NOT_VISIBLE
  - confidence: a float from 0.0 to 1.0 reflecting your certainty
  - evidence_timestamp: the video timestamp where you observed the evidence,
    formatted as MM:SS or HH:MM:SS, or null if no specific timestamp applies
  - reason: a concise one-to-two sentence explanation of your determination

Overall status:
  - PASS: only when every single check is PASS
  - REVIEW: in all other cases (any FAIL or NOT_VISIBLE requires human review)
"""

    schema = QAResult.model_json_schema()

    def run_interaction(model_name: str):
        return client.interactions.create(
            model=model_name,
            input=[
                {
                    "type": "video",
                    "uri": video_file.uri,
                    "mime_type": video_file.mime_type,
                    "processing": "agentic",
                },
                {
                    "type": "text",
                    "text": prompt,
                },
            ],
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": schema,
            },
        )

    interaction = None
    active_model = PRIMARY_MODEL

    logger.info("Starting agentic video analysis with %s", PRIMARY_MODEL)

    try:
        for attempt, delay in enumerate([5, 15, 30]):
            try:
                interaction = run_interaction(PRIMARY_MODEL)
                active_model = PRIMARY_MODEL
                break

            except Exception as exc:
                error_text = str(exc).lower()

                if _is_daily_quota_error(error_text):
                    logger.warning(
                        "Daily quota reached for %s; switching to %s.",
                        PRIMARY_MODEL,
                        FALLBACK_MODEL,
                    )
                    break

                if _is_transient_error(error_text) and attempt < 2:
                    logger.warning(
                        "Transient error from Gemini (attempt %d/3). "
                        "Retrying in %ds: %s",
                        attempt + 1,
                        delay,
                        exc,
                    )
                    time.sleep(delay)
                    continue

                raise

        if interaction is None:
            active_model = FALLBACK_MODEL
            logger.info("Running fallback model: %s", FALLBACK_MODEL)
            interaction = run_interaction(FALLBACK_MODEL)

    except Exception as exc:
        raise RuntimeError(
            f"Gemini analysis failed (model={active_model}): {exc}"
        ) from exc

    logger.info("Gemini analysis completed using %s.", active_model)

    result = QAResult.model_validate_json(interaction.output_text)

    pass_count = sum(1 for c in result.checks if c.status == "PASS")
    fail_count = sum(1 for c in result.checks if c.status == "FAIL")
    not_visible_count = sum(
        1 for c in result.checks if c.status == "NOT_VISIBLE"
    )

    logger.info(
        "QA result: overall=%s pass=%d fail=%d not_visible=%d model=%s",
        result.overall_status,
        pass_count,
        fail_count,
        not_visible_count,
        active_model,
    )

    return result, active_model
