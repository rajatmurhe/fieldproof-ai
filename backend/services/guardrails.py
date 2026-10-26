"""
FieldProof AI — deterministic guardrails on model output

The model's reply is treated as a draft. Everything that can be decided in
code is decided here, so a bad generation can never change what was asked or
quietly upgrade a verdict:

  - Findings map 1:1 onto the checklist by check_id. Missing criteria become
    NOT_VISIBLE, duplicates and unknown ids are dropped, and the stored check
    text is always the checklist's own wording.
  - Evidence timestamps must parse and fall inside the video.
  - PASS/FAIL below the confidence threshold becomes NOT_VISIBLE, so a person
    decides instead of a guess.
  - The overall status is computed here, never taken from the model.

Every rule that fires is recorded as a GuardrailEvent, stored with the result
and counted on the analytics page.
"""

import os
import re
from dataclasses import asdict, dataclass
from typing import Literal

from pydantic import BaseModel, Field

# Bumped whenever the prompt or the output schema changes, so stored results
# say which instructions produced them.
PROMPT_VERSION = "qa-v2"

DEFAULT_MIN_CONFIDENCE = 0.5

# Allowance for rounding between the model's timestamps and the file's duration.
TIMESTAMP_TOLERANCE_SECONDS = 1.0

Status = Literal["PASS", "FAIL", "NOT_VISIBLE"]

EVENT_TYPES = (
    "missing_check",
    "duplicate_check",
    "unknown_check",
    "invalid_timestamp",
    "timestamp_out_of_range",
    "low_confidence",
    "overall_status_overridden",
    "schema_repaired",
    "schema_fallback",
)


class ModelCheck(BaseModel):
    """One finding as the model returns it."""

    check_id: int
    check: str = ""
    status: Status
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_timestamp: str | None = None
    reason: str = ""


class ModelOutput(BaseModel):
    """The model's whole reply. overall_status is only kept to detect disagreement."""

    checks: list[ModelCheck]
    overall_status: Literal["PASS", "REVIEW"] | None = None


class CheckResult(BaseModel):
    check: str
    status: Status
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_timestamp: str | None = None
    reason: str


class QAResult(BaseModel):
    overall_status: Literal["PASS", "REVIEW"]
    checks: list[CheckResult]


@dataclass
class GuardrailEvent:
    type: str
    detail: str
    check_order: int | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def min_confidence() -> float:
    try:
        value = float(os.getenv("GUARDRAIL_MIN_CONFIDENCE", DEFAULT_MIN_CONFIDENCE))
    except ValueError:
        return DEFAULT_MIN_CONFIDENCE
    return min(max(value, 0.0), 1.0)


_TIMESTAMP = re.compile(r"^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:\.\d+)?$")


def parse_timestamp(value: str) -> float | None:
    """Seconds for MM:SS or HH:MM:SS (optionally with a fraction), else None."""
    match = _TIMESTAMP.match(value.strip())
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    if int(seconds) >= 60 or (hours is not None and int(minutes) >= 60):
        return None
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds)


def overall_status(checks: list[CheckResult]) -> Literal["PASS", "REVIEW"]:
    return "PASS" if checks and all(c.status == "PASS" for c in checks) else "REVIEW"


def not_visible(check: str, reason: str) -> CheckResult:
    return CheckResult(check=check, status="NOT_VISIBLE", confidence=0.0, reason=reason)


def fallback_result(checklist: list[str], reason: str) -> QAResult:
    """Every criterion NOT_VISIBLE, for when no usable model output exists."""
    checks = [not_visible(item, reason) for item in checklist]
    return QAResult(overall_status=overall_status(checks), checks=checks)


def apply_guardrails(
    output: ModelOutput,
    checklist: list[str],
    video_duration_seconds: float | None = None,
    confidence_threshold: float | None = None,
) -> tuple[QAResult, list[GuardrailEvent]]:
    threshold = min_confidence() if confidence_threshold is None else confidence_threshold
    events: list[GuardrailEvent] = []

    by_id: dict[int, ModelCheck] = {}
    for item in output.checks:
        if not 1 <= item.check_id <= len(checklist):
            events.append(GuardrailEvent("unknown_check", f"Dropped finding for check_id {item.check_id}."))
        elif item.check_id in by_id:
            events.append(
                GuardrailEvent("duplicate_check", "Dropped a second finding for this criterion.", item.check_id)
            )
        else:
            by_id[item.check_id] = item

    checks: list[CheckResult] = []
    for order, text in enumerate(checklist, start=1):
        item = by_id.get(order)
        if item is None:
            events.append(GuardrailEvent("missing_check", "The model returned no finding for this criterion.", order))
            checks.append(not_visible(text, "The model returned no finding for this criterion."))
            continue

        status: Status = item.status
        reason = item.reason.strip() or "No reason given."
        timestamp = item.evidence_timestamp.strip() if item.evidence_timestamp else None

        if timestamp:
            seconds = parse_timestamp(timestamp)
            if seconds is None:
                events.append(GuardrailEvent("invalid_timestamp", f"Discarded unreadable timestamp '{timestamp}'.", order))
                timestamp = None
            elif (
                video_duration_seconds is not None
                and seconds > video_duration_seconds + TIMESTAMP_TOLERANCE_SECONDS
            ):
                events.append(
                    GuardrailEvent(
                        "timestamp_out_of_range",
                        f"Discarded {timestamp}; the video is {video_duration_seconds:.0f}s long.",
                        order,
                    )
                )
                timestamp = None

        if status != "NOT_VISIBLE" and item.confidence < threshold:
            events.append(
                GuardrailEvent(
                    "low_confidence",
                    f"{status} at {item.confidence:.2f} confidence is below {threshold:.2f}; sent to review.",
                    order,
                )
            )
            reason = f"Low confidence ({item.confidence:.2f}), model said {status}: {reason}"
            status = "NOT_VISIBLE"

        checks.append(
            CheckResult(
                check=text,
                status=status,
                confidence=item.confidence,
                evidence_timestamp=timestamp,
                reason=reason,
            )
        )

    computed = overall_status(checks)
    if output.overall_status is not None and output.overall_status != computed:
        events.append(
            GuardrailEvent(
                "overall_status_overridden",
                f"Model said {output.overall_status}; the findings give {computed}.",
            )
        )

    return QAResult(overall_status=computed, checks=checks), events
