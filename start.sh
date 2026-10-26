#!/bin/bash
set -e

# Apply database migrations (idempotent).
alembic upgrade head

# The analysis worker runs inside the API process (RUN_WORKER_IN_PROCESS=true)
# so it shares the API's lifecycle on free hosting tiers.
exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
