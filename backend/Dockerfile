FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (for psycopg2 if needed)
RUN apt-get update && apt-get install -y gcc libpq-dev && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code
COPY backend/ ./backend/
COPY start.sh .

# Set Python path so imports work
ENV PYTHONPATH=/app

# Expose the FastAPI port
EXPOSE 8000

# Default command (can be overridden by docker-compose or platform)
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
