"use client";

import { useCallback, useEffect, useState } from "react";
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
    // Intentional fetch-on-load: the loader sets its loading flag, then the result after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const pendingJobs = stats?.pending ?? 0;

  // Share of all jobs per outcome, for the distribution bar.
  const distribution = [
    { label: "Verified", value: completedJobs, className: "bg-pass" },
    { label: "Needs review", value: reviewJobs, className: "bg-signal" },
    { label: "In pipeline", value: activePipeline, className: "bg-queue" },
    { label: "Rejected / failed", value: rejectedJobs, className: "bg-fail" },
    { label: "Pending", value: pendingJobs, className: "bg-ink-3" },
  ];

  return (
    <AppLayout
      title="Operations"
      subtitle="Completion videos coming in from the field, and where each one stands."
      action={
        <button onClick={loadData} disabled={loading} className="btn btn-quiet btn-sm">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="space-y-8">
        {error && <Notice tone="fail" title={error} />}

        {/* Desk counters: one ruled strip instead of separate cards (the 1px gaps are the rules) */}
        <section className="grid grid-cols-2 gap-px border border-rule bg-rule lg:grid-cols-4">
          <Counter
            href="/reviews"
            label="Needs review"
            value={loading ? null : reviewJobs}
            caption="Flagged by the model, waiting on a person"
            valueClassName={reviewJobs > 0 ? "text-signal-deep" : ""}
          />
          <Counter
            href="/jobs"
            label="In pipeline"
            value={loading ? null : activePipeline}
            caption={`${stats?.analyzing ?? 0} analyzing · ${stats?.queued ?? 0} queued`}
          />
          <Counter
            label="Verified"
            value={loading ? null : completedJobs}
            caption="Passed, or approved by a reviewer"
          />
          <Counter
            label="Total jobs"
            value={loading ? null : totalJobs}
            caption={`${rejectedJobs} rejected or failed`}
          />
        </section>

        {!loading && totalJobs > 0 && (
          <div>
            <div className="flex h-2.5 w-full gap-px bg-paper" role="img" aria-label="Jobs by outcome">
              {distribution
                .filter((d) => d.value > 0)
                .map((d) => (
                  <div
                    key={d.label}
                    className={d.className}
                    style={{ width: `${(d.value / totalJobs) * 100}%` }}
                    title={`${d.label}: ${d.value}`}
                  />
                ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
              {distribution.map((d) => (
                <li key={d.label} className="flex items-center gap-1.5 font-mono text-[11px] text-ink-2">
                  <span className={`h-2 w-2 ${d.className}`} />
                  {d.label}
                  <span className="text-ink">{d.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {reviewJobs > 0 && (
          <Notice
            tone="review"
            title={`${reviewJobs} ${reviewJobs === 1 ? "job is" : "jobs are"} waiting for a decision`}
            action={
              <Link href="/reviews" className="btn btn-signal btn-sm">
                Open review queue →
              </Link>
            }
          >
            The model marked at least one criterion as failed or not visible. Check the footage at the
            linked timestamps, then approve or reject.
          </Notice>
        )}

        <Sheet
          title="Recent jobs"
          aside={
            <Link href="/jobs" className="link text-xs">
              Full register →
            </Link>
          }
          bodyClassName=""
        >
          {loading ? (
            <Loading label="Loading recent jobs…" />
          ) : jobs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No jobs yet"
                action={
                  <button onClick={() => router.push("/jobs/new")} className="btn btn-primary btn-sm">
                    Create the first job
                  </button>
                }
              >
                Upload a technician&apos;s completion video to run it through QA.
              </EmptyState>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="ledger">
                <thead>
                  <tr>
                    <th className="w-12">No.</th>
                    <th>Job ID</th>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Video</th>
                    <th>Created</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {jobs.slice(0, 8).map((job, i) => {
                    const href = `/jobs/${encodeURIComponent(job.job_id)}`;
                    return (
                      <tr key={job.id} data-href={href} onClick={() => router.push(href)}>
                        <td className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</td>
                        <td className="font-mono font-semibold">{job.job_id}</td>
                        <td className="capitalize text-ink-2">{job.job_type}</td>
                        <td>
                          <StatusStamp status={job.status} />
                        </td>
                        <td className="max-w-[16rem] truncate font-mono text-xs text-ink-3">
                          {job.video_filename}
                        </td>
                        <td className="whitespace-nowrap font-mono text-xs text-ink-2">
                          {job.created_at ? new Date(job.created_at).toLocaleDateString() : "—"}
                        </td>
                        <td className="row-go text-right text-xs font-semibold text-ink-3">Open →</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Sheet>
      </div>
    </AppLayout>
  );
}

function Counter({
  label,
  value,
  caption,
  href,
  valueClassName = "",
}: {
  label: string;
  value: number | null;
  caption: string;
  href?: string;
  valueClassName?: string;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between">
        <span className="kicker">{label}</span>
        {href && <span className="text-xs text-ink-3 transition-colors group-hover:text-signal-deep">→</span>}
      </div>
      <p className={`figure mt-4 text-5xl ${valueClassName}`}>{value ?? "—"}</p>
      <p className="mt-2 text-xs text-ink-2">{caption}</p>
    </>
  );

  return href ? (
    <Link href={href} className="group block bg-sheet p-5 transition-colors hover:bg-paper">
      {body}
    </Link>
  ) : (
    <div className="bg-sheet p-5">{body}</div>
  );
}
