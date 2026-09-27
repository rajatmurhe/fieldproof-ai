"use client";

import { useCallback, useEffect, useState } from "react";
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
  created_at?: string | null;
};

type Stats = {
  total: number;
  pending: number;
  queued: number;
  analyzing: number;
  review: number;
  pass: number;
  approved: number;
  rejected: number;
  failed: number;
};

export default function Home() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const token = await getToken();
      if (!token) throw new Error("No session token available.");

      // Fetch stats and jobs in parallel
      const [statsRes, jobsRes] = await Promise.all([
        apiFetch("/jobs/stats", token),
        apiFetch("/jobs/", token),
      ]);

      if (statsRes.ok) {
        const statsData: Stats = await statsRes.json();
        setStats(statsData);
      }

      if (jobsRes.ok) {
        const jobsData: Job[] = await jobsRes.json();
        setJobs(jobsData);
      } else {
        const errText = await jobsRes.text();
        throw new Error(errText || "Failed to load recent jobs.");
      }
    } catch (err) {
      console.error(err);
      setError("Could not connect to FieldProof AI backend.");
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
    loadData();
  }, [isLoaded, isSignedIn, loadData, router]);

  // Derived counts from stats or jobs fallback
  const totalJobs = stats?.total ?? jobs.length;
  const reviewJobs = stats?.review ?? jobs.filter((j) => j.status === "REVIEW").length;
  const activePipeline =
    (stats?.analyzing ?? 0) + (stats?.queued ?? 0);
  const completedJobs =
    (stats?.approved ?? 0) + (stats?.pass ?? 0);
  const rejectedJobs = (stats?.rejected ?? 0) + (stats?.failed ?? 0);

  return (
    <AppLayout
      title="Operations Dashboard"
      subtitle="Real-time field technician video QA and AI verification pipeline"
      action={
        <div className="flex items-center gap-2.5">
          <button
            onClick={loadData}
            disabled={loading}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={() => router.push("/jobs/new")}
            className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 transition flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            New Job
          </button>
        </div>
      }
    >
      <div className="space-y-8">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* Operational Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Needs Review (Primary Operational Attention) */}
          <Link
            href="/reviews"
            className="group rounded-2xl border border-amber-200 bg-white p-5 shadow-xs transition hover:shadow-md hover:border-amber-400 relative overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
                Needs Human Review
              </span>
              <span className="h-8 w-8 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 group-hover:scale-105 transition">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold text-slate-900">
              {loading ? "—" : reviewJobs}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Uncertainty flagged · Requires sign-off
            </p>
          </Link>

          {/* Card 2: In Pipeline (Analyzing & Queued) */}
          <Link
            href="/jobs"
            className="group rounded-2xl border border-teal-200 bg-white p-5 shadow-xs transition hover:shadow-md hover:border-teal-400"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
                Active AI Pipeline
              </span>
              <span className="h-8 w-8 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 group-hover:scale-105 transition">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold text-slate-900">
              {loading ? "—" : activePipeline}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {stats?.analyzing ?? 0} analyzing · {stats?.queued ?? 0} queued
            </p>
          </Link>

          {/* Card 3: Completed / Approved */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                Verified & Completed
              </span>
              <span className="h-8 w-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold text-slate-900">
              {loading ? "—" : completedJobs}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Passed inspection or human approved
            </p>
          </div>

          {/* Card 4: Total Quality Volume */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Total Jobs Tracked
              </span>
              <span className="h-8 w-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold text-slate-900">
              {loading ? "—" : totalJobs}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {rejectedJobs} rejected / failed
            </p>
          </div>
        </div>

        {/* Review Queue Callout if pending items */}
        {reviewJobs > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-linear-to-r from-amber-50 to-orange-50 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
            <div>
              <span className="rounded-md bg-amber-200/80 px-2 py-0.5 text-xs font-bold text-amber-900">
                Action Required
              </span>
              <h3 className="mt-2 text-base font-bold text-slate-900">
                {reviewJobs} {reviewJobs === 1 ? "job requires" : "jobs require"} human review decision
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                AI QA detected inconclusive visual evidence or failure flags. Review the evidence timestamps to approve or reject.
              </p>
            </div>
            <Link
              href="/reviews"
              className="rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-amber-700 transition shrink-0 self-start sm:self-center"
            >
              Open Review Queue →
            </Link>
          </div>
        )}

        {/* Recent Jobs Table */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Recent Service Jobs</h3>
              <p className="text-xs text-slate-500">Live feed from multi-tenant PostgreSQL database</p>
            </div>

            <Link
              href="/jobs"
              className="text-xs font-semibold text-teal-700 hover:text-teal-900"
            >
              View all jobs →
            </Link>
          </div>

          {loading ? (
            <div className="p-12 text-center text-sm text-slate-500">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent mx-auto mb-2" />
              Loading recent jobs...
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-semibold text-slate-700">No QA jobs yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Upload your first completion video to test the AI QA pipeline.
              </p>
              <button
                onClick={() => router.push("/jobs/new")}
                className="mt-4 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
              >
                + Create First Job
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3.5">Job ID</th>
                    <th className="px-6 py-3.5">Service Type</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Video Evidence</th>
                    <th className="px-6 py-3.5">Created</th>
                    <th className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-medium">
                  {jobs.slice(0, 8).map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => router.push(`/jobs/${encodeURIComponent(job.job_id)}`)}
                      className="cursor-pointer hover:bg-slate-50/70 transition"
                    >
                      <td className="px-6 py-4 font-bold text-slate-900">
                        {job.job_id}
                      </td>
                      <td className="px-6 py-4 capitalize text-slate-600">
                        {job.job_type}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-6 py-4 max-w-xs truncate text-slate-500 font-mono text-[11px]">
                        {job.video_filename}
                      </td>
                      <td className="px-6 py-4 text-slate-400">
                        {job.created_at ? new Date(job.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-teal-700 hover:text-teal-900 font-bold">
                          Inspect →
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Platform Feature Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="h-2 w-8 rounded-full bg-teal-600 mb-3" />
            <h4 className="text-sm font-bold text-slate-900">Agentic Video Intelligence</h4>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Gemini examines temporal video evidence without hallucinating. Criteria with insufficient visual proof are marked NOT_VISIBLE rather than falsely failed.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="h-2 w-8 rounded-full bg-amber-500 mb-3" />
            <h4 className="text-sm font-bold text-slate-900">Human-in-the-Loop Review</h4>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Reviewers jump directly to evidence timestamps in the video to verify contested findings before making a binding operational decision.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="h-2 w-8 rounded-full bg-slate-800 mb-3" />
            <h4 className="text-sm font-bold text-slate-900">Audit & Tenant Isolation</h4>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Server-side multi-tenancy backed by Clerk organizations and PostgreSQL guarantees jobs, videos, and findings remain strictly compartmentalized.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PASS: "bg-emerald-100 text-emerald-800 border-emerald-200",
    APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
    REVIEW: "bg-amber-100 text-amber-800 border-amber-200",
    NOT_VISIBLE: "bg-amber-100 text-amber-800 border-amber-200",
    FAIL: "bg-red-100 text-red-800 border-red-200",
    REJECTED: "bg-red-100 text-red-800 border-red-200",
    FAILED: "bg-red-100 text-red-800 border-red-200",
    ANALYZING: "bg-teal-100 text-teal-800 border-teal-200",
    PROCESSING: "bg-teal-100 text-teal-800 border-teal-200",
    QUEUED: "bg-blue-100 text-blue-800 border-blue-200",
    PENDING: "bg-slate-100 text-slate-700 border-slate-200",
  };

  const selected = styles[status] || "bg-slate-100 text-slate-700 border-slate-200";

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold border ${selected}`}>
      {status}
    </span>
  );
}
