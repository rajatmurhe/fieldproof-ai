"""
FieldProof AI — Gemini Video Analysis Standalone Verification Script

Usage:
    python test_gemini.py [video_path] [job_type]
"""

import sys
from pathlib import Path
from backend.services.gemini_service import analyze_video

DEFAULT_VIDEO = "uploads/JOB-1046-cleaning.mp4"
DEFAULT_TYPE = "cleaning"

DEFAULT_CHECKS = [
    "Floor area is visibly clean and free of dirt.",
    "No visible trash or debris remains on the floor.",
    "Basin and sink surfaces are visibly sanitized.",
    "Tap fixtures and surrounding counter area are wiped down.",
    "Surrounding work surfaces are visibly clean.",
    "Under-furniture area is inspected.",
]


def main():
    video_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VIDEO
    job_type = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_TYPE

    if not Path(video_path).exists():
        print(f"Error: Video file '{video_path}' does not exist.")
        sys.exit(1)

    print(f"Running Gemini video QA on '{video_path}' for job type '{job_type}'...")
    analysis = analyze_video(video_path, job_type, DEFAULT_CHECKS)
    result = analysis.result

    print(f"\n===== QA RESULT (Model: {analysis.model_name}, prompt {analysis.prompt_version}) =====")
    print(f"Overall Status: {result.overall_status}")
    print("\nDetailed Findings:")
    for idx, c in enumerate(result.checks, 1):
        ts = f" @ {c.evidence_timestamp}" if c.evidence_timestamp else ""
        print(f"  {idx}. [{c.status}] ({int(c.confidence*100)}%{ts}) {c.check}")
        print(f"     Reason: {c.reason}")

    if analysis.guardrail_events:
        print("\nGuardrails fired:")
        for event in analysis.guardrail_events:
            where = f" (check {event.check_order})" if event.check_order else ""
            print(f"  - {event.type}{where}: {event.detail}")


if __name__ == "__main__":
    main()
