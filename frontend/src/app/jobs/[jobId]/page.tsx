"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AppLayout from "@/components/AppLayout";
import {
  EmptyState,
  Field,
  Loading,
  Notice,
  Sheet,
  StatusStamp,
  statusTone,
  type Tone,
} from "@/components/ui";
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
  const [videoError, setVideoError] = useState("");
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
    // Intentional fetch-on-load: the loader sets its loading flag, then the result after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      if (!isLoaded || !isSignedIn || !job?.job_id) return;

      try {
        const token = await getToken();
        if (!token) return;

        const response = await apiFetch(
          `/jobs/${encodeURIComponent(job.job_id)}/video`,
          token
        );

        if (response.status === 404) {
          // Expected when the file was never uploaded or has been removed from storage.
          console.warn(`No stored video for ${job.job_id}.`);
          setVideoError("The video file for this job isn't in storage.");
          return;
        }
        if (!response.ok) {
          throw new Error("Could not load video file.");
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setVideoUrl(objectUrl);
        setVideoError("");
      } catch (err) {
        console.error("Video load error:", err);
        setVideoUrl(null);
        setVideoError("The video couldn't be loaded. Try refreshing the page.");
      }
    }

    loadVideo();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setVideoUrl(null);
    };
  }, [getToken, isLoaded, isSignedIn, job?.job_id]);

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
      <AppLayout title="Loading job" subtitle="Fetching verification records">
        <Loading label="Retrieving job…" />
      </AppLayout>
    );
  }

  if (error && !job) {
    return (
      <AppLayout title="Job not found" subtitle="Error locating requested record">
        <div className="mx-auto max-w-xl space-y-4">
          <Notice tone="fail" title={error}>
            The job may not exist or belongs to another organization.
          </Notice>
          <button onClick={() => router.push("/jobs")} className="btn btn-primary">
            Back to jobs
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
        <>
          {(isFailed || isApproved || isRejected || isPass) && (
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="btn btn-quiet btn-sm"
            >
              {reanalyzing ? "Re-queueing…" : "Re-run analysis"}
            </button>
          )}

          <Link href="/jobs" className="btn btn-quiet btn-sm">
            ← Jobs list
          </Link>
        </>
      }
    >
      <div className="space-y-6">
        {feedbackMessage && (
          <Notice
            tone="pass"
            action={
              <button onClick={() => setFeedbackMessage("")} className="link text-xs">
                Dismiss
              </button>
            }
          >
            {feedbackMessage}
          </Notice>
        )}

        {error && <Notice tone="fail">{error}</Notice>}

        {isQueued && (
          <Notice tone="queue" title="Analysis queued — awaiting worker">
            Job is in queue. The background worker claims jobs with safe database locking. This page updates automatically.
          </Notice>
        )}

        {isAnalyzing && (
          <Notice
            tone="queue"
            title={
              <span className="flex items-center gap-3">
                Gemini video QA in progress
                <span className="loader" aria-hidden />
              </span>
            }
          >
            Gemini is inspecting the full video frame-by-frame against the checklist. You can safely navigate away or close this tab; your progress is preserved.
          </Notice>
        )}

        {isFailed && (
          <Notice
            tone="fail"
            title="Analysis encountered an issue"
            action={
              <button onClick={handleReanalyze} disabled={reanalyzing} className="btn btn-fail btn-sm">
                {reanalyzing ? "Retrying…" : "Retry analysis"}
              </button>
            }
          >
            {job.queue?.error_message || "The analysis worker was unable to complete the video assessment."}
          </Notice>
        )}

        {/* Below lg the columns dissolve (display: contents) so the sheets can be reordered:
            video, decision, findings, then the audit trail. */}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-start">
          {/* Left: video evidence and audit trail */}
          <div className="contents lg:col-span-7 lg:block lg:min-w-0 lg:space-y-6">
            <Sheet
              className="min-w-0 max-lg:order-1"
              title="Completion video"
              aside={
                activeTimestamp && (
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-signal-deep">
                    Seek {activeTimestamp}
                  </span>
                )
              }
              bodyClassName=""
            >
              <div className="bg-black">
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
                ) : videoError ? (
                  <div className="flex aspect-video flex-col items-center justify-center gap-2 px-6 text-center">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-signal">
                      Video unavailable
                    </span>
                    <span className="text-sm text-[#d9d4c4]">{videoError}</span>
                  </div>
                ) : (
                  <div className="flex aspect-video flex-col items-center justify-center gap-3">
                    <span className="loader" aria-hidden />
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#85816f]">
                      Loading authenticated video stream…
                    </span>
                  </div>
                )}
              </div>

              <dl className="grid grid-cols-1 gap-4 border-t border-rule px-5 py-3 sm:grid-cols-2">
                <Field label="File">
                  <span className="font-mono text-xs">{job.video_filename}</span>
                </Field>
                <Field label="Created">
                  <span className="font-mono text-xs">
                    {job.created_at ? new Date(job.created_at).toLocaleString() : "—"}
                  </span>
                </Field>
              </dl>
            </Sheet>

            <Sheet className="min-w-0 max-lg:order-4" title="Verification audit trail" aside={<span className="kicker">Immutable record</span>}>
              <AuditTimeline events={job.audit_history} />
            </Sheet>
          </div>

          {/* Right: verdict, decision console and findings */}
          <div className="contents lg:col-span-5 lg:block lg:min-w-0 lg:space-y-6">
            <Sheet className="min-w-0 max-lg:order-2" title="Current decision" bodyClassName="p-5">
              <div className="flex items-start justify-between gap-4">
                <span className={`verdict-stamp ${VERDICT_COLOURS[statusTone(job.status)]}`}>
                  {job.status.replace(/_/g, " ")}
                </span>

                {result?.model_name && (
                  <dl className="text-right">
                    <Field label="Model">
                      <span className="font-mono text-xs">{result.model_name}</span>
                    </Field>
                  </dl>
                )}
              </div>

              {isReview && (
                <div className="mt-6 space-y-3">
                  <Notice tone="review" title="Human review required">
                    The AI detected items requiring human sign-off (either NOT_VISIBLE or FAIL). Review the video evidence at the linked timestamps, then make the final determination:
                  </Notice>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      disabled={reviewing}
                      onClick={() => submitReview("APPROVED")}
                      className="btn btn-pass py-2.5"
                    >
                      {reviewing ? "Saving…" : "Approve job"}
                    </button>

                    <button
                      disabled={reviewing}
                      onClick={() => submitReview("REJECTED")}
                      className="btn btn-fail py-2.5"
                    >
                      {reviewing ? "Saving…" : "Reject job"}
                    </button>
                  </div>
                </div>
              )}

              {(isApproved || isRejected) && (
                <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-rule pt-4">
                  <Field label="Final human sign-off">
                    <span className={`font-mono text-xs font-semibold ${isApproved ? "text-pass" : "text-fail"}`}>
                      {job.review_decision}
                    </span>
                  </Field>
                  {job.reviewed_at && (
                    <Field label="Recorded">
                      <span className="font-mono text-xs">{new Date(job.reviewed_at).toLocaleString()}</span>
                    </Field>
                  )}
                </dl>
              )}
            </Sheet>

            <Sheet
              className="min-w-0 max-lg:order-3"
              title="Checklist findings"
              aside={
                result ? (
                  <span className="flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]">
                    <span className="text-pass">
                      Pass {result.checks.filter((c) => c.status === "PASS").length}
                    </span>
                    <span className="text-ink-3">·</span>
                    <span className="text-ink-2">
                      Not visible {result.checks.filter((c) => c.status === "NOT_VISIBLE").length}
                    </span>
                    <span className="text-ink-3">·</span>
                    <span className="text-fail">
                      Fail {result.checks.filter((c) => c.status === "FAIL").length}
                    </span>
                  </span>
                ) : (
                  <span className="kicker">Pending evaluation</span>
                )
              }
              bodyClassName=""
            >
              {result && result.checks.length > 0 ? (
                <ol>
                  {result.checks.map((check, idx) => (
                    <FindingRow
                      key={`${check.check}-${idx}`}
                      check={check}
                      index={idx + 1}
                      onTimestampClick={seekToTimestamp}
                    />
                  ))}
                </ol>
              ) : (
                <div className="p-5">
                  <EmptyState title="No QA findings yet">
                    {isAnalyzing
                      ? "Gemini is inspecting the video right now. Findings will populate when complete."
                      : "Analysis is queued. Findings will appear once processed."}
                  </EmptyState>
                </div>
              )}
            </Sheet>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

const VERDICT_COLOURS: Record<Tone, string> = {
  pass: "text-pass",
  fail: "text-fail",
  review: "text-signal-deep",
  queue: "text-queue",
  hold: "text-ink-2",
  neutral: "text-ink-2",
};

const FINDING_RULES: Record<CheckResult["status"], string> = {
  PASS: "border-l-pass",
  FAIL: "border-l-fail",
  NOT_VISIBLE: "border-l-ink-3 border-dashed",
};

// One numbered finding with a seek-to-evidence timestamp
function FindingRow({
  check,
  index,
  onTimestampClick,
}: {
  check: CheckResult;
  index: number;
  onTimestampClick: (ts: string | null) => void;
}) {
  const confidence = Math.round(check.confidence * 100);

  return (
    <li className={`border-b border-l-[3px] border-b-rule px-5 py-4 last:border-b-0 ${FINDING_RULES[check.status] ?? "border-l-ink-3"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 font-mono text-xs text-ink-3">{String(index).padStart(2, "0")}</span>
          <p className="text-sm font-semibold leading-snug text-ink">{check.check}</p>
        </div>
        <StatusStamp status={check.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pl-8">
        <div className="flex items-center gap-2">
          <span className="kicker">Confidence</span>
          <span className="font-mono text-xs font-semibold tabular-nums text-ink">{confidence}%</span>
          <span className="h-1 w-16 bg-rule" aria-hidden>
            <span className="block h-full bg-ink" style={{ width: `${confidence}%` }} />
          </span>
        </div>

        {check.evidence_timestamp ? (
          <button
            type="button"
            onClick={() => onTimestampClick(check.evidence_timestamp)}
            className="btn btn-quiet btn-sm font-mono"
            title="Jump to evidence in video"
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
              <path d="M1 0.5v9l8-4.5z" />
            </svg>
            {check.evidence_timestamp}
          </button>
        ) : (
          <span className="kicker">No visible timestamp</span>
        )}
      </div>

      <p className="mt-2.5 pl-8 text-sm leading-relaxed text-ink-2">{check.reason}</p>
    </li>
  );
}

// Audit trail as a vertical ledger: timestamp, ruled spine, event
function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events || events.length === 0) {
    return <EmptyState title="No audit events yet" />;
  }

  return (
    <ol>
      {events.map((event, idx) => {
        const isLast = idx === events.length - 1;

        return (
          <li key={event.id} className="grid grid-cols-[6.5rem_1rem_1fr] gap-x-3">
            <span className="pt-0.5 font-mono text-[10.5px] leading-snug text-ink-3">
              {event.created_at ? new Date(event.created_at).toLocaleString() : "—"}
            </span>

            <span className="relative flex justify-center" aria-hidden>
              {!isLast && <span className="absolute top-2 bottom-0 w-px bg-ink-3" />}
              <span className="relative mt-1.5 h-[7px] w-[7px] bg-ink" />
            </span>

            <div className={`min-w-0 ${isLast ? "" : "pb-5"}`}>
              <p className="display text-sm uppercase tracking-wide text-ink">
                {event.action.replace(/_/g, " ")}
              </p>

              {(event.from_status || event.to_status) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {event.from_status ? <StatusStamp status={event.from_status} /> : <span className="kicker">—</span>}
                  <span className="text-ink-3">→</span>
                  {event.to_status ? <StatusStamp status={event.to_status} /> : <span className="kicker">—</span>}
                </div>
              )}

              {event.user_name && (
                <p className="mt-1.5 text-xs text-ink-2">
                  <span className="kicker mr-1.5">By</span>
                  {event.user_name}
                </p>
              )}

              {event.details && Object.keys(event.details).length > 0 && (
                <dl className="mt-1.5 space-y-0.5">
                  {Object.entries(event.details).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-xs">
                      <dt className="kicker shrink-0">{k}</dt>
                      <dd className="min-w-0 break-words font-mono text-ink-2">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
