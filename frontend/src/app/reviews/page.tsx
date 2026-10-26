"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppLayout from "@/components/AppLayout";
import { EmptyState, Loading, Notice, Sheet, StatusStamp } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Job = {
  id: number;
  job_id: string;
  job_type: string;
  video_filename: string;
  status: string;
  organization_id: number;
  created_at?: string | null;
};

export default function ReviewsPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const loadReviews = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const token = await getToken();
      if (!token) throw new Error("Authentication required.");

      const response = await apiFetch("/jobs/", token);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Could not retrieve review queue.");
      }

      const data: Job[] = await response.json();
      setJobs(data.filter((job) => job.status === "REVIEW"));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load review queue.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }
    // Intentional fetch-on-load: the loader sets its loading flag, then the result after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReviews();
  }, [isLoaded, isSignedIn, loadReviews, router]);

  // Quick Inline Review Decision
  async function handleQuickDecision(jobId: string, decision: "APPROVED" | "REJECTED") {
    try {
      setActionInProgress(jobId);
      setError("");
      setFeedback("");

      const token = await getToken();
      if (!token) throw new Error("Authentication required.");

      const response = await apiFetch(`/jobs/${encodeURIComponent(jobId)}/review`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to record review decision.");
      }

      setFeedback(`Job ${jobId} was successfully ${decision.toLowerCase()}.`);
      await loadReviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review action failed.");
    } finally {
      setActionInProgress(null);
    }
  }

  const reviewCount = useMemo(() => jobs.length, [jobs]);

  return (
    <AppLayout
      title="Review queue"
      subtitle="AI-flagged service videos requiring human inspection and final verification"
      action={
        <button onClick={loadReviews} disabled={loading} className="btn btn-quiet btn-sm">
          {loading ? "Refreshing…" : "Refresh queue"}
        </button>
      }
    >
      <div className="space-y-6">
        {feedback && (
          <Notice
            tone="pass"
            action={
              <button onClick={() => setFeedback("")} className="link text-xs">
                Dismiss
              </button>
            }
          >
            {feedback}
          </Notice>
        )}

        {error && <Notice tone="fail">{error}</Notice>}

        <div className="sheet grid sm:grid-cols-[auto_1fr] sm:divide-x divide-rule">
          <div className="flex items-baseline gap-3 border-b border-rule px-5 py-4 sm:block sm:border-b-0">
            <p className="figure text-5xl text-signal-deep">{loading ? "—" : reviewCount}</p>
            <p className="kicker mt-1">Awaiting sign-off</p>
          </div>
          <div className="px-5 py-4 text-sm leading-relaxed text-ink-2">
            <p className="display text-base uppercase tracking-wide text-ink">
              {loading
                ? "Checking the queue…"
                : reviewCount === 1
                  ? "1 job awaiting determination"
                  : `${reviewCount} jobs awaiting determination`}
            </p>
            <p className="mt-1 max-w-2xl">
              FieldProof AI follows one principle: <strong className="text-ink">NOT_VISIBLE is not automatically FAIL</strong>.
              When visual proof is obscured or ambiguous, the AI defers to operations staff to inspect the evidence
              timestamps.
            </p>
          </div>
        </div>

        <Sheet title="Pending determinations" aside={!loading && <span className="kicker">{jobs.length} rows</span>} bodyClassName="">
          {loading ? (
            <Loading label="Loading review queue" />
          ) : jobs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Queue clear"
                action={
                  <button onClick={() => router.push("/jobs")} className="btn btn-quiet btn-sm">
                    View all jobs
                  </button>
                }
              >
                All submitted field-service videos have been reviewed or automatically passed QA standards.
              </EmptyState>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="ledger">
                <thead>
                  <tr>
                    <th className="w-12">No.</th>
                    <th>Job ID</th>
                    <th>Service type</th>
                    <th>Video evidence</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th className="text-right">Determination</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job, idx) => (
                    <tr key={job.id}>
                      <td className="font-mono text-xs text-ink-3">{String(idx + 1).padStart(2, "0")}</td>
                      <td>
                        <Link
                          href={`/jobs/${encodeURIComponent(job.job_id)}`}
                          className="font-mono text-[13px] font-semibold text-ink hover:text-signal-deep"
                        >
                          {job.job_id}
                        </Link>
                      </td>
                      <td className="capitalize text-ink-2">{job.job_type.replace(/_/g, " ")}</td>
                      <td className="max-w-xs truncate font-mono text-[11px] text-ink-3">{job.video_filename}</td>
                      <td className="font-mono text-xs text-ink-2">
                        {job.created_at ? new Date(job.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td>
                        <StatusStamp status={job.status} />
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {actionInProgress === job.job_id ? (
                            <span className="loader" aria-label="Recording decision" />
                          ) : (
                            <>
                              <button
                                disabled={actionInProgress === job.job_id}
                                onClick={() => handleQuickDecision(job.job_id, "APPROVED")}
                                className="btn btn-pass btn-sm"
                                title="Quick approve"
                              >
                                Approve
                              </button>
                              <button
                                disabled={actionInProgress === job.job_id}
                                onClick={() => handleQuickDecision(job.job_id, "REJECTED")}
                                className="btn btn-fail btn-sm"
                                title="Quick reject"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          <Link
                            href={`/jobs/${encodeURIComponent(job.job_id)}`}
                            className="link ml-2 text-xs"
                          >
                            Inspect →
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sheet>
      </div>
    </AppLayout>
  );
}
