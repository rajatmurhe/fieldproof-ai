"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { EmptyState, Loading, Notice, StatusStamp } from "@/components/ui";
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

export default function JobsPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const token = await getToken();
      if (!token) throw new Error("No authentication token available.");

      const response = await apiFetch("/jobs/", token);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Could not retrieve jobs.");
      }

      const data: Job[] = await response.json();
      setJobs(data);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load jobs list.");
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
    loadJobs();
  }, [isLoaded, isSignedIn, loadJobs, router]);

  const jobTypes = useMemo(() => {
    return Array.from(new Set(jobs.map((job) => job.job_type))).sort();
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();

    return jobs.filter((job) => {
      const matchesSearch =
        !q ||
        job.job_id.toLowerCase().includes(q) ||
        job.video_filename.toLowerCase().includes(q) ||
        job.job_type.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "ALL" || job.status === statusFilter;

      const matchesType =
        typeFilter === "ALL" || job.job_type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [jobs, search, statusFilter, typeFilter]);

  const filtersActive = Boolean(search) || statusFilter !== "ALL" || typeFilter !== "ALL";

  return (
    <AppLayout
      title="Jobs register"
      subtitle="Every technician submission and its QA decision, newest first."
      action={
        <button onClick={loadJobs} disabled={loading} className="btn btn-quiet btn-sm">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="space-y-6">
        {error && <Notice tone="fail">{error}</Notice>}

        <section className="sheet">
          {/* Ruled toolbar: search, filters and the result count. */}
          <div className="flex flex-col gap-3 border-b border-ink px-4 py-3 lg:flex-row lg:items-end">
            <label className="flex-1 min-w-0">
              <span className="kicker">Search</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Job ID, video file or service type"
                className="field mt-1"
              />
            </label>

            <label className="lg:w-52">
              <span className="kicker">Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="field mt-1"
              >
                <option value="ALL">All Statuses ({jobs.length})</option>
                <option value="QUEUED">Queued (Awaiting Worker)</option>
                <option value="ANALYZING">Analyzing (In Progress)</option>
                <option value="REVIEW">Needs Review</option>
                <option value="APPROVED">Approved</option>
                <option value="PASS">Passed (Automatic)</option>
                <option value="REJECTED">Rejected</option>
                <option value="FAILED">Failed (Error)</option>
                <option value="PENDING">Pending (Created)</option>
              </select>
            </label>

            <label className="lg:w-52">
              <span className="kicker">Service type</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="field mt-1 capitalize"
              >
                <option value="ALL">All Service Types</option>
                {jobTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-3 lg:pb-2">
              {filtersActive && (
                <button
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("ALL");
                    setTypeFilter("ALL");
                  }}
                  className="btn btn-quiet btn-sm"
                >
                  Reset
                </button>
              )}
              <span className="ml-auto whitespace-nowrap font-mono text-xs text-ink-2">
                {filteredJobs.length} of {jobs.length} jobs
              </span>
            </div>
          </div>

          {loading ? (
            <Loading label="Loading register…" />
          ) : filteredJobs.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={jobs.length === 0 ? "No jobs yet" : "No matching jobs"}
                action={
                  jobs.length === 0 && (
                    <button onClick={() => router.push("/jobs/new")} className="btn btn-primary">
                      Create new job
                    </button>
                  )
                }
              >
                {jobs.length === 0
                  ? "No jobs have been registered yet. Upload your first video to start."
                  : "Try adjusting your search query or status filters above."}
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
                    <th>QA status</th>
                    <th>Video evidence</th>
                    <th>Submitted</th>
                    <th className="text-right">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job, i) => {
                    const href = `/jobs/${encodeURIComponent(job.job_id)}`;
                    return (
                      <tr key={job.id} data-href={href} onClick={() => router.push(href)}>
                        <td className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</td>
                        <td className="font-mono font-semibold whitespace-nowrap">{job.job_id}</td>
                        <td className="capitalize text-ink-2">{job.job_type.replace(/_/g, " ")}</td>
                        <td>
                          <StatusStamp status={job.status} />
                        </td>
                        <td className="max-w-xs truncate font-mono text-xs text-ink-3">{job.video_filename}</td>
                        <td className="whitespace-nowrap font-mono text-xs text-ink-2">
                          {job.created_at
                            ? new Date(job.created_at).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "—"}
                        </td>
                        <td className="row-go whitespace-nowrap text-right text-xs font-semibold text-ink-3">
                          Open →
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
