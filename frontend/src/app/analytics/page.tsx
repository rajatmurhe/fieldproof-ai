"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppLayout from "@/components/AppLayout";
import { EmptyState, GUARDRAIL_LABELS, Notice, Sheet, StatusStamp, guardrailLabel } from "@/components/ui";
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
  guardrails?: Record<string, number>;
  guarded_results?: number;
  analyzed_results?: number;
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
    // Intentional fetch-on-load: the loader sets its loading flag, then the result after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      label: "Approved by human reviewer",
      count: metrics.approved,
      barColor: "bg-pass",
    },
    {
      label: "Passed by AI auto-verification",
      count: metrics.pass,
      barColor: "bg-pass/60",
    },
    {
      label: "Awaiting human review (inconclusive / flagged)",
      count: metrics.review,
      barColor: "bg-signal",
    },
    {
      label: "In active AI pipeline (analyzing / queued)",
      count: metrics.analyzing + metrics.queued,
      barColor: "bg-queue",
    },
    {
      label: "Rejected or failed",
      count: metrics.rejected + metrics.failed,
      barColor: "bg-fail",
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
      title="Analytics"
      subtitle="Quality assurance metrics, pass rates, and human escalation distribution"
      action={
        <button onClick={loadData} disabled={loading} className="btn btn-quiet btn-sm">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="space-y-8">
        {error && <Notice tone="fail">{error}</Notice>}

        {/* Ruled metric strip */}
        <div className="grid grid-cols-2 gap-px border border-rule bg-rule lg:grid-cols-4">
          <MetricCell label="Total QA volume" value={loading ? "—" : metrics.total} caption="Recorded video jobs" />
          <MetricCell
            label="Completion rate"
            value={loading ? "—" : `${metrics.verificationRate}%`}
            caption={`${metrics.completed} verified & approved`}
            rate={metrics.verificationRate}
            barColor="bg-pass"
            valueColor="text-pass"
          />
          <MetricCell
            label="Review escalation"
            value={loading ? "—" : `${metrics.reviewEscalationRate}%`}
            caption={`${metrics.review} deferred to human sign-off`}
            rate={metrics.reviewEscalationRate}
            barColor="bg-signal"
            valueColor="text-signal-deep"
          />
          <MetricCell
            label="Rejection rate"
            value={loading ? "—" : `${metrics.rejectionRate}%`}
            caption={`${metrics.rejected + metrics.failed} jobs failed criteria`}
            rate={metrics.rejectionRate}
            barColor="bg-fail"
            valueColor="text-fail"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Sheet title="Decision distribution" aside={<span className="kicker">AI vs. human</span>} bodyClassName="">
            <div className="relative overflow-x-auto">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th className="text-right">Count</th>
                    <th className="w-[34%]">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {statusBars.map((item) => {
                    const pct = metrics.total > 0 ? Math.round((item.count / metrics.total) * 100) : 0;

                    return (
                      <tr key={item.label}>
                        <td className="text-ink">{item.label}</td>
                        <td className="text-right font-mono text-[13px] font-semibold tabular-nums">{item.count}</td>
                        <td>
                          <ShareBar pct={pct} barColor={item.barColor} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-rule px-5 py-3 text-xs leading-relaxed text-ink-2">
              <span className="kicker mr-2">Note</span>
              FieldProof AI is designed so that missing evidence yields <em>NOT_VISIBLE</em>, keeping the automated
              false-negative rate low while preserving compliance integrity.
            </p>
          </Sheet>

          <Sheet title="Workload by service type" aside={<span className="kicker">By checklist domain</span>} bodyClassName="">
            {jobTypeBreakdown.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No data yet">No service job data recorded yet.</EmptyState>
              </div>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Service type</th>
                      <th className="text-right">Jobs</th>
                      <th className="w-[34%]">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobTypeBreakdown.map(([type, count]) => {
                      const pct = metrics.total > 0 ? Math.round((count / metrics.total) * 100) : 0;

                      return (
                        <tr key={type}>
                          <td className="capitalize text-ink">{type.replace(/_/g, " ")}</td>
                          <td className="text-right font-mono text-[13px] font-semibold tabular-nums">{count}</td>
                          <td>
                            <ShareBar pct={pct} barColor="bg-ink" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Sheet>
        </div>

        <GuardrailsSheet stats={stats} />

        <Sheet
          title="Recent verification activity"
          aside={
            <Link href="/jobs" className="link text-xs">
              View all jobs →
            </Link>
          }
          bodyClassName=""
        >
          <div className="relative overflow-x-auto">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Service type</th>
                  <th>Video evidence</th>
                  <th>Created</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.slice(0, 6).map((job) => (
                  <tr key={job.id}>
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
                    <td className="text-right">
                      <StatusStamp status={job.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sheet>
      </div>
    </AppLayout>
  );
}

function MetricCell({
  label,
  value,
  caption,
  rate,
  barColor,
  valueColor = "text-ink",
}: {
  label: string;
  value: string | number;
  caption: string;
  rate?: number;
  barColor?: string;
  valueColor?: string;
}) {
  return (
    <div className="flex flex-col bg-sheet px-5 py-5">
      <p className="kicker">{label}</p>
      <p className={`figure mt-3 text-4xl sm:text-5xl ${valueColor}`}>{value}</p>
      {rate !== undefined && barColor && (
        <div className="mt-3">
          <ShareBar pct={rate} barColor={barColor} hideLabel />
        </div>
      )}
      <p className="mt-2 text-xs text-ink-2">{caption}</p>
    </div>
  );
}

function GuardrailsSheet({ stats }: { stats: Stats | null }) {
  const fired = Object.entries(stats?.guardrails ?? {}).sort((a, b) => b[1] - a[1]);
  const analyzed = stats?.analyzed_results ?? 0;
  const guarded = stats?.guarded_results ?? 0;

  return (
    <Sheet
      title="AI guardrails"
      aside={
        analyzed > 0 && (
          <span className="kicker">
            {guarded} of {analyzed} results adjusted
          </span>
        )
      }
      bodyClassName=""
    >
      {fired.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-2">
          {analyzed === 0
            ? "Guardrail counts appear once jobs are analyzed with the current pipeline."
            : "No guardrail has fired yet: every model reply matched the checklist and passed every check."}
        </p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th>Rule</th>
                <th>What it does</th>
                <th className="text-right">Fired</th>
              </tr>
            </thead>
            <tbody>
              {fired.map(([type, count]) => (
                <tr key={type}>
                  <td className="font-semibold text-ink">{guardrailLabel(type)}</td>
                  <td className="text-ink-2">{GUARDRAIL_LABELS[type]?.meaning ?? "—"}</td>
                  <td className="text-right font-mono text-[13px] font-semibold tabular-nums">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  );
}

function ShareBar({ pct, barColor, hideLabel }: { pct: number; barColor: string; hideLabel?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 bg-rule">
        <div className={`h-full ${barColor} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
      {!hideLabel && <span className="w-9 text-right font-mono text-[11px] tabular-nums text-ink-3">{pct}%</span>}
    </div>
  );
}
