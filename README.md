# 🛡️ FieldProof AI

> **Automated AI Video Quality Assurance for Field-Service Operations**

FieldProof AI is an AI-powered video quality assurance (QA) and compliance platform designed for field-service and home-service operations (cleaning, HVAC, plumbing, general facilities maintenance).

Technicians record job-completion walkthrough videos. FieldProof AI analyzes the raw video stream against service-specific checklists using **Gemini Agentic Video Understanding**, producing structured evidence determinations with timestamps, confidence scores, and concise rationales.


![Python](https://img.shields.io/badge/Python_3.11-14354C?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Gemini](https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=google&logoColor=white)


<div align="center">
  <img src="photos/dashboard.png" alt="FieldProof AI Dashboard" width="100%">
</div>

## 📸 Platform Walkthrough

<details open>
<summary><b>1. Operational Analytics & Dashboard</b></summary>
<br>
Get real-time insights into verification volume, pipeline status, and human review bottlenecks.
<img src="photos/one.png" alt="Analytics" width="100%">
</details>

<details>
<summary><b>2. Jobs Management</b></summary>
<br>
Track all field verifications across your organization with advanced filtering and real-time status updates.
<img src="photos/two.png" alt="Jobs List" width="100%">
</details>

<details>
<summary><b>3. Job Creation & Video Upload</b></summary>
<br>
Seamlessly create jobs, select service types, and upload completion videos.
<img src="photos/three.png" alt="Create Job" width="100%">
</details>

<details>
<summary><b>4. AI Analysis & Processing</b></summary>
<br>
Videos are processed asynchronously using Gemini 2.0 Flash agentic vision.
<img src="photos/four.png" alt="Processing" width="100%">
</details>

<details>
<summary><b>5. Results & Human-in-the-Loop Review</b></summary>
<br>
View findings with exact video timestamps. Click a timestamp to jump directly to the evidence in the video player.
<img src="photos/five.png" alt="Results and Review" width="100%">
</details>

<details>
<summary><b>6. Dynamic Checklists</b></summary>
<br>
Configure custom verification criteria tailored to specific service types (Cleaning, HVAC, Plumbing, etc.).
<img src="photos/six.png" alt="Checklists" width="100%">
</details>

---

## The Core Product Principle: `NOT_VISIBLE ≠ FAIL`

In real-world field services, video cameras may miss an angle, lighting may be dim, or a technician might move quickly past a corner. 

A naive LLM prompt might hallucinate compliance or falsely fail a job due to missing visual evidence. FieldProof AI enforces a strict three-state determination model:

1. **`PASS`**: Clear, unambiguous visible visual evidence in the video confirms the criteria was met.
2. **`FAIL`**: Visible visual evidence directly confirms the requirement was violated or left incomplete.
3. **`NOT_VISIBLE`**: The camera did not capture sufficient evidence to make a definitive determination.

**`NOT_VISIBLE` is never converted to `FAIL`.** Instead, any non-pass criterion automatically sets the job status to **`REVIEW`**, surfacing the video and evidence timestamps to human operations reviewers for a final binding decision.

---

## High-Level Architecture

```
Field Technician
      │ (Uploads completion video)
      ▼
Next.js App Router (Frontend)
      │
      │ REST API (Bearer Session Token via Clerk)
      ▼
FastAPI Application Backend (Python 3.11)
      │
      ├─► PostgreSQL 16 (Multi-tenant jobs, checklists, audit logs)
      └─► Video Storage (`uploads/`)
            │
            │ (Enqueues job in `analysis_jobs` table)
            ▼
Asynchronous Background Worker (`backend/worker.py`)
      │
      │ Atomic claim: `SELECT FOR UPDATE SKIP LOCKED`
      ▼
Google Gemini Agentic Video Pipeline (`backend/services/gemini_service.py`)
      │
      ├─► Model: Gemini 2.0 Flash (Primary) / Gemini 2.0 Flash-Lite (Fallback)
      ├─► Agentic video temporal analysis
      └─► Pydantic-validated JSON Schema Output
            │
            │ (Persists JobResult + JobFinding rows)
            ▼
PostgreSQL Result Storage ──► Sets Status: `PASS` or `REVIEW`
            │
            ▼
Human-in-the-Loop Review Console (`/reviews`)
      │
      ├─► Interactive timestamp video seek
      └─► Reviewer Decision: `APPROVED` or `REJECTED` + Immutable Audit Trail
```

---

## Key Features

- **Multi-Tenant SaaS Isolation**: Built from the ground up for B2B multi-tenancy. Organization scoping is strictly enforced server-side. Users from Organization A cannot view, inspect, or review jobs, videos, or checklists belonging to Organization B.
- **Asynchronous Fire-and-Forget Architecture**: Video analysis (7–8 minutes) runs completely decoupled in background workers. Technicians and operators can submit a job, navigate away, close the browser, and return later. State is fully persistent in PostgreSQL.
- **Interactive Video Evidence Seeking**: Clicking any finding's evidence timestamp (e.g. `00:45`, `01:12`) automatically seeks the video player to that exact frame, dramatically accelerating human review.
- **Worker Concurrency & Resilience**:
  - `WITH FOR UPDATE SKIP LOCKED` prevents race conditions between concurrent worker processes.
  - Automatic stale job recovery: workers identify abandoned `PROCESSING` jobs (>30m) and safely re-queue them.
  - Maximum retry thresholding prevents poison-pill jobs from consuming compute indefinitely.
- **Dynamic Organization Checklists**: Operations managers can configure custom verification criteria per service type (`cleaning`, `hvac`, `plumbing`, `maintenance`), complete with template presets.
- **Complete Audit Trail**: Every job lifecycle transition (`JOB_CREATED`, `ANALYSIS_QUEUED`, `AI_ANALYSIS_STARTED`, `AI_ANALYSIS_COMPLETED`, `HUMAN_REVIEW`) is recorded in an immutable audit ledger with timestamps, actors, and detailed event payloads.
- **Operational Analytics Dashboard**: Real-time KPI visibility into total verification volume, human review escalation rates, active pipeline queues, and service type workload distribution.

---

## Tech Stack

### Frontend
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS v4
- **Authentication**: Clerk (`@clerk/nextjs`)
- **State/Data**: Server-backed REST API with smart polling

### Backend
- **Framework**: FastAPI (Python 3.11)
- **Database ORM**: SQLAlchemy 2.0
- **Database Driver**: `psycopg2-binary`
- **Validation**: Pydantic v2
- **Auth Verification**: Clerk Backend SDK (`clerk-backend-api`)
- **Migrations**: Alembic 1.14+
- **Testing**: Pytest & `pytest-asyncio`

### AI & Media
- **Model**: Google Gemini 2.0 Flash (`gemini-2.0-flash`), Gemini 2.0 Flash-Lite (`gemini-2.0-flash-lite`)
- **SDK**: Google GenAI SDK (`google-genai`)
- **Mode**: Agentic video temporal understanding with Pydantic JSON schema constraints

---

## Database Schema Overview

| Table | Purpose | Multi-Tenancy Scope |
|---|---|---|
| `organizations` | Tenant identity, name, slug, Clerk Org ID mapping | Top-level tenant |
| `users` | Synced Clerk users with roles (`ADMIN`, `REVIEWER`) | `organization_id` foreign key |
| `jobs` | Job records with unique `(organization_id, job_id)` index | Scoped to organization |
| `analysis_jobs` | Background queue items tracking status, attempts, errors | Scoped to job |
| `job_results` | Overall AI determination and model metadata | Scoped to job |
| `job_findings` | Individual checklist criterion findings, confidence, and timestamps | Scoped to job result |
| `checklists` | Service-type criteria list with unique `(organization_id, job_type)` index | Scoped to organization |
| `audit_logs` | Immutable event stream for compliance | Scoped to organization & job |

---

## Local Development Setup

### Prerequisites
- Python 3.11+
- Node.js 18+ & npm
- PostgreSQL 14+ running locally (or via Docker)
- Gemini API Key ([Google AI Studio](https://aistudio.google.com/))
- Clerk Application ([Clerk Dashboard](https://clerk.com/))

### 1. Environment Configuration

Create `.env` in the repository root:
```env
# Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Clerk Backend Authentication
CLERK_SECRET_KEY=sk_test_...
CLERK_AUTHORIZED_PARTIES=http://localhost:3000

# PostgreSQL Connection String
DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/fieldproof

# CORS Allowed Origins
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/

NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 2. Backend Setup

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run database migrations
alembic upgrade head

# Start FastAPI server
uvicorn backend.main:app --reload --port 8000
```

### 3. Background Worker Setup

In a separate terminal window:
```bash
source .venv/bin/activate

# Start the analysis queue worker
python -m backend.worker
```

### 4. Frontend Setup

In a separate terminal window:
```bash
cd frontend

# Install npm packages
npm install

# Start development server
npm run dev
```

The application is now live at [http://localhost:3000](http://localhost:3000).

---

## Running the Automated Test Suite

FieldProof AI includes an automated test suite covering multi-tenancy isolation, API validation, worker resilience, and upload security:

```bash
source .venv/bin/activate

# Run all tests
pytest backend/tests -v
```

Test coverage includes:
- **`test_multi_tenancy.py`**: Strict cross-tenant boundaries, cross-org job ID deduplication, and unauthorized review prevention.
- **`test_jobs_api.py`**: Idempotent creation, input validation, status aggregation, review lifecycle.
- **`test_checklists_api.py`**: Template auto-seeding, custom checklist CRUD, slug validation.
- **`test_worker_resilience.py`**: Atomic concurrent claiming, stale processing recovery, and max attempt caps.
- **`test_upload_validation.py`**: Path traversal blocking, file extension enforcement, and cross-tenant video streaming prevention.

---

## Production Deployment Considerations

1. **Object Storage**: For cloud deployment (AWS/GCP), replace local disk storage (`uploads/`) with Amazon S3 or Google Cloud Storage using presigned upload URLs.
2. **Worker Scaling**: The worker is designed for horizontal scaling. Multiple worker containers can run simultaneously on ECS, Cloud Run, or Kubernetes, safely claiming jobs via `SKIP LOCKED`.
3. **Database Connection Pooling**: In production with multiple worker replicas, use PgBouncer or Supabase connection pooling to manage PostgreSQL connections.
4. **Rate Limits & Quota**: Gemini 2.0 Flash supports high throughput; the service includes automatic fallback to `gemini-2.0-flash-lite` and exponential backoff for 503 transient errors.

---

## License

Proprietary — Developed for Field-Service Quality Assurance Operations.
