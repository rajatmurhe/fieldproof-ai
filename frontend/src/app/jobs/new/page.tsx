"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { apiFetch } from "@/lib/api";

type ChecklistOption = {
  job_type: string;
  count: number;
};

export default function NewJobPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [jobId, setJobId] = useState("");
  const [jobType, setJobType] = useState("cleaning");
  const [availableTypes, setAvailableTypes] = useState<ChecklistOption[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStep, setSubmissionStep] = useState<string>("");
  const [error, setError] = useState("");

  // Load available checklists for the dropdown
  useEffect(() => {
    async function loadChecklists() {
      if (!isLoaded || !isSignedIn) return;
      try {
        const token = await getToken();
        if (!token) return;
        const res = await apiFetch("/checklists/", token);
        if (res.ok) {
          const data: ChecklistOption[] = await res.json();
          setAvailableTypes(data);
          if (data.length > 0 && !data.some((d) => d.job_type === jobType)) {
            setJobType(data[0].job_type);
          }
        }
      } catch {
        // Fallback default types will apply
      }
    }
    loadChecklists();
  }, [isLoaded, isSignedIn, getToken]);

  // Generate a random job ID helper
  function generateJobId() {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setJobId(`JOB-${randomNum}`);
  }

  // Pre-populate with a random ID if empty
  useEffect(() => {
    if (!jobId) {
      generateJobId();
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedJobId = jobId.trim().toUpperCase();

    if (!trimmedJobId) {
      setError("Please specify a valid Job ID.");
      return;
    }

    if (!video) {
      setError("Please select a completion video to analyze.");
      return;
    }

    try {
      setIsSubmitting(true);
      const token = await getToken();

      if (!token) {
        throw new Error("Authentication session expired. Please sign in again.");
      }

      // Step 1: Create Job Record
      setSubmissionStep("Creating job record...");
      const jobRes = await apiFetch("/jobs/", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: trimmedJobId,
          job_type: jobType,
          video_filename: video.name,
        }),
      });

      if (!jobRes.ok) {
        const errText = await jobRes.text();
        throw new Error(`Failed to create job: ${errText}`);
      }

      // Step 2: Upload Video File
      setSubmissionStep(`Uploading video (${(video.size / (1024 * 1024)).toFixed(1)} MB)...`);
      const formData = new FormData();
      formData.append("job_id", trimmedJobId);
      formData.append("file", video);

      const uploadRes = await apiFetch("/upload/", token, {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Video upload failed: ${errText}`);
      }

      // Step 3: Enqueue Background Video Analysis
      setSubmissionStep("Enqueueing Gemini agentic analysis...");
      const analyzeRes = await apiFetch("/analyze/", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: trimmedJobId }),
      });

      if (!analyzeRes.ok) {
        const errText = await analyzeRes.text();
        throw new Error(`Failed to queue analysis: ${errText}`);
      }

      // Step 4: Successfully queued! Redirect immediately to Job Details page
      setSubmissionStep("Analysis queued! Redirecting to job workspace...");
      router.push(`/jobs/${encodeURIComponent(trimmedJobId)}?queued=true`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setIsSubmitting(false);
      setSubmissionStep("");
    }
  }

  return (
    <AppLayout
      title="Create New QA Job"
      subtitle="Upload a technician completion video for automated Gemini QA analysis"
    >
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Job ID */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-slate-800">
                  Job Identifier <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={generateJobId}
                  className="text-xs font-semibold text-teal-700 hover:text-teal-800"
                >
                  Generate ID
                </button>
              </div>
              <input
                type="text"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                placeholder="e.g. JOB-1065"
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Unique identifier for this service ticket inside your organization.
              </p>
            </div>

            {/* Job Type */}
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">
                Service Type & Checklist <span className="text-red-500">*</span>
              </label>
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50 capitalize"
              >
                {availableTypes.length > 0 ? (
                  availableTypes.map((t) => (
                    <option key={t.job_type} value={t.job_type}>
                      {t.job_type.replace(/_/g, " ")} ({t.count} checks)
                    </option>
                  ))
                ) : (
                  <>
                    <option value="cleaning">Cleaning</option>
                    <option value="hvac">HVAC</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="plumbing">Plumbing</option>
                  </>
                )}
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                The AI will evaluate video evidence against this service type&apos;s verified checklist.
              </p>
            </div>

            {/* Video File Picker */}
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">
                Technician Completion Video <span className="text-red-500">*</span>
              </label>

              <div className="relative border-2 border-dashed border-slate-300 hover:border-teal-500 rounded-2xl p-6 text-center transition bg-slate-50/50">
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,.mp4,.mov,.avi,.mkv"
                  onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
                  disabled={isSubmitting}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                />

                <div className="flex flex-col items-center justify-center">
                  <div className="h-12 w-12 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>

                  {video ? (
                    <div>
                      <p className="text-sm font-bold text-slate-900">{video.name}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Size: {(video.size / (1024 * 1024)).toFixed(2)} MB · Format: {video.type || "Video file"}
                      </p>
                      <span className="mt-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                        Ready to upload
                      </span>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-slate-700">
                        Drop video file here, or <span className="text-teal-700 font-bold underline">browse</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Supported formats: MP4, MOV, AVI, MKV (Up to 500 MB)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700 flex items-start gap-3">
                <svg className="w-5 h-5 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Submission progress */}
            {isSubmitting && (
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm font-medium text-teal-800 flex items-center gap-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-teal-700 border-t-transparent shrink-0" />
                <span>{submissionStep}</span>
              </div>
            )}

            {/* Submit Action */}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => router.push("/jobs")}
                disabled={isSubmitting}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !video}
                className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Processing...
                  </>
                ) : (
                  <>
                    <span>Submit & Queue Analysis</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
