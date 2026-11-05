"use client";

// The visual pieces of the product popup: the stock equation, the status card with the sold / left bar,
// and the "came from / went to" flow diagram. Light colours, very little text.

import { useId } from "react";
import { AlertTriangle, Archive, ArrowDown, ArrowDownToLine, ArrowUpFromLine, Boxes, CheckCircle2, Info, SlidersHorizontal, XCircle } from "lucide-react";
import type { Kpis } from "@/lib/analysis";
import type { FlowNode, ProductFlow, ProductMeaning, Tone } from "@/lib/overview";
import { formatNumber } from "@/lib/parse/normalize";
import { BLUE, GREEN, RED, useElementWidth } from "./charts";

const SLATE = "#64748b";
const AMBER = "#d97706";

// ---------------------------------------------------------------- opening + in - out = on hand

export function StockEquation({ kpis }: { kpis: Kpis }) {
  const neg = kpis.onHand < 0;
  const cards = [
    { label: "Opening", op: "", value: kpis.opening, icon: <Archive className="h-4 w-4" />, tint: "bg-slate-100 text-slate-600", num: "text-ink-900" },
    { label: "Bought", op: "+", value: kpis.in, icon: <ArrowDownToLine className="h-4 w-4" />, tint: "bg-green-100 text-green-700", num: "text-green-700" },
    { label: "Sold", op: "−", value: kpis.out, icon: <ArrowUpFromLine className="h-4 w-4" />, tint: "bg-red-100 text-red-700", num: "text-red-700" },
    { label: "Adjusted", op: "±", value: kpis.adjust, icon: <SlidersHorizontal className="h-4 w-4" />, tint: "bg-amber-100 text-amber-700", num: "text-amber-700" },
    { label: "On hand", op: "=", value: kpis.onHand, icon: <Boxes className="h-4 w-4" />, tint: neg ? "bg-red-600 text-white" : "bg-blue-600 text-white", num: neg ? "text-red-700" : "text-blue-700", strong: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" role="group" aria-label="Opening plus bought minus sold plus adjusted equals on hand">
      {cards.map((c, i) => (
        <div key={c.label} className={`relative rounded-2xl border bg-white p-3 shadow-card ${c.strong ? (neg ? "col-span-2 border-red-200 sm:col-span-1" : "col-span-2 border-blue-200 sm:col-span-1") : "border-ink-200"}`}>
          {i > 0 && (
            <span className="absolute -left-[0.95rem] top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-ink-200 bg-white text-xs font-semibold text-ink-500 sm:flex" aria-hidden>
              {c.op}
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full ${c.tint}`}>{c.icon}</span>
            <span className="text-xs font-medium text-ink-500">{c.label}</span>
          </div>
          <p className={`mt-2 text-2xl font-semibold tabular-nums ${c.num}`}>{formatNumber(c.value)}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- status, with the sold / left bar

const TONE: Record<Tone, { ring: string; icon: React.ReactNode; title: string }> = {
  green: { ring: "bg-green-100", icon: <CheckCircle2 className="h-5 w-5 text-green-700" />, title: "text-green-800" },
  amber: { ring: "bg-amber-100", icon: <AlertTriangle className="h-5 w-5 text-amber-700" />, title: "text-amber-800" },
  red: { ring: "bg-red-100", icon: <XCircle className="h-5 w-5 text-red-700" />, title: "text-red-800" },
  gray: { ring: "bg-slate-100", icon: <Info className="h-5 w-5 text-slate-600" />, title: "text-ink-800" },
};

/** One bar: of everything that was available, how much is sold, how much is left, how much has no stock record. */
export function SoldLeftBar({ kpis }: { kpis: Kpis }) {
  const available = kpis.opening + kpis.in + Math.max(0, kpis.adjust);
  const sold = kpis.out + Math.max(0, -kpis.adjust);
  const total = Math.max(available, sold);
  if (total <= 0) return null;
  const soldOk = Math.min(sold, available);
  const left = Math.max(0, available - sold);
  const gap = Math.max(0, sold - available);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Num color={RED} label="Sold" value={sold} />
          <Num color={BLUE} label="Left" value={left} />
          {gap > 0 && <Num color={AMBER} label="Not recorded" value={gap} hatch />}
        </div>
        {gap === 0 && available > 0 && <p className="text-sm font-semibold tabular-nums text-ink-700">{Math.round((soldOk / available) * 100)}% sold</p>}
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-ink-100" role="img" aria-label={`Sold ${formatNumber(sold)}, left ${formatNumber(left)}${gap ? `, not recorded ${formatNumber(gap)}` : ""}`}>
        {soldOk > 0 && <div style={{ width: pct(soldOk), background: RED }} />}
        {gap > 0 && <div style={{ width: pct(gap), background: "repeating-linear-gradient(45deg,#fcd9a6,#fcd9a6 4px,#f5b455 4px,#f5b455 8px)" }} />}
        {left > 0 && <div style={{ width: pct(left), background: BLUE }} />}
      </div>
    </div>
  );
}

function Num({ color, label, value, hatch }: { color: string; label: string; value: number; hatch?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="h-2.5 w-2.5 shrink-0 translate-y-px rounded-full" style={hatch ? { background: "repeating-linear-gradient(45deg,#fcd9a6,#fcd9a6 2px,#f5b455 2px,#f5b455 4px)", boxShadow: `0 0 0 1px ${color}` } : { background: color }} />
      <span className="text-xs text-ink-500">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-ink-900">{formatNumber(value)}</span>
    </div>
  );
}

/** Status of the item in one headline, one short instruction, a few chips, and the sold / left bar. */
export function StatusCard({ meaning, kpis }: { meaning: ProductMeaning; kpis: Kpis }) {
  const t = TONE[meaning.tone];
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${t.ring}`}>{t.icon}</span>
        <div className="min-w-0">
          <p className={`text-base font-semibold ${t.title}`}>{meaning.headline}</p>
          {meaning.advice && <p className="text-sm text-ink-600">{meaning.advice}</p>}
        </div>
      </div>
      {meaning.facts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {meaning.facts.map((f) => (
            <span key={f.label} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-ink-50 px-3 py-1 text-xs ring-1 ring-inset ring-ink-200">
              <span className="shrink-0 text-ink-500">{f.label}</span>
              <b className="truncate font-semibold text-ink-900">{f.value}</b>
            </span>
          ))}
        </div>
      )}
      <div className="mt-4">
        <SoldLeftBar kpis={kpis} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- where it came from, where it went

function nodeColor(n: FlowNode, side: "src" | "sink"): string {
  if (n.kind === "gap") return AMBER;
  if (n.kind === "left") return BLUE;
  if (side === "src") return n.label === "Opening stock" ? SLATE : GREEN;
  return RED;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/**
 * Left: what filled the stock. Right: where it went and what is left. In the middle, ribbons as thick as the numbers
 * meet in one block. Wide screens get the diagram; phones get the same story top to bottom.
 */
export function SupplyFlow({ flow, name }: { flow: ProductFlow; name: string }) {
  const [ref, width] = useElementWidth();
  const empty = !flow.sources.length && !flow.sinks.length;
  const wide = width >= 640;
  let body: React.ReactNode;
  if (empty) body = <p className="py-8 text-center text-sm text-ink-500">No stock to draw for this selection.</p>;
  else if (!width) body = <div style={{ height: 200 }} />;
  else if (wide) body = <WideFlow flow={flow} name={name} width={width} />;
  else body = <StackedFlow flow={flow} />;
  return (
    <div ref={ref} className="w-full">
      {body}
    </div>
  );
}

function WideFlow({ flow, name, width }: { flow: ProductFlow; name: string; width: number }) {
  const uid = useId().replace(/:/g, "");
  const W = width;
  const nodeW = Math.min(220, Math.round(W * 0.27));
  const midW = Math.min(140, Math.round(W * 0.17));
  const midX = Math.round((W - midW) / 2);
  const rightX = W - nodeW;
  const GAP = 10;
  const MINH = 32;
  const TOP = 26;
  const total = Math.max(flow.total, 1);
  const k = 190 / total;
  const heights = (nodes: FlowNode[]) => nodes.map((n) => Math.max(MINH, n.qty * k));
  const hL = heights(flow.sources);
  const hR = heights(flow.sinks);
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const stack = (a: number[]) => sum(a) + GAP * Math.max(0, a.length - 1);
  const body = Math.max(stack(hL), stack(hR), 130);
  const H = TOP + body + 6;
  const startL = TOP + (body - stack(hL)) / 2;
  const startR = TOP + (body - stack(hR)) / 2;
  const midH = Math.max(sum(hL), sum(hR), 90);
  const midTop = TOP + (body - midH) / 2;
  const segL0 = midTop + (midH - sum(hL)) / 2;
  const segR0 = midTop + (midH - sum(hR)) / 2;
  const chars = Math.max(8, Math.floor((nodeW - 92) / 6.6));

  const ribbon = (x1: number, y1: number, x2: number, y2: number, h: number) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2} L${x2},${y2 + h} C${mx},${y2 + h} ${mx},${y1 + h} ${x1},${y1 + h} Z`;
  };

  let yl = startL;
  let sl = segL0;
  let yr = startR;
  let sr = segR0;
  const left = flow.sources.map((n, i) => {
    const h = hL[i];
    const out = { n, h, y: yl, seg: sl };
    yl += h + GAP;
    sl += h;
    return out;
  });
  const right = flow.sinks.map((n, i) => {
    const h = hR[i];
    const out = { n, h, y: yr, seg: sr };
    yr += h + GAP;
    sr += h;
    return out;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`Flow diagram. ${flow.sources.map((n) => `${n.label} ${formatNumber(n.qty)}`).join(", ")} flow into ${name}. ${flow.sinks.map((n) => `${n.label} ${formatNumber(n.qty)}`).join(", ")} flow out.`}>
      <defs>
        {[...left.map((x, i) => ({ id: `${uid}l${i}`, c: nodeColor(x.n, "src"), dir: 0 })), ...right.map((x, i) => ({ id: `${uid}r${i}`, c: nodeColor(x.n, "sink"), dir: 1 }))].map((g) => (
          <linearGradient key={g.id} id={g.id} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={g.dir ? "#94a3b8" : g.c} stopOpacity={g.dir ? 0.16 : 0.3} />
            <stop offset="1" stopColor={g.dir ? g.c : "#94a3b8"} stopOpacity={g.dir ? 0.3 : 0.16} />
          </linearGradient>
        ))}
      </defs>
      <text x={0} y={14} fontSize={11} fontWeight={600} fill="#9a9aa4" letterSpacing={0.6}>
        CAME FROM
      </text>
      <text x={W} y={14} fontSize={11} fontWeight={600} fill="#9a9aa4" letterSpacing={0.6} textAnchor="end">
        WENT TO
      </text>

      {left.map((x, i) => (
        <path key={`lr${i}`} d={ribbon(nodeW, x.y, midX, x.seg, x.h)} fill={`url(#${uid}l${i})`} />
      ))}
      {right.map((x, i) => (
        <path key={`rr${i}`} d={ribbon(midX + midW, x.seg, rightX, x.y, x.h)} fill={`url(#${uid}r${i})`} />
      ))}

      <rect x={midX} y={midTop} width={midW} height={midH} rx={14} fill="#f1f5f9" stroke="#cbd5e1" />
      <text x={midX + midW / 2} y={midTop + midH / 2 + 4} textAnchor="middle" fontSize={24} fontWeight={700} fill="#27272a">
        {formatNumber(flow.total)}
      </text>
      <text x={midX + midW / 2} y={midTop + midH / 2 + 22} textAnchor="middle" fontSize={11} fill="#767681">
        pieces
      </text>

      {left.map((x, i) => (
        <FlowBlock key={`ln${i}`} x={0} y={x.y} w={nodeW} h={x.h} node={x.n} color={nodeColor(x.n, "src")} side="src" chars={chars} />
      ))}
      {right.map((x, i) => (
        <FlowBlock key={`rn${i}`} x={rightX} y={x.y} w={nodeW} h={x.h} node={x.n} color={nodeColor(x.n, "sink")} side="sink" chars={chars} />
      ))}
    </svg>
  );
}

function FlowBlock({ x, y, w, h, node, color, side, chars }: { x: number; y: number; w: number; h: number; node: FlowNode; color: string; side: "src" | "sink"; chars: number }) {
  const gap = node.kind === "gap";
  const cy = y + h / 2 + 4.5;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={9} fill={color} fillOpacity={0.09} stroke={color} strokeOpacity={0.4} strokeDasharray={gap ? "4 3" : undefined} />
      <rect x={side === "src" ? x : x + w - 5} y={y} width={5} height={h} rx={2.5} fill={color} />
      <text x={side === "src" ? x + 16 : x + 12} y={cy} fontSize={13} fontWeight={600} fill="#27272a">
        {clip(node.label, chars)}
      </text>
      <text x={side === "src" ? x + w - 12 : x + w - 18} y={cy} fontSize={14} fontWeight={700} fill={color} textAnchor="end">
        {formatNumber(node.qty)}
      </text>
      <title>{`${node.label}: ${formatNumber(node.qty)}${node.sub ? ` (${node.sub})` : ""}`}</title>
    </g>
  );
}

function FlowList({ nodes, side }: { nodes: FlowNode[]; side: "src" | "sink" }) {
  const max = Math.max(...nodes.map((n) => n.qty), 1);
  return (
    <ul className="space-y-3">
      {nodes.map((n, i) => {
        const c = nodeColor(n, side);
        return (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium text-ink-800" title={n.label}>
                {n.label}
              </span>
              <span className="shrink-0 font-semibold tabular-nums" style={{ color: c }}>
                {formatNumber(n.qty)}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-ink-100">
              <div className="h-2 rounded-full" style={{ width: `${Math.max(3, (n.qty / max) * 100)}%`, background: c, opacity: n.kind === "gap" ? 0.55 : 1 }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function StackedFlow({ flow }: { flow: ProductFlow }) {
  return (
    <div>
      {flow.sources.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-ink-400">CAME FROM</p>
          <FlowList nodes={flow.sources} side="src" />
        </div>
      )}
      <div className="my-4 flex flex-col items-center text-ink-300" aria-hidden>
        <span className="h-3 w-px bg-ink-300" />
        <span className="rounded-full border border-ink-200 bg-ink-50 px-3 py-1 text-sm font-semibold tabular-nums text-ink-800">{formatNumber(flow.total)} pieces</span>
        <ArrowDown className="h-4 w-4" />
      </div>
      {flow.sinks.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-ink-400">WENT TO</p>
          <FlowList nodes={flow.sinks} side="sink" />
        </div>
      )}
    </div>
  );
}
