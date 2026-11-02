"use client";

// Small dependency free SVG charts used by the product popup.

import { formatNumber } from "@/lib/parse/normalize";

const GREEN = "#16a34a";
const RED = "#D31B25";
const GRID = "#e7e7ea";
const MUTED = "#71717a";

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

interface Point {
  label: string;
  in: number;
  out: number;
  onHand?: number;
}

export function InOutChart({ data, showStock = true }: { data: Point[]; showStock?: boolean }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-ink-500">No stock movement for this selection.</p>;
  const W = 900;
  const H = 250;
  const pad = { l: 46, r: showStock ? 46 : 10, t: 10, b: 28 };
  const barMax = niceMax(Math.max(...data.flatMap((d) => [d.in, d.out]), 1));
  const stocks = data.map((d) => d.onHand ?? 0);
  const sMin = Math.min(0, ...stocks);
  const sMax = Math.max(1, ...stocks);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / data.length;
  const bw = Math.min(24, Math.max(2, (slot - 4) / 2));
  const y = (v: number) => pad.t + ih - (v / barMax) * ih;
  const ys = (v: number) => pad.t + ih - ((v - sMin) / (sMax - sMin || 1)) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(barMax * t));
  const every = Math.max(1, Math.ceil(data.length / 12));
  const line = showStock && data.some((d) => d.onHand != null) ? data.map((d, i) => `${i ? "L" : "M"}${pad.l + slot * i + slot / 2},${ys(d.onHand ?? 0)}`).join(" ") : "";
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Chart of stock in, stock out and stock on hand">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={MUTED}>
              {formatNumber(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={i}>
              <title>{`${d.label}: in ${formatNumber(d.in)}, out ${formatNumber(d.out)}${d.onHand != null ? `, stock ${formatNumber(d.onHand)}` : ""}`}</title>
              <rect x={cx - bw - 1} y={y(d.in)} width={bw} height={Math.max(0, pad.t + ih - y(d.in))} rx={2} fill={GREEN} />
              <rect x={cx + 1} y={y(d.out)} width={bw} height={Math.max(0, pad.t + ih - y(d.out))} rx={2} fill={RED} />
              {i % every === 0 && (
                <text x={cx} y={H - 9} textAnchor="middle" fontSize={10} fill={MUTED}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        {line && (
          <>
            <path d={line} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />
            {data.map((d, i) => (
              <circle key={i} cx={pad.l + slot * i + slot / 2} cy={ys(d.onHand ?? 0)} r={2.5} fill="#2563eb" />
            ))}
            <text x={W - pad.r + 6} y={ys(sMax) + 3} fontSize={10} fill="#2563eb">
              {formatNumber(sMax)}
            </text>
            <text x={W - pad.r + 6} y={ys(sMin) + 3} fontSize={10} fill="#2563eb">
              {formatNumber(sMin)}
            </text>
          </>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-ink-600">
        <Key color={GREEN} label="Stock in" />
        <Key color={RED} label="Stock out" />
        {line && <Key color="#2563eb" label="Stock on hand (right scale)" line />}
      </div>
    </div>
  );
}

function Key({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={line ? "inline-block h-0.5 w-4" : "inline-block h-2.5 w-2.5 rounded-sm"} style={{ background: color }} /> {label}
    </span>
  );
}

export function HBars({ rows, empty = "Nothing to show.", onPick, picked }: { rows: { label: string; qty: number; share?: number; sub?: string }[]; empty?: string; onPick?: (label: string) => void; picked?: string[] }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-500">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.qty), 1);
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => {
        const on = picked?.includes(r.label);
        const body = (
          <>
            <div className="flex justify-between gap-2">
              <span className={`min-w-0 truncate ${on ? "font-semibold text-brand-700" : ""}`} title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums text-ink-700">
                {formatNumber(r.qty)}
                {r.share != null && <span className="ml-1.5 text-xs text-ink-400">{r.share.toFixed(r.share >= 10 ? 0 : 1)}%</span>}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-ink-100">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (r.qty / max) * 100)}%`, background: on ? "#8f121a" : RED }} />
            </div>
            {r.sub && <p className="mt-0.5 text-xs text-ink-400">{r.sub}</p>}
          </>
        );
        return (
          <li key={r.label}>
            {onPick && !r.label.endsWith(" others") ? (
              <button type="button" className="block w-full rounded px-1 py-0.5 text-left hover:bg-ink-50" onClick={() => onPick(r.label)} title="Click to filter by this">
                {body}
              </button>
            ) : (
              <div className="px-1 py-0.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
