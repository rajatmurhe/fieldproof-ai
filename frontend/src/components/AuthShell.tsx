import { ReactNode } from "react";

const VERDICTS = [
  { code: "PASS", note: "Criterion clearly shown on video", tone: "text-[#9fd3a8]" },
  { code: "FAIL", note: "Shown, and not done to standard", tone: "text-[#f0a093]" },
  { code: "NOT VISIBLE", note: "Not provable from the footage", tone: "text-[#d9d4c4]" },
];

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-paper lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-[#fbfaf5] lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center border-2 border-[#fbfaf5] font-mono text-[11px] font-semibold">
            FP
          </span>
          <span className="display text-[17px] uppercase tracking-wide">
            FieldProof
            <span className="ml-1.5 font-mono text-[10px] font-medium tracking-[0.12em] text-signal">QA DESK</span>
          </span>
        </div>

        <div className="max-w-lg">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal">Field-service video QA</p>
          <h1 className="display mt-4 text-[3.4rem] leading-[0.95] uppercase">
            Every finished job,
            <br />
            checked on tape.
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[#bdb8a8]">
            Technicians upload a completion video. Each checklist item gets a verdict with the
            timestamp that proves it, and anything uncertain goes to a person.
          </p>
        </div>

        <dl className="border-t border-[#3a382f] pt-6">
          {VERDICTS.map((v) => (
            <div key={v.code} className="flex items-baseline gap-4 py-1.5">
              <dt className={`w-28 shrink-0 font-mono text-xs font-semibold tracking-[0.08em] ${v.tone}`}>
                {v.code}
              </dt>
              <dd className="text-sm text-[#bdb8a8]">{v.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col items-center justify-center gap-6 px-4 py-12">
        <p className="display text-xl uppercase tracking-wide lg:hidden">
          FieldProof <span className="font-mono text-[10px] tracking-[0.12em] text-signal-deep">QA DESK</span>
        </p>
        {children}
      </section>
    </main>
  );
}
