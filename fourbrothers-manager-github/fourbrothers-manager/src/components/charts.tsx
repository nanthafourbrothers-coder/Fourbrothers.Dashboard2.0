"use client";

// Small dependency free SVG charts. They measure the space they are given and redraw to fit it,
// so text stays readable on a phone and uses the room on a big screen.

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { formatNumber } from "@/lib/parse/normalize";

export const GREEN = "#16a34a";
export const RED = "#D31B25";
export const BLUE = "#2563eb";
const GRID = "#e7e7ea";
const MUTED = "#71717a";
const INK = "#3f3f46";

/** Colours for slices and legends. Red first, because it is the brand colour. */
export const PALETTE = ["#D31B25", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#64748b"];
const OTHERS = "#a1a1aa";

export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

/** Width of an element in pixels, kept up to date as the screen or window changes size. 0 until measured. */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.round(el.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface Point {
  label: string;
  in: number;
  out: number;
  onHand?: number;
}

export function Key({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={line ? "inline-block h-0.5 w-4" : "inline-block h-2.5 w-2.5 rounded-sm"} style={{ background: color }} /> {label}
    </span>
  );
}

/**
 * Stock in and out as bars, and (when `showStock`) the stock on hand as a second panel underneath,
 * lined up on the same dates. Tap or hover a date to read its numbers.
 */
export function InOutChart({ data, showStock = true }: { data: Point[]; showStock?: boolean }) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const hasStock = showStock && data.some((d) => d.onHand != null);

  let body: React.ReactNode;
  if (!data.length) {
    body = <p className="py-10 text-center text-sm text-ink-500">No stock movement for this selection.</p>;
  } else if (!width) {
    body = <div style={{ height: 220 }} />;
  } else {
    const W = Math.max(260, width);
    const narrow = W < 520;
    const barMax = niceMax(Math.max(...data.flatMap((d) => [d.in, d.out]), 1));
    const stocks = data.map((d) => d.onHand ?? 0);
    const sMax = niceMax(Math.max(1, ...stocks));
    const sMin = Math.min(0, ...stocks) < 0 ? -niceMax(-Math.min(0, ...stocks)) : 0;

    const widest = Math.max(formatNumber(barMax).length, hasStock ? Math.max(formatNumber(sMax).length, formatNumber(sMin).length) : 0);
    const pl = Math.max(32, 12 + widest * 6);
    const pr = 10;
    const iw = W - pl - pr;
    const slot = iw / data.length;
    const bw = Math.min(34, Math.max(3, (slot - 6) / 2));
    const cx = (i: number) => pl + slot * i + slot / 2;

    // panel 1: bars
    const t1 = 22;
    const ph1 = narrow ? 120 : 150;
    const b1 = hasStock ? 6 : 26;
    const H1 = t1 + ph1 + b1;
    const y1 = (v: number) => t1 + ph1 - (v / barMax) * ph1;
    const ticks1 = narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    // panel 2: stock on hand
    const off = H1 + 10;
    const t2 = 22;
    const ph2 = narrow ? 80 : 100;
    const b2 = 26;
    const H = hasStock ? off + t2 + ph2 + b2 : H1;
    const y2 = (v: number) => off + t2 + ph2 - ((v - sMin) / (sMax - sMin || 1)) * ph2;
    const zeroY = y2(0);
    const ticks2 = sMin < 0 ? [sMax, 0, sMin] : [sMax, sMax / 2, 0];

    const every = Math.max(1, Math.ceil((44 * data.length) / iw));
    const showValues = slot >= 62;
    const axisBottom = hasStock ? off + t2 + ph2 : t1 + ph1;
    const line = hasStock ? data.map((d, i) => `${i ? "L" : "M"}${cx(i)},${y2(d.onHand ?? 0)}`).join(" ") : "";
    const area = hasStock && data.length > 1 ? `${line} L${cx(data.length - 1)},${zeroY} L${cx(0)},${zeroY} Z` : "";
    const lastStock = data[data.length - 1]?.onHand;

    const a = active != null ? data[active] : null;
    const tipLeft = active != null ? Math.min(Math.max(cx(active), 80), W - 80) : 0;

    body = (
      <div className="relative">
        {a && (
          <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs shadow-pop" style={{ left: tipLeft }}>
            <p className="font-semibold text-ink-900">{a.label}</p>
            <p className="text-green-700">In: {formatNumber(a.in)}</p>
            <p className="text-red-700">Out: {formatNumber(a.out)}</p>
            {hasStock && a.onHand != null && <p className={a.onHand < 0 ? "text-red-700" : "text-blue-700"}>On hand: {formatNumber(a.onHand)}</p>}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label="Chart of stock in and stock out by date, with the stock on hand underneath" onPointerLeave={() => setActive(null)}>
          <text x={pl} y={12} fontSize={11} fontWeight={600} fill={INK}>
            Pieces in and out
          </text>
          {ticks1.map((t) => {
            const v = Math.round(barMax * t);
            return (
              <g key={t}>
                <line x1={pl} x2={W - pr} y1={y1(v)} y2={y1(v)} stroke={GRID} strokeWidth={1} />
                <text x={pl - 6} y={y1(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>
                  {formatNumber(v)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => (
            <g key={i}>
              {active === i && <rect x={pl + slot * i} y={t1 - 4} width={slot} height={axisBottom - t1 + 4} fill="#f4f4f5" />}
              <rect x={cx(i) - bw - 1} y={y1(d.in)} width={bw} height={Math.max(0, t1 + ph1 - y1(d.in))} rx={2} fill={GREEN} />
              <rect x={cx(i) + 1} y={y1(d.out)} width={bw} height={Math.max(0, t1 + ph1 - y1(d.out))} rx={2} fill={RED} />
              {showValues && d.in > 0 && (
                <text x={cx(i) - bw / 2 - 1} y={y1(d.in) - 3} textAnchor="middle" fontSize={10} fontWeight={600} fill="#15803d">
                  {formatNumber(d.in)}
                </text>
              )}
              {showValues && d.out > 0 && (
                <text x={cx(i) + bw / 2 + 1} y={y1(d.out) - 3} textAnchor="middle" fontSize={10} fontWeight={600} fill="#b01019">
                  {formatNumber(d.out)}
                </text>
              )}
              {!hasStock && i % every === 0 && (
                <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={MUTED}>
                  {d.label}
                </text>
              )}
            </g>
          ))}

          {hasStock && (
            <g>
              <text x={pl} y={off + 12} fontSize={11} fontWeight={600} fill={INK}>
                Stock on hand
              </text>
              {sMin < 0 && <rect x={pl} y={zeroY} width={iw} height={off + t2 + ph2 - zeroY} fill="#fef2f2" />}
              {ticks2.map((v) => (
                <g key={v}>
                  <line x1={pl} x2={W - pr} y1={y2(v)} y2={y2(v)} stroke={v === 0 ? "#a1a1aa" : GRID} strokeWidth={v === 0 ? 1.25 : 1} strokeDasharray={v === 0 && sMin < 0 ? "4 3" : undefined} />
                  <text x={pl - 6} y={y2(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>
                    {formatNumber(Math.round(v))}
                  </text>
                </g>
              ))}
              {area && (
                <>
                  <defs>
                    <clipPath id={`${uid}pos`}>
                      <rect x={pl} y={off + t2 - 6} width={iw} height={Math.max(0, zeroY - (off + t2 - 6))} />
                    </clipPath>
                    <clipPath id={`${uid}neg`}>
                      <rect x={pl} y={zeroY} width={iw} height={Math.max(0, off + t2 + ph2 - zeroY)} />
                    </clipPath>
                  </defs>
                  <path d={area} fill={BLUE} opacity={0.12} clipPath={`url(#${uid}pos)`} />
                  <path d={area} fill={RED} opacity={0.18} clipPath={`url(#${uid}neg)`} />
                </>
              )}
              <path d={line} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" />
              {data.map((d, i) => (
                <g key={i}>
                  <circle cx={cx(i)} cy={y2(d.onHand ?? 0)} r={active === i ? 4.5 : 3} fill={(d.onHand ?? 0) < 0 ? RED : BLUE} stroke="#fff" strokeWidth={1.5} />
                  {i % every === 0 && (
                    <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={MUTED}>
                      {d.label}
                    </text>
                  )}
                </g>
              ))}
              {lastStock != null && (
                <text x={W - pr} y={off + 12} textAnchor="end" fontSize={11} fontWeight={600} fill={lastStock < 0 ? "#b01019" : BLUE}>
                  Now {formatNumber(lastStock)}
                </text>
              )}
            </g>
          )}

          {/* one invisible target per date, so a tap or hover shows its numbers */}
          {data.map((d, i) => (
            <rect key={i} x={pl + slot * i} y={t1 - 4} width={slot} height={axisBottom - t1 + 4} fill="transparent" onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)} style={{ cursor: "pointer" }}>
              <title>{`${d.label}: in ${formatNumber(d.in)}, out ${formatNumber(d.out)}${d.onHand != null ? `, on hand ${formatNumber(d.onHand)}` : ""}`}</title>
            </rect>
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div ref={ref} className="w-full">
      {body}
      {data.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
          <Key color={GREEN} label="Stock in" />
          <Key color={RED} label="Stock out" />
          {hasStock && <Key color={BLUE} label="Stock on hand" line />}
          <span className="text-ink-400">Tap a date to read its numbers</span>
        </div>
      )}
    </div>
  );
}

export interface Slice {
  label: string;
  qty: number;
  share?: number;
  sub?: string;
  /** fixed colour for this slice (otherwise one is picked from the palette) */
  color?: string;
}

/** Ring chart: how a total splits up. The legend next to it is a list you can click to filter. */
export function Donut({
  rows,
  centerTop,
  centerBottom,
  onPick,
  picked,
  empty = "Nothing to show.",
}: {
  rows: Slice[];
  centerTop?: string;
  centerBottom?: string;
  onPick?: (label: string) => void;
  picked?: string[];
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useElementWidth();
  const list = rows.filter((r) => r.qty > 0);
  if (!list.length)
    return (
      <div ref={ref}>
        <p className="py-6 text-center text-sm text-ink-500">{empty}</p>
      </div>
    );
  // ring beside its list when there is room, ring above its list when there is not
  const total = list.reduce((s, r) => s + r.qty, 0);
  const size = 144;
  const stroke = 24;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const color = (row: Slice, i: number) => row.color ?? (row.label.endsWith(" others") || row.label === "Not set" ? OTHERS : PALETTE[i % PALETTE.length]);
  let acc = 0;
  return (
    <div ref={ref} className={`flex gap-3 ${width >= 340 ? "flex-row items-start" : "flex-col items-center"}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Ring chart. ${list.map((x) => `${x.label} ${formatNumber(x.qty)}`).join(", ")}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f4f4f5" strokeWidth={stroke} />
          {list.map((row, i) => {
            const len = (row.qty / total) * C;
            const el = (
              <circle
                key={row.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={color(row, i)}
                strokeWidth={hover === i || picked?.includes(row.label) ? stroke + 4 : stroke}
                strokeDasharray={`${Math.max(0, len - (list.length > 1 ? 1.5 : 0))} ${C}`}
                strokeDashoffset={-acc}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              >
                <title>{`${row.label}: ${formatNumber(row.qty)} (${((row.qty / total) * 100).toFixed(0)}%)`}</title>
              </circle>
            );
            acc += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-semibold tabular-nums leading-tight text-ink-900">{hover != null ? formatNumber(list[hover].qty) : (centerTop ?? formatNumber(total))}</span>
          <span className="max-w-[88px] truncate text-[11px] leading-tight text-ink-500">{hover != null ? list[hover].label : (centerBottom ?? "total")}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-0.5 self-stretch text-sm">
        {list.map((row, i) => {
          const share = row.share ?? (row.qty / total) * 100;
          const on = picked?.includes(row.label);
          const inner = (
            <>
              <i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color(row, i) }} />
              <span className={`min-w-0 flex-1 truncate text-left ${on ? "font-semibold text-brand-700" : ""}`} title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 tabular-nums text-ink-700">{formatNumber(row.qty)}</span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-400">{share.toFixed(share >= 10 ? 0 : 1)}%</span>
            </>
          );
          return (
            <li key={row.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              {onPick && !row.label.endsWith(" others") ? (
                <button type="button" className="flex w-full items-center gap-2 rounded px-1 py-1 hover:bg-ink-50" onClick={() => onPick(row.label)} title="Click to filter by this">
                  {inner}
                </button>
              ) : (
                <div className="flex items-center gap-2 px-1 py-1">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HBars({ rows, empty = "Nothing to show.", onPick, picked, color = RED }: { rows: { label: string; qty: number; share?: number; sub?: string }[]; empty?: string; onPick?: (label: string) => void; picked?: string[]; color?: string }) {
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
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (r.qty / max) * 100)}%`, background: on ? "#8f121a" : color }} />
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
