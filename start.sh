#!/bin/bash
# Start the background worker process
python -m backend.worker &

# Start the FastAPI web server
uvicorn backend.main:app --host 0.0.0.0 --port $PORT
