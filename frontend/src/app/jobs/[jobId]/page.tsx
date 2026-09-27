"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AppLayout from "@/components/AppLayout";
import { apiFetch } from "@/lib/api";

type CheckResult = {
  check: string;
  status: "PASS" | "FAIL" | "NOT_VISIBLE";
  confidence: number;
  evidence_timestamp: string | null;
  reason: string;
  check_order?: number;
};

type JobResult = {
  overall_status: "PASS" | "REVIEW";
  model_name?: string;
  analyzed_at?: string;
  checks: CheckResult[];
};

type QueueInfo = {
  queue_status: string;
  attempts: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

type AuditEvent = {
  id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  details: Record<string, unknown> | null;
  user_name: string | null;
  user_email: string | null;
  created_at: string | null;
};

type JobDetails = {
  id: number;
  job_id: string;
  job_type: string;
  video_filename: string;
  status: string;
  organization_id: number;
  review_decision: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  result: JobResult | null;
  queue?: QueueInfo | null;
  audit_history: AuditEvent[];
};

function parseTimestampToSeconds(ts: string | null): number | null {
  if (!ts) return null;
  const cleaned = ts.replace(/[^0-9:]/g, "").trim();
  if (!cleaned) return null;
  const parts = cleaned.split(":").map(Number);
  if (parts.some(isNaN)) return null;

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export default function JobDetailsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const justQueued = searchParams.get("queued") === "true";

  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [job, setJob] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [error, setError] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState(
    justQueued ? "Analysis successfully queued! Background worker will process the video." : ""
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [activeTimestamp, setActiveTimestamp] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const loadJob = useCallback(
    async (showLoadingSpinner = false) => {
      if (!isLoaded || !isSignedIn || !jobId) return;

      try {
        if (showLoadingSpinner) setLoading(true);
        setError("");

        const token = await getToken();
        if (!token) throw new Error("Authentication required.");

        const response = await apiFetch(`/jobs/${encodeURIComponent(jobId)}`, token);

        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || `Job ${jobId} not found.`);
        }

        const data: JobDetails = await response.json();
        setJob(data);
      } catch (err) {
        console.error(err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Could not load job details.");
        }
      } finally {
        if (showLoadingSpinner) setLoading(false);
      }
    },
    [getToken, isLoaded, isSignedIn, jobId]
  );

  // Initial load
  useEffect(() => {
    loadJob(true);
  }, [loadJob]);

  // Smart Polling: while job is QUEUED or ANALYZING, poll every 6s
  useEffect(() => {
    if (!job) return;

    const isProcessing =
      job.status === "QUEUED" ||
      job.status === "ANALYZING" ||
      job.queue?.queue_status === "QUEUED" ||
      job.queue?.queue_status === "PROCESSING";

    if (!isProcessing) return;

    const interval = setInterval(() => {
      loadJob(false);
    }, 6000);

    return () => clearInterval(interval);
  }, [job, loadJob]);

  // Load secure video stream
  useEffect(() => {
    let objectUrl: string | null = null;

    async function loadVideo() {
      if (!isLoaded || !isSignedIn || !job?.video_filename) return;

      try {
        const token = await getToken();
        if (!token) return;

        const response = await apiFetch(
          `/videos/${encodeURIComponent(job.video_filename)}`,
          token
        );

        if (!response.ok) {
          throw new Error("Could not load video file.");
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setVideoUrl(objectUrl);
      } catch (err) {
        console.error("Video load error:", err);
        setVideoUrl(null);
      }
    }

    loadVideo();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setVideoUrl(null);
    };
  }, [getToken, isLoaded, isSignedIn, job?.video_filename]);

  // Seek video to evidence timestamp
  function seekToTimestamp(timestampStr: string | null) {
    if (!timestampStr) return;
    const seconds = parseTimestampToSeconds(timestampStr);
    if (seconds === null) return;

    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
      setActiveTimestamp(timestampStr);
      // Scroll to video smoothly on mobile
      videoRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // Handle Human Review Submission
  async function submitReview(decision: "APPROVED" | "REJECTED") {
    try {
      setReviewing(true);
      setError("");
      setFeedbackMessage("");

      const token = await getToken();
      if (!token) throw new Error("Authentication required.");

      const response = await apiFetch(`/jobs/${encodeURIComponent(jobId)}/review`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not record review decision.");
      }

      setFeedbackMessage(
        decision === "APPROVED"
          ? "Job approved successfully. Audit record created."
          : "Job rejected. Field technician notified."
      );

      await loadJob(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review submission failed.");
    } finally {
      setReviewing(false);
    }
  }

  // Handle Re-running Analysis
  async function handleReanalyze() {
    try {
      setReanalyzing(true);
      setError("");
      setFeedbackMessage("");

      const token = await getToken();
      if (!token) throw new Error("Authentication required.");

      const response = await apiFetch("/analyze/", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not re-queue analysis.");
      }

      setFeedbackMessage("Analysis re-queued. Background worker will process shortly.");
      await loadJob(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-analysis failed.");
    } finally {
      setReanalyzing(false);
    }
  }

  if (loading && !job) {
    return (
      <AppLayout title="Loading Job..." subtitle="Fetching verification records">
        <div className="flex flex-col items-center justify-center p-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
          <p className="mt-4 text-sm font-medium text-slate-500">Retrieving job workspace...</p>
        </div>
      </AppLayout>
    );
  }

  if (error && !job) {
    return (
      <AppLayout title="Job Not Found" subtitle="Error locating requested record">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center max-w-xl mx-auto">
          <p className="text-base font-semibold text-red-800">{error}</p>
          <p className="text-sm text-red-600 mt-2">
            The job may not exist or belongs to another organization.
          </p>
          <button
            onClick={() => router.push("/jobs")}
            className="mt-6 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Back to Jobs
          </button>
        </div>
      </AppLayout>
    );
  }

  if (!job) return null;

  const result = job.result;
  const isQueued = job.status === "QUEUED";
  const isAnalyzing = job.status === "ANALYZING";
  const isFailed = job.status === "FAILED";
  const isReview = job.status === "REVIEW";
  const isApproved = job.status === "APPROVED";
  const isRejected = job.status === "REJECTED";
  const isPass = job.status === "PASS";

  return (
    <AppLayout
      title={job.job_id}
      subtitle={`Service: ${job.job_type.toUpperCase()} · Video: ${job.video_filename}`}
      action={
        <div className="flex items-center gap-2">
          {(isFailed || isApproved || isRejected || isPass) && (
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {reanalyzing ? "Re-queueing..." : "Re-run Analysis"}
            </button>
          )}

          <Link
            href="/jobs"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            ← Jobs List
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Status Notification Banner */}
        {feedbackMessage && (
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm font-medium text-teal-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-teal-600" />
              <span>{feedbackMessage}</span>
            </div>
            <button
              onClick={() => setFeedbackMessage("")}
              className="text-xs text-teal-600 hover:text-teal-900 font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700 flex items-center gap-2.5">
            <svg className="w-5 h-5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Live Status Card */}
        {isQueued && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0">
                <svg className="w-5 h-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-blue-900">Analysis Queued in Background</h3>
                  <span className="rounded-full bg-blue-200/80 px-2.5 py-0.5 text-[11px] font-bold text-blue-800">
                    Awaiting Worker
                  </span>
                </div>
                <p className="text-xs text-blue-700 mt-0.5">
                  Job is in queue. The background worker claims jobs with safe database locking. This page updates automatically.
                </p>
              </div>
            </div>
          </div>
        )}

        {isAnalyzing && (
          <div className="rounded-2xl border border-teal-200 bg-teal-50/80 p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-teal-700 flex items-center justify-center text-white shrink-0">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-teal-900">Gemini Agentic Video QA In Progress</h3>
                  <span className="rounded-full bg-teal-200 px-2.5 py-0.5 text-[11px] font-bold text-teal-800 animate-pulse">
                    Analyzing
                  </span>
                </div>
                <p className="text-xs text-teal-700 mt-0.5">
                  Gemini is inspecting the full video frame-by-frame against the checklist. You can safely navigate away or close this tab; your progress is preserved.
                </p>
              </div>
            </div>
          </div>
        )}

        {isFailed && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-xs">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-red-600 flex items-center justify-center text-white shrink-0 mt-0.5">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-red-900">Analysis Encountered an Issue</h3>
                  <p className="text-xs text-red-700 mt-1">
                    {job.queue?.error_message || "The analysis worker was unable to complete the video assessment."}
                  </p>
                </div>
              </div>

              <button
                onClick={handleReanalyze}
                disabled={reanalyzing}
                className="rounded-xl bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 transition shrink-0"
              >
                {reanalyzing ? "Retrying..." : "Retry Analysis"}
              </button>
            </div>
          </div>
        )}

        {/* Main 2-Column Workspace */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Column: Video Evidence Player (7 Cols) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Completion Video</h2>
                  <p className="text-xs text-slate-500">
                    High-resolution technician completion recording
                  </p>
                </div>
                {activeTimestamp && (
                  <span className="rounded-lg bg-teal-50 border border-teal-200 px-2.5 py-1 text-xs font-semibold text-teal-800">
                    Seek: {activeTimestamp}
                  </span>
                )}
              </div>

              <div className="overflow-hidden rounded-xl bg-black shadow-inner">
                {videoUrl ? (
                  <video
                    ref={videoRef}
                    controls
                    playsInline
                    preload="metadata"
                    className="aspect-video w-full"
                    src={videoUrl}
                  >
                    Your browser does not support HTML5 video playback.
                  </video>
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-slate-400 bg-slate-950">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
                      <span>Loading authenticated video stream...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Video metadata row */}
              <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
                <span>File: <strong className="text-slate-700">{job.video_filename}</strong></span>
                <span>Created: {job.created_at ? new Date(job.created_at).toLocaleString() : "—"}</span>
              </div>
            </div>

            {/* Audit Trail Timeline */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-base font-bold text-slate-900">Verification Audit Trail</h2>
                <p className="text-xs text-slate-500">
                  Immutable record of AI analysis and reviewer decisions
                </p>
              </div>

              <AuditTimeline events={job.audit_history} />
            </div>
          </div>

          {/* Right Column: QA Findings & Decision Console (5 Cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Decision Status Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Current Decision
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={job.status} size="lg" />
                  </div>
                </div>

                {result?.model_name && (
                  <div className="text-right">
                    <p className="text-[11px] text-slate-400 font-medium">Model</p>
                    <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono font-medium text-slate-700">
                      {result.model_name}
                    </span>
                  </div>
                )}
              </div>

              {/* Human Review Decision Panel */}
              {isReview && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex items-start gap-2.5">
                    <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <h4 className="text-sm font-bold text-amber-900">Human Review Required</h4>
                      <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                        The AI detected items requiring human sign-off (either NOT_VISIBLE or FAIL). Review the video evidence at the linked timestamps, then make the final determination:
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                      disabled={reviewing}
                      onClick={() => submitReview("APPROVED")}
                      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {reviewing ? "Saving..." : "Approve Job"}
                    </button>

                    <button
                      disabled={reviewing}
                      onClick={() => submitReview("REJECTED")}
                      className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {reviewing ? "Saving..." : "Reject Job"}
                    </button>
                  </div>
                </div>
              )}

              {/* Already reviewed banner */}
              {(isApproved || isRejected) && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 uppercase">
                      Final Human Sign-off
                    </span>
                    <span className={`text-xs font-bold ${isApproved ? "text-emerald-700" : "text-red-700"}`}>
                      {job.review_decision}
                    </span>
                  </div>
                  {job.reviewed_at && (
                    <p className="text-xs text-slate-400 mt-1">
                      Recorded {new Date(job.reviewed_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Checklist Findings List */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Checklist Findings</h3>
                  <p className="text-xs text-slate-500">
                    {result ? `${result.checks.length} criteria evaluated` : "Pending evaluation"}
                  </p>
                </div>

                {result && (
                  <div className="flex items-center gap-1 text-[11px] font-bold">
                    <span className="rounded-md bg-emerald-50 text-emerald-700 px-2 py-0.5">
                      {result.checks.filter((c) => c.status === "PASS").length} Pass
                    </span>
                    <span className="rounded-md bg-amber-50 text-amber-700 px-2 py-0.5">
                      {result.checks.filter((c) => c.status === "NOT_VISIBLE").length} Unsure
                    </span>
                    <span className="rounded-md bg-red-50 text-red-700 px-2 py-0.5">
                      {result.checks.filter((c) => c.status === "FAIL").length} Fail
                    </span>
                  </div>
                )}
              </div>

              {result && result.checks.length > 0 ? (
                <div className="space-y-3">
                  {result.checks.map((check, idx) => (
                    <FindingCard
                      key={`${check.check}-${idx}`}
                      check={check}
                      index={idx + 1}
                      onTimestampClick={seekToTimestamp}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
                  <div className="h-8 w-8 mx-auto rounded-full bg-slate-200 flex items-center justify-center text-slate-500 mb-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">No QA findings yet</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                    {isAnalyzing
                      ? "Gemini is inspecting the video right now. Findings will populate when complete."
                      : "Analysis is queued. Findings will appear once processed."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// Finding Card with Timestamp Seek Action
function FindingCard({
  check,
  index,
  onTimestampClick,
}: {
  check: CheckResult;
  index: number;
  onTimestampClick: (ts: string | null) => void;
}) {
  const isPass = check.status === "PASS";
  const isFail = check.status === "FAIL";
  const isNotVisible = check.status === "NOT_VISIBLE";

  const borderColor = isPass
    ? "border-emerald-200 bg-emerald-50/40"
    : isFail
    ? "border-red-200 bg-red-50/40"
    : "border-amber-200 bg-amber-50/40";

  return (
    <div className={`rounded-xl border p-4 transition ${borderColor}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="text-xs font-bold text-slate-400 mt-0.5">{index}.</span>
          <p className="text-sm font-semibold text-slate-900 leading-snug">{check.check}</p>
        </div>
        <StatusBadge status={check.status} size="sm" />
      </div>

      {/* Metadata Row */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-500">
          <span>Confidence:</span>
          <strong className="text-slate-700">{(check.confidence * 100).toFixed(0)}%</strong>
        </div>

        {check.evidence_timestamp ? (
          <button
            type="button"
            onClick={() => onTimestampClick(check.evidence_timestamp)}
            className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 transition shadow-2xs"
            title="Click to jump to evidence in video"
          >
            <svg className="w-3.5 h-3.5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{check.evidence_timestamp}</span>
          </button>
        ) : (
          <span className="text-slate-400 italic text-[11px]">No visible timestamp</span>
        )}
      </div>

      {/* Reason Description */}
      <p className="mt-2.5 text-xs text-slate-600 leading-relaxed bg-white/60 p-2.5 rounded-lg border border-slate-200/60">
        {check.reason}
      </p>
    </div>
  );
}

// Status Badge Component
function StatusBadge({
  status,
  size = "md",
}: {
  status: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "px-2 py-0.5 text-[11px]",
    md: "px-3 py-1 text-xs",
    lg: "px-3.5 py-1.5 text-sm",
  };

  const styleMap: Record<string, string> = {
    PASS: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    APPROVED: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    REVIEW: "bg-amber-100 text-amber-800 border border-amber-200",
    NOT_VISIBLE: "bg-amber-100 text-amber-800 border border-amber-200",
    FAIL: "bg-red-100 text-red-800 border border-red-200",
    REJECTED: "bg-red-100 text-red-800 border border-red-200",
    FAILED: "bg-red-100 text-red-800 border border-red-200",
    ANALYZING: "bg-teal-100 text-teal-800 border border-teal-200",
    PROCESSING: "bg-teal-100 text-teal-800 border border-teal-200",
    QUEUED: "bg-blue-100 text-blue-800 border border-blue-200",
    PENDING: "bg-slate-100 text-slate-700 border border-slate-200",
  };

  const selectedStyle = styleMap[status] || "bg-slate-100 text-slate-700 border border-slate-200";

  return (
    <span className={`inline-flex items-center font-bold rounded-full ${sizeClasses[size]} ${selectedStyle}`}>
      {status}
    </span>
  );
}

// Audit Timeline Component
function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
        No recorded audit events yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event, idx) => {
        const isLast = idx === events.length - 1;

        return (
          <div key={event.id} className="relative flex gap-3.5">
            {!isLast && (
              <div className="absolute left-[9px] top-6 h-full w-px bg-slate-200" />
            )}

            <div className="relative mt-1 h-5 w-5 shrink-0 rounded-full border-4 border-white bg-slate-400 shadow-xs" />

            <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-800">
                  {event.action.replace(/_/g, " ")}
                </span>
                {event.created_at && (
                  <span className="text-[11px] text-slate-400">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                )}
              </div>

              {(event.from_status || event.to_status) && (
                <div className="mt-1 text-slate-600">
                  Transition: <span className="font-semibold">{event.from_status || "—"}</span> →{" "}
                  <span className="font-semibold text-teal-800">{event.to_status || "—"}</span>
                </div>
              )}

              {event.user_name && (
                <div className="mt-1 text-slate-500">
                  Triggered by: <strong className="text-slate-700">{event.user_name}</strong>
                </div>
              )}

              {event.details && Object.keys(event.details).length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-200/60 text-[11px] text-slate-500 space-y-0.5">
                  {Object.entries(event.details).map(([k, v]) => (
                    <div key={k}>
                      <span className="font-medium text-slate-600">{k}:</span> {String(v)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
