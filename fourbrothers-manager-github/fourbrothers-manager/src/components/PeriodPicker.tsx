"use client";

// Choose a time window: ready-made periods, custom dates, or all time. Used by the product popup, registers and dashboard.

import { CalendarRange } from "lucide-react";
import { PERIOD_CHOICES, type PeriodId, type PeriodState } from "@/lib/analysis";

export function PeriodPicker({ value, onChange, compact }: { value: PeriodState; onChange: (v: PeriodState) => void; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        {!compact && <span className="label">Period</span>}
        <span className="relative block">
          <CalendarRange className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-400" />
          <select className="input w-52 pl-8" value={value.id} onChange={(e) => onChange({ ...value, id: e.target.value as PeriodId })} aria-label="Period">
            {PERIOD_CHOICES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </span>
      </label>
      {value.id === "custom" && (
        <>
          <label className="block">
            {!compact && <span className="label">From</span>}
            <input className="input" type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From date" />
          </label>
          <label className="block">
            {!compact && <span className="label">To</span>}
            <input className="input" type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To date" />
          </label>
        </>
      )}
    </div>
  );
}
