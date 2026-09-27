"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { apiFetch } from "@/lib/api";

type ChecklistSummary = {
  job_type: string;
  checks: string[];
  count: number;
};

const TEMPLATE_PRESETS: Record<string, string[]> = {
  hvac: [
    "Condenser coils and fins are clean and unobstructed.",
    "Refrigerant line insulation is intact without cracks.",
    "Electrical disconnect box is securely closed and mounted.",
    "Air filter is newly installed with correct airflow direction.",
    "Drain line has clear condensate flow with no leaks.",
    "Thermostat controls respond properly to temperature setpoint.",
  ],
  cleaning: [
    "Floor area is visibly clean and free of dirt.",
    "No visible trash or debris remains on the floor.",
    "Basin and sink surfaces are visibly sanitized.",
    "Tap fixtures and surrounding counter area are wiped down.",
    "Surrounding work surfaces and mirrors are visibly clean.",
    "Under-furniture and corners were thoroughly inspected.",
  ],
  maintenance: [
    "Work area is clean and free of leftover debris or packaging.",
    "Safety covers and protective panels are securely re-fastened.",
    "No fluid leaks or uncontained spills around the unit.",
    "All warning and identification labels are clearly visible.",
    "Tools and testing equipment have been packed away.",
  ],
  plumbing: [
    "All pipe joints and fittings show no visible moisture or leaks.",
    "Shut-off valves operate smoothly and are in correct operating position.",
    "Drain fixtures demonstrate proper drainage without backup or slow flow.",
    "Surrounding walls and subfloor are dry and undamaged.",
    "Water pressure test completed with no vibration or hammer.",
  ],
  electrical: [
    "Panel box door is flush and securely latched.",
    "All circuit breakers are clearly and legibly indexed.",
    "Grounding conductor is firmly clamped with no bare frayed wire.",
    "Conduit fittings are tight with no exposed conductors.",
    "Voltage drop across terminals measures within nominal limits.",
  ],
};

export default function ChecklistsPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [checklists, setChecklists] = useState<ChecklistSummary[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [checks, setChecks] = useState<string[]>([]);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newJobType, setNewJobType] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadChecklists() {
    try {
      setLoading(true);
      setError("");

      const token = await getToken();
      if (!token) throw new Error("Authentication required.");

      const response = await apiFetch("/checklists/", token);

      if (!response.ok) {
        throw new Error("Could not load checklists.");
      }

      const data: ChecklistSummary[] = await response.json();
      setChecklists(data);

      if (data.length > 0 && !selectedType) {
        setSelectedType(data[0].job_type);
        setChecks(data[0].checks || []);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load checklists.");
    } finally {
      setLoading(false);
    }
  }

  async function loadChecklist(jobType: string) {
    try {
      setError("");
      setMessage("");

      const token = await getToken();
      if (!token) throw new Error("Authentication required.");

      const response = await apiFetch(`/checklists/${encodeURIComponent(jobType)}`, token);

      if (!response.ok) {
        throw new Error("Could not load checklist details.");
      }

      const data = await response.json();
      setChecks(data.checks || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not load checklist.");
    }
  }

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }
    loadChecklists();
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedType || isCreatingNew) return;
    loadChecklist(selectedType);
  }, [isLoaded, isSignedIn, selectedType, isCreatingNew]);

  function updateCheck(index: number, value: string) {
    setChecks((current) => current.map((c, i) => (i === index ? value : c)));
  }

  function removeCheck(index: number) {
    setChecks((current) => current.filter((_, i) => i !== index));
  }

  function addCheck() {
    setChecks((current) => [...current, "New verification requirement"]);
  }

  function applyPreset(presetKey: string) {
    if (TEMPLATE_PRESETS[presetKey]) {
      setChecks([...TEMPLATE_PRESETS[presetKey]]);
      if (isCreatingNew && !newJobType) {
        setNewJobType(presetKey);
      }
    }
  }

  async function saveChecklist() {
    const targetType = isCreatingNew ? newJobType.trim().toLowerCase() : selectedType;

    if (!targetType) {
      setError("Please provide a service type identifier.");
      return;
    }

    if (checks.length === 0) {
      setError("Checklists must contain at least one requirement.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setMessage("");

      const token = await getToken();
      if (!token) throw new Error("Authentication required.");

      const response = await apiFetch(`/checklists/${encodeURIComponent(targetType)}`, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not save checklist.");
      }

      setMessage(`Checklist for '${targetType}' saved. Gemini QA will evaluate future jobs with these criteria.`);
      setIsCreatingNew(false);
      setSelectedType(targetType);
      await loadChecklists();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to save checklist.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteChecklist(jobType: string) {
    if (!confirm(`Are you sure you want to delete the '${jobType}' checklist?`)) {
      return;
    }

    try {
      setError("");
      setMessage("");

      const token = await getToken();
      if (!token) throw new Error("Authentication required.");

      const response = await apiFetch(`/checklists/${encodeURIComponent(jobType)}`, token, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Could not delete checklist.");
      }

      setMessage(`Checklist for '${jobType}' deleted.`);
      setSelectedType("");
      await loadChecklists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete checklist.");
    }
  }

  return (
    <AppLayout
      title="QA Checklists"
      subtitle="Define domain-specific criteria evaluated by the Gemini agentic video understanding model"
      action={
        <button
          onClick={() => {
            setIsCreatingNew(true);
            setNewJobType("");
            setChecks([""]);
            setMessage("");
            setError("");
          }}
          className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 transition flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          New Checklist
        </button>
      }
    >
      <div className="space-y-6">
        {message && (
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm font-medium text-teal-800 flex items-center justify-between">
            <span>{message}</span>
            <button onClick={() => setMessage("")} className="text-xs font-bold text-teal-600">
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center text-sm text-slate-500">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent mx-auto mb-2" />
            Loading organization checklists...
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            {/* Left Column: Service Types Selector */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-3 px-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Service Types ({checklists.length})
                  </span>
                </div>

                <div className="space-y-1.5">
                  {checklists.map((c) => {
                    const isSelected = !isCreatingNew && selectedType === c.job_type;

                    return (
                      <button
                        key={c.job_type}
                        onClick={() => {
                          setIsCreatingNew(false);
                          setSelectedType(c.job_type);
                        }}
                        className={`w-full flex items-center justify-between rounded-xl px-3.5 py-3 text-left transition ${
                          isSelected
                            ? "bg-teal-50 text-teal-800 border border-teal-200 font-bold"
                            : "text-slate-600 hover:bg-slate-50 border border-transparent"
                        }`}
                      >
                        <span className="capitalize">{c.job_type.replace(/_/g, " ")}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                          {c.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Principle Info Card */}
              <div className="rounded-2xl border border-slate-200 bg-linear-to-br from-slate-50 to-teal-50/30 p-4 shadow-xs">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-2 w-2 rounded-full bg-teal-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    QA Architecture
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Keep each checklist item objective and visually observable. The AI is instructed:{" "}
                  <strong className="text-slate-900">NOT_VISIBLE is not automatically FAIL</strong>.
                  If the technician does not capture proof, it surfaces for human sign-off.
                </p>
              </div>
            </div>

            {/* Right Column: Editor Workspace */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 border-b border-slate-100 gap-4">
                <div>
                  {isCreatingNew ? (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
                        Create New Checklist
                      </span>
                      <div className="mt-2">
                        <input
                          type="text"
                          value={newJobType}
                          onChange={(e) => setNewJobType(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                          placeholder="e.g. electrical, roofing, plumbing"
                          className="rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 capitalize">
                        {selectedType.replace(/_/g, " ")} Checklist
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {checks.length} criteria evaluated by Gemini video intelligence
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  {!isCreatingNew && (
                    <button
                      onClick={() => deleteChecklist(selectedType)}
                      className="rounded-xl border border-red-200 text-red-700 hover:bg-red-50 px-3.5 py-2 text-xs font-semibold transition"
                    >
                      Delete
                    </button>
                  )}

                  <button
                    onClick={saveChecklist}
                    disabled={saving}
                    className="rounded-xl bg-teal-700 px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 transition disabled:opacity-60 flex items-center gap-1.5"
                  >
                    {saving ? "Saving..." : "Save Checklist"}
                  </button>
                </div>
              </div>

              {/* Template Presets Quick Fill */}
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-2">
                  Load Template Criteria Presets:
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(TEMPLATE_PRESETS).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="rounded-lg bg-slate-100 hover:bg-slate-200/80 px-2.5 py-1 text-xs font-medium text-slate-700 capitalize transition"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Criteria List */}
              <div className="space-y-3">
                {checks.map((check, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="h-8 w-8 rounded-lg bg-teal-50 text-teal-800 text-xs font-bold flex items-center justify-center shrink-0 border border-teal-200/60">
                      {idx + 1}
                    </span>

                    <input
                      type="text"
                      value={check}
                      onChange={(e) => updateCheck(idx, e.target.value)}
                      placeholder="e.g. Work area is clean and free of leftover debris"
                      className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-medium outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                    />

                    <button
                      type="button"
                      onClick={() => removeCheck(idx)}
                      disabled={checks.length <= 1}
                      className="rounded-lg p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-30"
                      title="Remove check"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              {/* Add item button */}
              <div>
                <button
                  type="button"
                  onClick={addCheck}
                  className="rounded-xl border border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/30 px-4 py-2.5 text-xs font-semibold text-slate-600 transition flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-teal-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Requirement
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
