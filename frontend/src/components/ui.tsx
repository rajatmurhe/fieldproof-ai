import { ReactNode } from "react";

export type Tone = "pass" | "fail" | "review" | "queue" | "hold" | "neutral";

const STATUS_TONES: Record<string, Tone> = {
  PASS: "pass",
  APPROVED: "pass",
  FAIL: "fail",
  FAILED: "fail",
  REJECTED: "fail",
  REVIEW: "review",
  NOT_VISIBLE: "hold",
  ANALYZING: "queue",
  PROCESSING: "queue",
  QUEUED: "queue",
  PENDING: "neutral",
};

export function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? "neutral";
}

export function StatusStamp({ status, size }: { status: string; size?: "lg" }) {
  const tone = statusTone(status);
  return (
    <span className="stamp" data-tone={tone} data-size={size}>
      {/* Live dot for work in progress (analyzing/processing), not for a job still waiting. */}
      {tone === "queue" && status !== "QUEUED" && <span className="h-1.5 w-1.5 animate-pulse bg-current" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Sheet({
  title,
  aside,
  children,
  className = "",
  bodyClassName = "p-5",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`sheet min-w-0 ${className}`}>
      {(title || aside) && (
        <header className="sheet-head">
          {title && <h2 className="sheet-title">{title}</h2>}
          {aside && <div className="flex items-center gap-2 text-xs text-ink-2">{aside}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="notice" data-tone={tone} role={tone === "fail" ? "alert" : "status"}>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-ink-2" : ""}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16">
      <span className="loader" aria-hidden />
      <p className="kicker">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid-paper border border-dashed border-ink-3/50 px-6 py-12 text-center">
      <p className="display text-lg uppercase tracking-wide">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// Key/value pair in the mono-label style used across the docket.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="kicker">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink">{children}</dd>
    </div>
  );
}

// Names for guardrail rules recorded by the backend (backend/services/guardrails.py).
export const GUARDRAIL_LABELS: Record<string, { label: string; meaning: string }> = {
  missing_check: { label: "Missing finding", meaning: "Model skipped a criterion; it was sent to review." },
  duplicate_check: { label: "Duplicate finding", meaning: "A second finding for the same criterion was dropped." },
  unknown_check: { label: "Unknown criterion", meaning: "A finding for a criterion not on the checklist was dropped." },
  invalid_timestamp: { label: "Unreadable timestamp", meaning: "Evidence timestamp wasn't MM:SS or HH:MM:SS; removed." },
  timestamp_out_of_range: { label: "Timestamp past the end", meaning: "Evidence timestamp was later than the video; removed." },
  low_confidence: { label: "Low confidence", meaning: "PASS or FAIL below the confidence threshold; sent to review." },
  overall_status_overridden: { label: "Overall status corrected", meaning: "Model's overall verdict didn't match its findings." },
  schema_repaired: { label: "Reply repaired", meaning: "First reply broke the schema; a repair request fixed it." },
  schema_fallback: { label: "Unreadable reply", meaning: "No valid reply after a repair; every criterion sent to review." },
};

export function guardrailLabel(type: string): string {
  return GUARDRAIL_LABELS[type]?.label ?? type.replace(/_/g, " ");
}
