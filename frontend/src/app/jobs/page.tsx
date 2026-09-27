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

  return (
    <AppLayout
      title="Field Service Jobs"
      subtitle="Complete register of all technician submissions and QA verification decisions"
      action={
        <div className="flex items-center gap-2.5">
          <button
            onClick={loadJobs}
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
      <div className="space-y-6">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* Filter Controls Bar */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_200px_200px_auto]">
            {/* Search Input */}
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Job ID, video, or service..."
                className="w-full rounded-xl border border-slate-300 pl-9 pr-4 py-2.5 text-xs font-medium outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              />
            </div>

            {/* Status Filter Dropdown */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
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

            {/* Service Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 capitalize"
            >
              <option value="ALL">All Service Types</option>
              {jobTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </option>
              ))}
            </select>

            {/* Clear filters if active */}
            {(search || statusFilter !== "ALL" || typeFilter !== "ALL") && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("ALL");
                  setTypeFilter("ALL");
                }}
                className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Reset
              </button>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing <strong className="text-slate-800">{filteredJobs.length}</strong> of{" "}
              {jobs.length} total jobs
            </span>
          </div>
        </div>

        {/* Jobs Table */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-sm text-slate-500">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent mx-auto mb-2" />
              Loading jobs register...
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-16 text-center">
              <div className="h-10 w-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-sm font-bold text-slate-700">No matching jobs found</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                {jobs.length === 0
                  ? "No jobs have been registered yet. Upload your first video to start."
                  : "Try adjusting your search query or status filters above."}
              </p>
              {jobs.length === 0 && (
                <button
                  onClick={() => router.push("/jobs/new")}
                  className="mt-4 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
                >
                  Create New Job
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3.5">Job ID</th>
                    <th className="px-6 py-3.5">Service Type</th>
                    <th className="px-6 py-3.5">Video Evidence</th>
                    <th className="px-6 py-3.5">QA Status</th>
                    <th className="px-6 py-3.5">Submitted</th>
                    <th className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-medium">
                  {filteredJobs.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => router.push(`/jobs/${encodeURIComponent(job.job_id)}`)}
                      className="cursor-pointer hover:bg-slate-50/70 transition"
                    >
                      <td className="px-6 py-4 font-bold text-slate-900">
                        {job.job_id}
                      </td>
                      <td className="px-6 py-4 capitalize text-slate-600">
                        {job.job_type.replace(/_/g, " ")}
                      </td>
                      <td className="px-6 py-4 max-w-xs truncate text-slate-500 font-mono text-[11px]">
                        {job.video_filename}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-6 py-4 text-slate-400">
                        {job.created_at
                          ? new Date(job.created_at).toLocaleString(undefined, {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "—"}
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
