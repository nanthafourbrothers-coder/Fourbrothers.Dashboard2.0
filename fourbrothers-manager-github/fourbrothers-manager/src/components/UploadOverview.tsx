"use client";

// "What did my files turn into?" Shown on the dashboard for every file uploaded so far, and
// (the file and flow pieces) on the import page right before and after saving a file.

import { useMemo } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, FileSpreadsheet, FileUp } from "lucide-react";
import { useTable } from "@/lib/data/store";
import { useStockRows } from "@/lib/data/useStock";
import { buildUploadOverview, coverageText, timeAgo, type FileOverview, type Pipe } from "@/lib/overview";
import { formatDateDisplay, formatNumber } from "@/lib/parse/normalize";
import { Badge, useLocalPref } from "./ui";
import { BLUE, Donut, GREEN, HBars, RED, type Slice } from "./charts";

const TONE_BOX: Record<Pipe["tone"], string> = {
  green: "border-green-200 bg-green-50",
  red: "border-red-200 bg-red-50",
  blue: "border-blue-200 bg-blue-50",
  amber: "border-amber-200 bg-amber-50",
  gray: "border-ink-200 bg-ink-50",
};
const TONE_TEXT: Record<Pipe["tone"], string> = { green: "text-green-800", red: "text-red-800", blue: "text-blue-800", amber: "text-amber-800", gray: "text-ink-800" };

// ---------------------------------------------------------------- saved / skipped bar

export function SavedBar({ saved, skipped }: { saved: number; skipped: number }) {
  const total = saved + skipped;
  if (!total) return null;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-ink-200" role="img" aria-label={`${formatNumber(saved)} saved, ${formatNumber(skipped)} skipped`}>
      <div style={{ width: `${(saved / total) * 100}%`, background: GREEN }} />
    </div>
  );
}

// ---------------------------------------------------------------- file -> what it became -> where to see it

/** One row of the flow: the file(s), what they became, and a button to the screen where it shows. */
export function FlowRow({ pipe }: { pipe: Pipe }) {
  const shown = pipe.files.slice(0, 3);
  const more = pipe.files.length - shown.length;
  return (
    <li className="rounded-2xl border border-ink-200 bg-white p-3 transition hover:border-ink-300 md:flex md:items-center md:gap-3">
      <div className="min-w-0 space-y-1.5 md:w-[34%] md:shrink-0">
        {shown.map((f, i) => (
          <div key={i} className="flex items-start gap-2">
            <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-900" title={f.name}>
                {f.name}
              </p>
              <p className="truncate text-xs text-ink-500">{f.kindLabel}</p>
            </div>
          </div>
        ))}
        {more > 0 && <p className="pl-6 text-xs text-ink-500">+ {more} more file{more === 1 ? "" : "s"}</p>}
      </div>

      <Arrow />

      <div className={`min-w-0 rounded-xl border px-3 py-2 md:flex-1 ${TONE_BOX[pipe.tone]}`}>
        <p className={`text-sm font-semibold ${TONE_TEXT[pipe.tone]}`} title={pipe.what}>{pipe.title}</p>
        <p className="mt-1 text-sm">
          <b className="text-lg tabular-nums text-ink-900">{formatNumber(pipe.saved)}</b> <span className="text-ink-600">saved</span>
          {pipe.skipped > 0 && (
            <span className="text-ink-500">
              {" "}
              · {formatNumber(pipe.skipped)} skipped
            </span>
          )}
        </p>
        <div className="mt-1">
          <SavedBar saved={pipe.saved} skipped={pipe.skipped} />
        </div>
      </div>

      <Arrow />

      <Link href={pipe.href} className="btn mt-1 w-full md:mt-0 md:w-auto md:shrink-0">
        Open
      </Link>
    </li>
  );
}

function Arrow() {
  return (
    <span className="flex justify-center py-1 text-ink-300 md:py-0" aria-hidden>
      <ArrowDown className="h-5 w-5 md:hidden" />
      <ArrowRight className="hidden h-5 w-5 md:block" />
    </span>
  );
}

// ---------------------------------------------------------------- what is inside one file

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2.5">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-ink-900">{value}</p>
      {sub && <p className="truncate text-xs text-ink-400">{sub}</p>}
    </div>
  );
}

/** A month-by-month strip of bars: units per month in a file. */
function MonthBars({ months, color }: { months: { key: string; label: string; qty: number }[]; color: string }) {
  const max = Math.max(...months.map((m) => m.qty), 1);
  const every = Math.max(1, Math.ceil(months.length / 6));
  return (
    <div>
      <div className="flex h-20 items-end gap-0.5" role="img" aria-label={`Units per month: ${months.map((m) => `${m.label} ${formatNumber(m.qty)}`).join(", ")}`}>
        {months.map((m) => (
          <div key={m.key} className="flex h-full min-w-0 flex-1 items-end" title={`${m.label}: ${formatNumber(m.qty)}`}>
            <div className="w-full rounded-t" style={{ height: `${m.qty ? Math.max(4, (m.qty / max) * 100) : 0}%`, background: color }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-ink-500">
        {months.map((m, i) => (
          <span key={m.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
            {i % every === 0 ? m.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A short, clear picture of what a file contains: totals, dates, busiest months, top items and places. */
export function FileOverviewCard({ overview: o, direction, heading = "What is in this file" }: { overview: FileOverview; direction?: "IN" | "OUT" | "BOTH"; heading?: string }) {
  if (!o.lines) return null;
  const color = direction === "IN" ? GREEN : direction === "OUT" ? RED : BLUE;
  const dates = coverageText(o);
  return (
    <div className="space-y-3 rounded-2xl border border-ink-200 bg-white p-4 shadow-card">
      <div>
        <p className="text-sm font-semibold text-ink-900">{heading}</p>
        {dates && <p className="text-xs text-ink-500">{dates}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label="Lines" value={formatNumber(o.lines)} />
        <Mini label="Pieces" value={formatNumber(o.units)} />
        <Mini label="Items" value={formatNumber(o.items)} />
        <Mini label="Months" value={formatNumber(o.months.length)} sub={o.first && o.last ? `${formatDateDisplay(o.first)} to ${formatDateDisplay(o.last)}` : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {o.months.length > 1 && (
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold text-ink-700">Pieces per month</p>
            <MonthBars months={o.months} color={color} />
          </div>
        )}
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold text-ink-700">Biggest items</p>
          <HBars rows={o.topItems.slice(0, 6)} color={color} />
        </div>
        {o.topStates.length > 0 ? (
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold text-ink-700">Biggest states</p>
            <HBars rows={o.topStates.slice(0, 6)} color={color} />
          </div>
        ) : o.topParties.length > 0 ? (
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold text-ink-700">Biggest parties</p>
            <HBars rows={o.topParties.slice(0, 6)} color={color} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard section

const FLAG_SLICES: { key: "ok" | "low" | "out" | "negative" | "uncounted"; label: string; color: string }[] = [
  { key: "ok", label: "In stock", color: "#16a34a" },
  { key: "low", label: "Running low", color: "#f59e0b" },
  { key: "out", label: "Out of stock", color: "#D31B25" },
  { key: "negative", label: "Below zero", color: "#8f121a" },
  { key: "uncounted", label: "No count yet", color: "#a1a1aa" },
];

export function UploadOverview() {
  const batches = useTable("import_batches");
  const movements = useTable("stock_movements");
  const aliases = useTable("product_aliases");
  const { rows: stock } = useStockRows();
  const [open, setOpen] = useLocalPref<boolean>("dash:uploads", true);

  const o = useMemo(() => buildUploadOverview(batches.rows, movements.rows, aliases.rows, stock), [batches.rows, movements.rows, aliases.rows, stock]);
  const health: Slice[] = FLAG_SLICES.map((f) => ({ label: f.label, qty: o.health.flags[f.key], color: f.color })).filter((s) => s.qty > 0);
  const linkedPct = o.health.stockLines ? Math.round(((o.health.stockLines - o.health.unlinkedLines) / o.health.stockLines) * 100) : 100;
  const maxIn = Math.max(...o.coverage.months.map((m) => m.in), 1);
  const maxOut = Math.max(...o.coverage.months.map((m) => m.out), 1);
  const every = Math.max(1, Math.ceil(o.coverage.months.length / 8));
  const period = o.coverage.first && o.coverage.last ? `${formatDateDisplay(o.coverage.first)} to ${formatDateDisplay(o.coverage.last)}` : "No dates yet";

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="uploads-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="uploads-title" className="text-base font-semibold text-ink-900">
          Uploaded files
        </h2>
        <div className="flex items-center gap-2">
          <Link href="/import" className="btn btn-sm btn-primary">
            <FileUp className="h-3.5 w-3.5" /> Upload
          </Link>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? (
              <>
                Hide <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Show <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Mini label="Files" value={formatNumber(o.fileCount)} />
            <Mini label="Rows saved" value={formatNumber(o.saved)} sub={o.rows ? `of ${formatNumber(o.rows)}` : undefined} />
            <Mini label="Skipped" value={formatNumber(o.skipped)} sub="duplicates or unusable" />
            <Mini label="Last upload" value={timeAgo(o.lastUpload)} />
            <div className="col-span-2 md:col-span-1">
              <Mini label="Covers" value={o.coverage.months.length ? `${formatNumber(o.coverage.months.length)} month${o.coverage.months.length === 1 ? "" : "s"}` : "None"} sub={period} />
            </div>
          </div>

          {o.pipes.length > 0 ? (
            <div>
              <div className="mb-2 hidden items-center gap-3 px-3 text-xs font-semibold tracking-wide text-ink-500 md:flex">
                <span className="w-[34%] shrink-0">FILES</span>
                <span className="w-5" />
                <span className="flex-1">SAVED AS</span>
                <span className="w-5" />
                <span className="w-24 shrink-0" />
              </div>
              <ul className="space-y-2">
                {o.pipes.map((p) => (
                  <FlowRow key={p.key} pipe={p} />
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-sm text-ink-500">No files uploaded yet.</p>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-semibold text-ink-900">Months covered</h3>
              {o.coverage.months.length ? (
                <div className="space-y-1">
                  {(
                    [
                      ["Sales", "out", RED, maxOut],
                      ["Purchases", "in", GREEN, maxIn],
                    ] as const
                  ).map(([label, key, color, max]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-[4.5rem] shrink-0 text-xs text-ink-600">{label}</span>
                      <div className="flex flex-1 gap-0.5" role="img" aria-label={`${label} lines per month`}>
                        {o.coverage.months.map((m) => {
                          const v = m[key];
                          return <i key={m.key} title={`${m.label}: ${formatNumber(v)} ${label.toLowerCase()} lines`} className="block h-7 min-w-0 flex-1 rounded-sm" style={{ background: v ? color : "#f4f4f5", opacity: v ? 0.25 + 0.75 * (v / max) : 1 }} />;
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <span className="w-[4.5rem] shrink-0" />
                    <div className="flex flex-1 gap-0.5 text-[10px] text-ink-500">
                      {o.coverage.months.map((m, i) => (
                        <span key={m.key} className="min-w-0 flex-1 whitespace-nowrap text-center">
                          {i % every === 0 ? m.label : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-ink-500">No dated stock lines yet.</p>
              )}
            </div>

            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-semibold text-ink-900">Stock status</h3>
              <Donut rows={health} centerTop={formatNumber(o.health.items)} centerBottom="items" empty="No stock items yet." />
              <div className="mt-3">
                <div className="flex items-baseline justify-between text-xs text-ink-600">
                  <span>Lines linked to an item</span>
                  <b className={linkedPct === 100 ? "text-green-700" : "text-amber-700"}>{linkedPct}%</b>
                </div>
                <div className="mt-1 h-2 rounded-full bg-ink-100">
                  <div className="h-2 rounded-full" style={{ width: `${linkedPct}%`, background: linkedPct === 100 ? GREEN : "#f59e0b" }} />
                </div>
                {o.health.unlinkedNames > 0 ? (
                  <p className="mt-1 text-xs text-amber-800">
                    {formatNumber(o.health.unlinkedNames)} name{o.health.unlinkedNames === 1 ? "" : "s"} not linked.{" "}
                    <Link href="/mapping" className="font-medium underline">
                      Match
                    </Link>
                  </p>
                ) : (
                  o.health.stockLines > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> All linked
                    </p>
                  )
                )}
              </div>
            </div>
          </div>

          {o.recent.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-900">Latest uploads</h3>
              <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200">
                {o.recent.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 basis-48 truncate font-medium" title={f.name}>
                      {f.name}
                    </span>
                    <Badge tone="brand">{f.kindLabel}</Badge>
                    <span className="text-xs text-ink-500">{f.destLabel}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs tabular-nums text-ink-600">
                      <b className="text-green-700">{formatNumber(f.saved)}</b> saved
                      {f.skipped > 0 && <span className="text-ink-500">{formatNumber(f.skipped)} skipped</span>}
                      <span className="w-20 text-right text-ink-400">{timeAgo(f.when)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
