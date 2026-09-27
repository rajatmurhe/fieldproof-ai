# 🛡️ FieldProof AI

> **AI-powered video QA for field-service operations — automatically verify job-completion evidence and escalate uncertainty to humans.**

FieldProof AI is a multi-tenant SaaS platform for **field-service and home-service operations** such as cleaning, HVAC, plumbing, and facilities maintenance.

Technicians submit job-completion videos. FieldProof AI evaluates the video against a **service-specific checklist** using Gemini's multimodal video understanding capabilities, converts the visual evidence into structured QA findings, and routes uncertain cases to a human reviewer.

The goal is simple:

**Don't make operations teams watch every video. Make them review only the evidence that matters.**

---

## ✨ Why FieldProof AI?

Traditional field-service QA often depends on supervisors manually watching technician videos to verify that a job was actually completed correctly.

That creates three problems:

- High review effort
- Slow verification turnaround
- Inconsistent human inspection

FieldProof AI introduces an AI-assisted verification pipeline:

```text
Technician Video
       ↓
Job + Service Checklist
       ↓
Asynchronous AI Analysis
       ↓
Structured Visual Evidence
       ↓
PASS / FAIL / NOT_VISIBLE
       ↓
Human Review when evidence is insufficient
       ↓
Final operational decision + audit trail
````

The platform is designed around **AI-assisted verification, not blind automation**.

---

# 🎯 Core Product Principle

## `NOT_VISIBLE ≠ FAIL`

This is the central design decision in FieldProof AI.

A video can fail to prove that something happened without proving that it did not happen.

For example:

* the technician may not show a corner of the room
* the camera may move too quickly
* lighting may obscure an area
* an object may remain outside the camera frame

Instead of forcing the AI to guess, FieldProof AI uses three evidence states:

| Status        | Meaning                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `PASS`        | The video contains clear visual evidence that the requirement was satisfied |
| `FAIL`        | The video contains visible evidence that the requirement was violated       |
| `NOT_VISIBLE` | The video does not contain enough evidence to make a reliable determination |

`NOT_VISIBLE` is therefore surfaced for **human review** instead of being silently converted into failure. The README's current design documents this same three-state model and the automatic escalation to `REVIEW`. 

This gives the system a practical human-in-the-loop workflow:

```text
AI is confident
      ↓
PASS
      │
      └──────────────┐
                     │
AI sees failure ───→ FAIL ──→ REVIEW
                     │
AI cannot determine │
                     ↓
               NOT_VISIBLE
                     ↓
              Human Review
```

---

# 🖥️ Product Walkthrough

## 1. Operations Dashboard

The dashboard gives operations teams a high-level view of the QA pipeline.

It surfaces:

* jobs requiring human review
* active AI analysis jobs
* verified/completed jobs
* total jobs tracked
* recent service submissions
* review queue entry points

The dashboard is designed around **operational attention**, not just raw database statistics.

![Operations Dashboard](photos/dashboard.png)

---

## 2. Jobs Management

The Jobs view acts as the operational register for technician submissions.

Operators can:

* search by Job ID, video, or service
* filter by QA status
* filter by service type
* inspect individual jobs
* see the submitted video associated with each job
* track the final QA state

This gives teams one place to monitor their complete verification workload.

![Field Service Jobs](photos/one.png)

---

## 3. Create a QA Job

A new QA job captures:

* Job identifier
* Service type
* associated checklist
* technician completion video

The service type determines which verification criteria will be applied during AI analysis.

This creates a clean data contract between the **operational job** and the **AI QA pipeline**.

![Create New QA Job](photos/five.png)

---

## 4. Dynamic QA Checklists

Operations teams can define their own verification criteria instead of hard-coding one universal prompt.

The checklist interface supports:

* creating service types
* adding requirements
* removing requirements
* editing criteria
* template presets
* domain-specific inspection rules

Examples shown in the product include:

* Cleaning
* HVAC
* Maintenance
* Plumbing
* Electrical

The screenshot demonstrates a seven-item Cleaning checklist covering requirements such as floor cleanliness, trash removal, basin condition, surrounding areas, under-furniture inspection, and mirror inspection.

![Cleaning Checklist](photos/three.png)

### Why this matters

The AI does not simply answer:

> "Is this video good?"

It answers:

> "Does the video provide evidence for each operational requirement?"

That makes the system much closer to a real QA product than a generic video chatbot.

---

# 🤖 AI Video Analysis

Once a technician video is submitted, FieldProof AI places the analysis request into a persistent PostgreSQL-backed queue.

The analysis pipeline is intentionally asynchronous because multimodal video processing can take several minutes.

```text
Create Job
   ↓
Upload Video
   ↓
Create analysis_jobs record
   ↓
Queue = QUEUED
   ↓
Background Worker claims job
   ↓
Gemini Video Analysis
   ↓
Structured JSON
   ↓
Persist findings
   ↓
Job becomes REVIEW or PASS
```

This means the browser does **not** need to stay open while the AI is processing the video.

The current architecture explicitly separates the FastAPI application from the background worker and stores queue state in PostgreSQL. 

---

# 🧠 Structured AI Output

Each checklist requirement produces a structured finding containing:

```json
{
  "check": "Floor area is visibly clean",
  "status": "FAIL",
  "confidence": 0.95,
  "evidence_timestamp": "00:11",
  "reason": "Visible debris remains on the floor."
}
```

The important part is that the model output is transformed into **machine-readable QA data**, rather than being displayed as an unstructured paragraph.

The backend validates the model response through Pydantic before persisting the result.

This enables the frontend to build reliable UI elements such as:

* status badges
* evidence timestamps
* confidence indicators
* explanations
* review actions

---

# 🔎 Human Review Workflow

AI is used to reduce manual workload — not eliminate human judgment.

When a job requires review, operators can open the Human Review Queue.

The queue shows:

* Job ID
* service type
* video evidence
* submission time
* review actions

Reviewers can then inspect the video and make the final operational decision.

![Human Review Queue](photos/two.png)

---

# 🎥 Evidence-Based Review

The most useful part of the review workflow is the connection between:

**AI finding → evidence timestamp → video**

Instead of searching through the entire recording manually, the reviewer can use the finding's evidence timestamp to navigate directly to the relevant section of the video.

This turns AI output into an actionable review workflow.

The design goal is:

```text
AI identifies evidence
        ↓
Reviewer sees the claim
        ↓
Reviewer jumps to evidence
        ↓
Reviewer verifies visually
        ↓
Human decision recorded
```

---

# 📊 Operational Analytics

FieldProof AI also provides a dedicated analytics view for understanding QA workload.

The current interface exposes metrics such as:

* total QA volume
* completion rate
* review escalation rate
* rejection rate
* quality decision distribution
* workload by service type

![Operational Analytics](photos/four.png)

This lets an operations manager answer questions like:

* How many jobs are entering QA?
* How much work is still waiting for human review?
* How many jobs are being rejected?
* Which service types generate the most workload?
* How much of the process is being handled automatically?

---

# 🏗️ Architecture

```text
                       ┌──────────────────────┐
                       │   Field Technician   │
                       │   Completion Video   │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │   Next.js Frontend   │
                       │  React + TypeScript  │
                       └──────────┬───────────┘
                                  │
                           Clerk Session
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │   FastAPI Backend    │
                       │       Python         │
                       └───────┬───────┬──────┘
                               │       │
                         PostgreSQL     │
                               │       │
                               ▼       ▼
                       ┌────────────┐  ┌──────────────┐
                       │   Jobs /   │  │ Video Storage│
                       │ Checklists │  │   uploads/   │
                       │ Audit Logs │  └──────┬───────┘
                       └─────┬──────┘         │
                             │                 │
                             ▼                 │
                    ┌───────────────────┐      │
                    │   analysis_jobs   │◄─────┘
                    │ PostgreSQL Queue  │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ Background Worker │
                    │ backend/worker.py │
                    └─────────┬─────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
                  │ Gemini Video Analysis   │
                  │ Agentic Video Pipeline  │
                  └───────────┬─────────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
                  │ Structured QA Result    │
                  │ Pydantic Validation     │
                  └───────────┬─────────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
                  │ JobResult + Findings    │
                  │ PostgreSQL               │
                  └───────────┬─────────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
                  │ Human Review Console    │
                  │ Evidence + Decision     │
                  └───────────┬─────────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
                  │ Audit Trail              │
                  │ Reviewer + Timestamp    │
                  └─────────────────────────┘
```

The current repository implements this separation using FastAPI, PostgreSQL, an `analysis_jobs` queue, a dedicated worker, and a Gemini service. 

---

# ⚙️ Async Worker Architecture

The analysis queue is backed by PostgreSQL rather than relying on browser-side execution.

Each analysis job tracks information such as:

* queue state
* attempts
* start time
* completion time
* error state

Workers claim jobs using row-level locking with:

```sql
SELECT ... FOR UPDATE SKIP LOCKED
```

This allows multiple worker processes to operate without simultaneously claiming the same job.

The current architecture also documents stale-job recovery and maximum retry handling. 

---

# 🏢 Multi-Tenant SaaS Design

FieldProof AI is designed as a multi-tenant B2B application.

Each organization owns its own:

* jobs
* videos
* checklists
* results
* findings
* audit history

Authorization is enforced on the backend using Clerk organization membership and organization-scoped database queries.

A user's organization is not simply trusted from a frontend request.

This is important because a real SaaS system must protect the tenant boundary at the API and database layers.

The repository currently documents organization-scoped jobs and checklists plus server-side tenant isolation. 

---

# 🧾 Audit Trail

AI decisions and operational actions should be traceable.

FieldProof AI records lifecycle events such as:

```text
JOB_CREATED
ANALYSIS_QUEUED
AI_ANALYSIS_STARTED
AI_ANALYSIS_COMPLETED
AI_ANALYSIS_FAILED
HUMAN_REVIEW
APPROVED
REJECTED
```

The goal is to answer:

> Who did what, when, and what was the previous state?

This becomes especially important when AI is involved in operational QA.

---

# 🗄️ Database Model

The current schema contains the following major tables:

| Table           | Purpose                                        |
| --------------- | ---------------------------------------------- |
| `organizations` | Tenant identity and Clerk organization mapping |
| `users`         | Application users and organization membership  |
| `jobs`          | Service QA jobs                                |
| `analysis_jobs` | Persistent background analysis queue           |
| `job_results`   | Overall AI result and model metadata           |
| `job_findings`  | Checklist-level AI findings                    |
| `checklists`    | Organization-specific service criteria         |
| `audit_logs`    | Lifecycle and review history                   |

This data model separates the **operational job**, **AI processing state**, **AI result**, and **human decision history** rather than placing everything into one record. 

---

# 🧰 Tech Stack

## Frontend

* Next.js 16
* React 19
* TypeScript
* Tailwind CSS
* Clerk Authentication
* REST API
* Server-backed polling / status refresh

## Backend

* Python 3.11
* FastAPI
* SQLAlchemy 2
* Pydantic v2
* PostgreSQL 16
* Alembic
* Pytest

## AI / Media

* Google Gemini multimodal video understanding
* Google GenAI SDK
* Structured JSON output
* Pydantic schema validation

The repository currently documents this frontend/backend/AI stack and its PostgreSQL-backed architecture. 

---

# 🔐 Security & Reliability

The system is designed with several operational safeguards:

### Tenant isolation

All business objects are scoped to the authenticated organization.

### Secure video access

Video retrieval is authenticated instead of exposing the upload directory directly.

### File validation

Uploaded media is validated before entering the AI pipeline.

### Idempotent jobs

Job IDs are unique within an organization, preventing accidental duplicate operational records.

### Async processing

Long AI operations are decoupled from the request/response cycle.

### Retry handling

Transient AI failures can be retried without losing the job state.

### Auditability

Important state changes are persisted as audit events.

---

# 🧪 Testing

The repository includes automated tests around:

* multi-tenant isolation
* API validation
* job lifecycle
* checklist management
* worker concurrency
* stale-job recovery
* retry behavior
* upload validation
* cross-tenant video access

Run:

```bash
source .venv/bin/activate
pytest backend/tests -v
```

The test suite currently includes dedicated coverage for multi-tenancy, jobs, checklists, worker resilience, and upload validation. 

---

# 🚀 Running Locally

## Prerequisites

* Python 3.11+
* Node.js
* PostgreSQL
* Gemini API credentials
* Clerk application credentials

## Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

alembic upgrade head

uvicorn backend.main:app --reload --port 8000
```

## Worker

In another terminal:

```bash
cd ~/fieldproof-ai
source .venv/bin/activate

python -m backend.worker
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

The repository's current setup also documents separate backend, worker, and frontend processes. 

---

# 🔑 Environment Variables

Backend:

```env
GEMINI_API_KEY=your_key
CLERK_SECRET_KEY=your_key
CLERK_AUTHORIZED_PARTIES=http://localhost:3000
DATABASE_URL=postgresql+psycopg2://...
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

Frontend:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_key

NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/

NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

# 📸 Product Screenshots

### Operations Dashboard

![Dashboard](photos/dashboard.png)

### Jobs Management

![Jobs](photos/one.png)

### Human Review Queue

![Review Queue](photos/two.png)

### Dynamic Checklists

![Checklist](photos/three.png)

### Operational Analytics

![Analytics](photos/four.png)

### Create QA Job

![Create Job](photos/five.png)

### New Checklist

![New Checklist](photos/six.png)


### 1. AI output is structured

The application consumes schema-validated findings instead of free-form model responses.

### 2. Missing evidence is treated as uncertainty

The system distinguishes lack of evidence from evidence of failure.

### 3. AI execution is asynchronous

Long-running video analysis is handled by a persistent worker rather than blocking the frontend request.

### 4. Human review remains authoritative

AI assists the QA process; reviewers can make the final operational decision.

### 5. Tenant isolation is a backend responsibility

Organization boundaries are enforced server-side rather than trusting client input.

### 6. Audit history is a first-class feature

Every important state transition can be inspected after the fact.

---

# 🌍 Where This Could Be Used

FieldProof AI's architecture can be adapted to many visual verification workflows:

* cleaning services
* HVAC maintenance
* plumbing
* electrical work
* property inspections
* facilities maintenance
* construction progress checks
* equipment servicing
* rental-property turnover inspections

The checklist layer allows the verification logic to change without rebuilding the entire AI system.

---

# 🎓 What This Project Demonstrates

FieldProof AI combines several engineering domains in one system:

**Artificial Intelligence**

* multimodal video understanding
* structured LLM output
* uncertainty handling
* evidence extraction

**Backend Engineering**

* FastAPI
* PostgreSQL
* SQLAlchemy
* asynchronous job processing
* transactional state management

**Frontend Engineering**

* Next.js
* TypeScript
* responsive operational UI
* authenticated API integration

**SaaS Architecture**

* organization isolation
* role-aware workflows
* persistent state
* auditability

**Production Thinking**

* retry handling
* queue resilience
* validation
* security boundaries
* human-in-the-loop decision systems

---

# 📁 Repository Structure

```text
fieldproof-ai/
│
├── backend/
│   ├── api_*.py
│   ├── auth.py
│   ├── worker.py
│   ├── database/
│   ├── models/
│   ├── services/
│   └── tests/
│
├── frontend/
│   └── src/
│       ├── app/
│       ├── components/
│       └── lib/
│
├── photos/
│   ├── dashboard.png
│   ├── one.png
│   ├── two.png
│   ├── three.png
│   ├── four.png
│   ├── five.png
│   └── six.png
│
├── uploads/
├── alembic/
├── requirements.txt
└── README.md
```

---

# 🔬 Example QA Result

A typical AI response is conceptually represented as:

```text
Job: JOB-1061
Service: Cleaning

1. Floor area is visibly clean
   FAIL
   Confidence: 95%
   Evidence: 00:11
   Reason: Visible debris remains on the floor.

2. No visible trash remains on the floor
   FAIL
   Confidence: 98%
   Evidence: 00:11
   Reason: Newspaper remains visible.

3. Basin is visibly clean
   PASS
   Confidence: 95%
   Evidence: 00:26

4. Tap and surrounding basin area are visibly clean
   FAIL
   Confidence: 95%
   Evidence: 00:25

5. Surrounding work area is visibly clean
   FAIL
   Confidence: 90%
   Evidence: 00:30

6. Under-furniture area is inspected
   NOT_VISIBLE
   Confidence: 90%

7. Mirror is clean
   NOT_VISIBLE
   Confidence: 95%

Overall:
REVIEW
```

The important insight is that the system does not collapse all uncertainty into a binary answer.

---
