"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppLayout from "@/components/AppLayout";
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
      title="Human Review Queue"
      subtitle="AI-flagged service videos requiring human inspection and final verification"
      action={
        <button
          onClick={loadReviews}
          disabled={loading}
          className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          {loading ? "Refreshing..." : "Refresh Queue"}
        </button>
      }
    >
      <div className="space-y-6">
        {feedback && (
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm font-medium text-teal-800 flex items-center justify-between">
            <span>{feedback}</span>
            <button onClick={() => setFeedback("")} className="text-xs font-semibold text-teal-600">
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* Informational Callout */}
        <div className="rounded-2xl border border-amber-200 bg-linear-to-r from-amber-50 to-orange-50/60 p-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {reviewCount} {reviewCount === 1 ? "Job Awaiting Determination" : "Jobs Awaiting Determination"}
                </h3>
                <p className="text-xs text-slate-600 mt-1 max-w-xl leading-relaxed">
                  FieldProof AI follows the principle: <strong>NOT_VISIBLE is not automatically FAIL</strong>.
                  When visual proof is obscured or ambiguous, the AI defers to human operations personnel to inspect evidence timestamps.
                </p>
              </div>
            </div>

            <div className="text-right sm:border-l sm:border-amber-200 sm:pl-6 shrink-0">
              <p className="text-3xl font-extrabold text-amber-900">{reviewCount}</p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Pending</p>
            </div>
          </div>
        </div>

        {/* Review Queue List */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-sm text-slate-500">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent mx-auto mb-2" />
              Loading review queue...
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-16 text-center">
              <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-base font-bold text-slate-800">Review Queue Cleared</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                All submitted field-service videos have been reviewed or automatically passed QA standards.
              </p>
              <button
                onClick={() => router.push("/jobs")}
                className="mt-5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                View All Jobs
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3.5">Job ID</th>
                    <th className="px-6 py-3.5">Service Type</th>
                    <th className="px-6 py-3.5">Video Evidence</th>
                    <th className="px-6 py-3.5">Submitted</th>
                    <th className="px-6 py-3.5 text-right">Review Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-medium">
                  {jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-amber-50/30 transition">
                      <td className="px-6 py-4 font-bold text-slate-900">
                        <Link
                          href={`/jobs/${encodeURIComponent(job.job_id)}`}
                          className="hover:text-teal-700 hover:underline"
                        >
                          {job.job_id}
                        </Link>
                      </td>
                      <td className="px-6 py-4 capitalize text-slate-600">
                        {job.job_type.replace(/_/g, " ")}
                      </td>
                      <td className="px-6 py-4 max-w-xs truncate text-slate-500 font-mono text-[11px]">
                        {job.video_filename}
                      </td>
                      <td className="px-6 py-4 text-slate-400">
                        {job.created_at
                          ? new Date(job.created_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => router.push(`/jobs/${encodeURIComponent(job.job_id)}`)}
                            className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 transition"
                          >
                            Inspect & Decide →
                          </button>

                          <button
                            disabled={actionInProgress === job.job_id}
                            onClick={() => handleQuickDecision(job.job_id, "APPROVED")}
                            className="rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1.5 text-xs font-bold hover:bg-emerald-100 transition disabled:opacity-50"
                            title="Quick Approve"
                          >
                            ✓
                          </button>

                          <button
                            disabled={actionInProgress === job.job_id}
                            onClick={() => handleQuickDecision(job.job_id, "REJECTED")}
                            className="rounded-lg bg-red-50 text-red-700 border border-red-200 px-2.5 py-1.5 text-xs font-bold hover:bg-red-100 transition disabled:opacity-50"
                            title="Quick Reject"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
