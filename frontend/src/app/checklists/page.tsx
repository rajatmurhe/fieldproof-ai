"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { Loading, Notice, Sheet } from "@/components/ui";
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

  const loadChecklist = useCallback(async (jobType: string) => {
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
  }, [getToken]);

  // Effect Event: reads the latest selectedType without re-running the effect when it changes.
  const loadInitialChecklists = useEffectEvent(() => {
    loadChecklists();
  });

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }
    // Intentional fetch-on-load: the loader sets its loading flag, then the result after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInitialChecklists();
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedType || isCreatingNew) return;
    // Intentional fetch-on-load: the loader sets its loading flag, then the result after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadChecklist(selectedType);
  }, [isLoaded, isSignedIn, selectedType, isCreatingNew, loadChecklist]);

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
      title="Checklists"
      subtitle="Define domain-specific criteria evaluated by the Gemini agentic video understanding model"
    >
      <div className="space-y-6">
        {message && (
          <Notice
            tone="pass"
            action={
              <button onClick={() => setMessage("")} className="link text-xs">
                Dismiss
              </button>
            }
          >
            {message}
          </Notice>
        )}

        {error && <Notice tone="fail">{error}</Notice>}

        {loading ? (
          <div className="sheet">
            <Loading label="Loading organization checklists" />
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Sheet
                title={`Checklists (${checklists.length})`}
                aside={
                  <button
                    onClick={() => {
                      setIsCreatingNew(true);
                      setNewJobType("");
                      setChecks([""]);
                      setMessage("");
                      setError("");
                    }}
                    className="btn btn-quiet btn-sm"
                  >
                    + New checklist
                  </button>
                }
                bodyClassName=""
              >
                <ul className="divide-y divide-rule">
                  {checklists.map((c) => {
                    const isSelected = !isCreatingNew && selectedType === c.job_type;

                    return (
                      <li key={c.job_type}>
                        <button
                          onClick={() => {
                            setIsCreatingNew(false);
                            setSelectedType(c.job_type);
                          }}
                          aria-current={isSelected ? "true" : undefined}
                          className={`flex w-full items-center justify-between border-l-[3px] py-2.5 pl-[17px] pr-5 text-left text-sm capitalize transition-colors ${
                            isSelected
                              ? "border-signal bg-paper font-semibold text-ink"
                              : "border-transparent text-ink-2 hover:bg-paper hover:text-ink"
                          }`}
                        >
                          <span>{c.job_type.replace(/_/g, " ")}</span>
                          <span className="font-mono text-[11px] tabular-nums text-ink-3">
                            {String(c.count).padStart(2, "0")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {isCreatingNew && (
                    <li className="border-l-[3px] border-signal bg-paper py-2.5 pl-[17px] pr-5 text-sm font-semibold italic text-ink">
                      {newJobType || "New checklist"}
                    </li>
                  )}
                </ul>
              </Sheet>

              <div className="border-l-[3px] border-ink px-4 py-1 text-xs leading-relaxed text-ink-2">
                <p className="kicker mb-1">Writing criteria</p>
                Keep each checklist item objective and visually observable. The AI is instructed:{" "}
                <strong className="text-ink">NOT_VISIBLE is not automatically FAIL</strong>. If the technician does
                not capture proof, it surfaces for human sign-off.
              </div>
            </div>

            <section className="sheet">
              <header className="flex flex-col gap-4 border-b border-rule px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                {isCreatingNew ? (
                  <label className="block min-w-0 sm:w-72">
                    <span className="kicker">New checklist · service type</span>
                    <input
                      type="text"
                      value={newJobType}
                      onChange={(e) => setNewJobType(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                      placeholder="e.g. electrical, roofing, plumbing"
                      className="field mt-1 font-mono"
                    />
                  </label>
                ) : (
                  <div className="min-w-0">
                    <p className="kicker">Checklist</p>
                    <h2 className="display mt-1 truncate text-2xl uppercase leading-none">
                      {selectedType.replace(/_/g, " ")}
                    </h2>
                    <p className="mt-1.5 text-xs text-ink-2">
                      {checks.length} criteria evaluated by Gemini video intelligence
                    </p>
                  </div>
                )}

                <div className="flex shrink-0 items-center gap-2">
                  {!isCreatingNew && (
                    <button
                      onClick={() => deleteChecklist(selectedType)}
                      className="btn btn-sm border-fail text-fail hover:border-fail hover:bg-fail hover:text-white"
                    >
                      Delete
                    </button>
                  )}

                  <button onClick={saveChecklist} disabled={saving} className="btn btn-primary">
                    {saving ? "Saving…" : "Save checklist"}
                  </button>
                </div>
              </header>

              <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-paper/60 px-5 py-3">
                <span className="kicker mr-1">Load preset</span>
                {Object.keys(TEMPLATE_PRESETS).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="btn btn-quiet btn-sm capitalize"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <ol className="divide-y divide-rule">
                {checks.map((check, idx) => (
                  <li key={idx} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-ink-3">
                      {String(idx + 1).padStart(2, "0")}
                    </span>

                    <input
                      type="text"
                      value={check}
                      onChange={(e) => updateCheck(idx, e.target.value)}
                      placeholder="e.g. Work area is clean and free of leftover debris"
                      className="field flex-1"
                      aria-label={`Criterion ${idx + 1}`}
                    />

                    <button
                      type="button"
                      onClick={() => removeCheck(idx)}
                      disabled={checks.length <= 1}
                      className="btn btn-quiet btn-sm"
                      title="Remove check"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ol>

              <div className="border-t border-rule px-5 py-3">
                <button type="button" onClick={addCheck} className="btn btn-quiet btn-sm">
                  + Add criterion
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
