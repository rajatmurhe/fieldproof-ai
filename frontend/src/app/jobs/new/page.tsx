"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type ChecklistOption = {
  job_type: string;
  count: number;
};

function randomJobId() {
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `JOB-${randomNum}`;
}

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
          if (data.length > 0) {
            setJobType((current) =>
              data.some((d) => d.job_type === current) ? current : data[0].job_type
            );
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
    setJobId(randomJobId());
  }

  // Pre-populate with a random ID. jobId always starts empty, and the ID is generated on the client
  // only so the prerendered HTML still matches on hydration — hence the one-off setState here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobId(randomJobId());
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
      title="New QA job"
      subtitle="Upload a technician completion video for automated Gemini QA analysis."
    >
      <div className="mx-auto max-w-3xl">
        <section className="sheet">
          <header className="sheet-head">
            <h2 className="sheet-title">Work order</h2>
            <span className="font-mono text-xs text-ink-2">{jobId || "—"}</span>
          </header>

          <form onSubmit={handleSubmit}>
            {/* 01 Job reference */}
            <div className="grid grid-cols-1 gap-4 border-b border-rule px-5 py-6 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <div>
                <p className="kicker">01</p>
                <label htmlFor="job-id" className="display mt-0.5 block uppercase tracking-wide">
                  Job reference
                </label>
              </div>
              <div>
                <div className="flex gap-2">
                  <input
                    id="job-id"
                    type="text"
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    placeholder="e.g. JOB-1065"
                    disabled={isSubmitting}
                    className="field font-mono"
                  />
                  <button
                    type="button"
                    onClick={generateJobId}
                    disabled={isSubmitting}
                    className="btn btn-quiet btn-sm shrink-0"
                  >
                    New ID
                  </button>
                </div>
                <p className="mt-2 text-sm text-ink-2">
                  Unique identifier for this service ticket inside your organization.
                </p>
              </div>
            </div>

            {/* 02 Service type */}
            <div className="grid grid-cols-1 gap-4 border-b border-rule px-5 py-6 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <div>
                <p className="kicker">02</p>
                <label htmlFor="job-type" className="display mt-0.5 block uppercase tracking-wide">
                  Service type
                </label>
              </div>
              <div>
                <select
                  id="job-type"
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value)}
                  disabled={isSubmitting}
                  className="field capitalize"
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
                <p className="mt-2 text-sm text-ink-2">
                  The AI will evaluate video evidence against this service type&apos;s verified checklist.
                </p>
              </div>
            </div>

            {/* 03 Completion video */}
            <div className="grid grid-cols-1 gap-4 border-b border-rule px-5 py-6 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <div>
                <p className="kicker">03</p>
                <p className="display mt-0.5 uppercase tracking-wide">Completion video</p>
              </div>
              <div>
                <div className="grid-paper relative border-[1.5px] border-dashed border-ink-3 px-6 py-10 text-center transition-colors hover:border-ink">
                  <input
                    type="file"
                    aria-label="Completion video"
                    accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,.mp4,.mov,.avi,.mkv"
                    onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
                    disabled={isSubmitting}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />

                  {video ? (
                    <div className="relative">
                      <p className="kicker text-pass">Ready to upload</p>
                      <p className="mt-1 break-all font-mono text-sm font-semibold">{video.name}</p>
                      <p className="mt-1 font-mono text-xs text-ink-2">
                        {(video.size / (1024 * 1024)).toFixed(2)} MB · {video.type || "Video file"}
                      </p>
                    </div>
                  ) : (
                    <div className="relative">
                      <p className="display text-lg uppercase tracking-wide">
                        Drop video here, or <span className="text-signal-deep underline underline-offset-4">browse</span>
                      </p>
                      <p className="mt-1 font-mono text-xs text-ink-2">MP4 · MOV · AVI · MKV — up to 500 MB</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3 px-5 py-6">
              {error && <Notice tone="fail">{error}</Notice>}

              {isSubmitting && (
                <div className="flex items-center gap-3 border border-rule bg-paper px-4 py-3">
                  <span className="loader shrink-0" aria-hidden />
                  <span className="font-mono text-xs text-ink-2" role="status">{submissionStep}</span>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => router.push("/jobs")}
                  disabled={isSubmitting}
                  className="btn btn-quiet"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !video}
                  className="btn btn-signal flex-1 py-3 text-sm"
                >
                  {isSubmitting ? "Processing…" : "Submit and queue analysis →"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </AppLayout>
  );
}
