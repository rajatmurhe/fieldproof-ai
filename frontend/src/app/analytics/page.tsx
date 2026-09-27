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

export default function AnalyticsPage() {
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
      if (!token) throw new Error("Authentication required.");

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
        throw new Error("Could not load jobs registry.");
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load analytics data.");
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

  const metrics = useMemo(() => {
    const total = stats?.total ?? jobs.length;
    const approved = stats?.approved ?? jobs.filter((j) => j.status === "APPROVED").length;
    const pass = stats?.pass ?? jobs.filter((j) => j.status === "PASS").length;
    const review = stats?.review ?? jobs.filter((j) => j.status === "REVIEW").length;
    const rejected = stats?.rejected ?? jobs.filter((j) => j.status === "REJECTED").length;
    const failed = stats?.failed ?? jobs.filter((j) => j.status === "FAILED").length;
    const analyzing = stats?.analyzing ?? jobs.filter((j) => j.status === "ANALYZING").length;
    const queued = stats?.queued ?? jobs.filter((j) => j.status === "QUEUED").length;
    const pending = stats?.pending ?? jobs.filter((j) => j.status === "PENDING").length;

    const completed = approved + pass;
    const verificationRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const reviewEscalationRate = total > 0 ? Math.round((review / total) * 100) : 0;
    const rejectionRate = total > 0 ? Math.round(((rejected + failed) / total) * 100) : 0;

    return {
      total,
      approved,
      pass,
      review,
      rejected,
      failed,
      analyzing,
      queued,
      pending,
      completed,
      verificationRate,
      reviewEscalationRate,
      rejectionRate,
    };
  }, [jobs, stats]);

  const statusBars = [
    {
      label: "Approved by Human Reviewer",
      count: metrics.approved,
      barColor: "bg-emerald-500",
      textColor: "text-emerald-700",
    },
    {
      label: "Passed by AI Auto-Verification",
      count: metrics.pass,
      barColor: "bg-teal-500",
      textColor: "text-teal-700",
    },
    {
      label: "Awaiting Human Review (Inconclusive/Flagged)",
      count: metrics.review,
      barColor: "bg-amber-500",
      textColor: "text-amber-700",
    },
    {
      label: "In Active AI Pipeline (Analyzing / Queued)",
      count: metrics.analyzing + metrics.queued,
      barColor: "bg-blue-500",
      textColor: "text-blue-700",
    },
    {
      label: "Rejected or Failed",
      count: metrics.rejected + metrics.failed,
      barColor: "bg-red-500",
      textColor: "text-red-700",
    },
  ];

  const jobTypeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const job of jobs) {
      counts[job.job_type] = (counts[job.job_type] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  return (
    <AppLayout
      title="Operational Analytics"
      subtitle="Quality assurance metrics, pass rates, and human escalation distribution"
      action={
        <button
          onClick={loadData}
          disabled={loading}
          className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      }
    >
      <div className="space-y-8">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* Top Operational KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total QA Volume
            </span>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">
              {loading ? "—" : metrics.total}
            </p>
            <p className="mt-1 text-xs text-slate-400">Recorded video jobs</p>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Completion Rate
            </span>
            <p className="mt-2 text-3xl font-extrabold text-emerald-800">
              {loading ? "—" : `${metrics.verificationRate}%`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {metrics.completed} verified & approved
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
              Review Escalation Rate
            </span>
            <p className="mt-2 text-3xl font-extrabold text-amber-800">
              {loading ? "—" : `${metrics.reviewEscalationRate}%`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {metrics.review} deferred to human sign-off
            </p>
          </div>

          <div className="rounded-2xl border border-red-200 bg-white p-5 shadow-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-red-700">
              Rejection Rate
            </span>
            <p className="mt-2 text-3xl font-extrabold text-red-800">
              {loading ? "—" : `${metrics.rejectionRate}%`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {metrics.rejected + metrics.failed} jobs failed criteria
            </p>
          </div>
        </div>

        {/* 2-Column Analytics Overview */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Status Distribution */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Quality Decision Distribution</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Breakdown of AI automatic decisions vs human reviewer interventions
              </p>
            </div>

            <div className="space-y-4">
              {statusBars.map((item) => {
                const pct = metrics.total > 0 ? Math.round((item.count / metrics.total) * 100) : 0;

                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">{item.label}</span>
                      <span className="font-bold text-slate-900">
                        {item.count} <span className="text-slate-400 font-normal">({pct}%)</span>
                      </span>
                    </div>

                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${item.barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Architecture Explainer */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-900">Architectural Note:</strong> FieldProof AI is designed
              so that missing evidence yields <em>NOT_VISIBLE</em>, keeping the automated false-negative
              rate low while preserving compliance integrity.
            </div>
          </div>

          {/* Service Workload Breakdown */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Workload by Service Type</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Operational volume categorized by verified checklist domains
              </p>
            </div>

            {jobTypeBreakdown.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400">
                No service job data recorded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {jobTypeBreakdown.map(([type, count]) => {
                  const pct = metrics.total > 0 ? Math.round((count / metrics.total) * 100) : 0;

                  return (
                    <div
                      key={type}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3.5 border border-slate-100"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="h-2 w-2 rounded-full bg-teal-600" />
                        <span className="text-xs font-bold text-slate-800 capitalize">
                          {type.replace(/_/g, " ")}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 font-medium">{pct}% of total</span>
                        <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-bold text-teal-800">
                          {count} jobs
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity Feed */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Recent Verification Activity</h3>
              <p className="text-xs text-slate-500">Live operational audit stream</p>
            </div>

            <Link href="/jobs" className="text-xs font-semibold text-teal-700 hover:text-teal-900">
              View all jobs →
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {jobs.slice(0, 6).map((job) => (
              <div key={job.id} className="py-3 flex items-center justify-between text-xs">
                <div>
                  <Link
                    href={`/jobs/${encodeURIComponent(job.job_id)}`}
                    className="font-bold text-slate-900 hover:text-teal-700"
                  >
                    {job.job_id}
                  </Link>
                  <span className="text-slate-400 mx-2">·</span>
                  <span className="capitalize text-slate-600">{job.job_type.replace(/_/g, " ")}</span>
                  <span className="text-slate-400 mx-2">·</span>
                  <span className="font-mono text-slate-400 text-[11px]">{job.video_filename}</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-[11px]">
                    {job.created_at ? new Date(job.created_at).toLocaleDateString() : "—"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      job.status === "APPROVED" || job.status === "PASS"
                        ? "bg-emerald-50 text-emerald-700"
                        : job.status === "REVIEW"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
