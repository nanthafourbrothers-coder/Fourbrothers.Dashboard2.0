"use client";

// The visual pieces of the product popup: the stock equation, the sold / left bar,
// the plain-words summary and the "where it came from, where it went" flow diagram.

import { AlertTriangle, ArrowDown, CheckCircle2, Info, XCircle } from "lucide-react";
import type { Kpis } from "@/lib/analysis";
import type { FlowNode, ProductFlow, ProductMeaning, Tone } from "@/lib/overview";
import { formatNumber } from "@/lib/parse/normalize";
import { BLUE, GREEN, Key, RED, useElementWidth } from "./charts";

// ---------------------------------------------------------------- opening + in - out = on hand

export function StockEquation({ kpis }: { kpis: Kpis }) {
  const neg = kpis.onHand < 0;
  const cards: { label: string; sign: string; op: string; value: number; box: string; text: string; wide?: boolean }[] = [
    { label: "Opening", sign: "", op: "", value: kpis.opening, box: "border-ink-200 bg-white", text: "text-ink-900" },
    { label: "In (purchases)", sign: "+ ", op: "+", value: kpis.in, box: "border-green-200 bg-green-50", text: "text-green-700" },
    { label: "Out (sales)", sign: "− ", op: "−", value: kpis.out, box: "border-red-200 bg-red-50", text: "text-red-700" },
    { label: "Adjusted", sign: "± ", op: "±", value: kpis.adjust, box: "border-amber-200 bg-amber-50", text: "text-amber-800" },
    { label: "On hand", sign: "= ", op: "=", value: kpis.onHand, box: neg ? "border-red-300 bg-red-50" : "border-blue-200 bg-blue-50", text: neg ? "text-red-700" : "text-blue-700", wide: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch sm:gap-1.5" role="group" aria-label="Opening plus in minus out plus adjusted equals on hand">
      {cards.map((c, i) => (
        <div key={c.label} className="contents sm:flex sm:flex-1 sm:items-stretch sm:gap-1.5">
          {i > 0 && (
            <span className="hidden items-center text-lg font-semibold text-ink-400 sm:flex" aria-hidden>
              {c.op}
            </span>
          )}
          <div className={`min-w-0 rounded-lg border px-3 py-2 sm:flex-1 ${c.box} ${c.wide ? "col-span-2" : ""}`}>
            <p className="text-xs text-ink-600">
              <span className="sm:hidden">{c.sign}</span>
              {c.label}
            </p>
            <p className={`text-xl font-semibold tabular-nums ${c.text}`}>{formatNumber(c.value)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- how much of the stock was sold

/** One bar: of everything that was available, how much is sold and how much is left. */
export function SoldLeftBar({ kpis }: { kpis: Kpis }) {
  const available = kpis.opening + kpis.in + Math.max(0, kpis.adjust);
  const sold = kpis.out + Math.max(0, -kpis.adjust);
  const total = Math.max(available, sold);
  if (total <= 0) return null;
  const soldOk = Math.min(sold, available);
  const left = Math.max(0, available - sold);
  const gap = Math.max(0, sold - available);
  const pct = (n: number) => `${(n / total) * 100}%`;
  const soldShare = available > 0 ? Math.round((soldOk / available) * 100) : 100;
  return (
    <div>
      <p className="mb-1.5 text-sm text-ink-700">
        {gap > 0 ? (
          <>
            <b>{formatNumber(sold)}</b> sold, but only <b>{formatNumber(available)}</b> {available === 1 ? "was" : "were"} recorded as available. <b className="text-red-700">{formatNumber(gap)}</b> more than recorded.
          </>
        ) : (
          <>
            Of <b>{formatNumber(available)}</b> available, <b className="text-red-700">{formatNumber(sold)}</b> sold ({soldShare}%) and <b className="text-blue-700">{formatNumber(left)}</b> left.
          </>
        )}
      </p>
      <div className="flex h-5 overflow-hidden rounded-full bg-ink-100" role="img" aria-label={`Sold ${formatNumber(sold)}, left ${formatNumber(left)}${gap ? `, not recorded ${formatNumber(gap)}` : ""}`}>
        {soldOk > 0 && <div style={{ width: pct(soldOk), background: RED }} title={`Sold ${formatNumber(soldOk)}`} />}
        {gap > 0 && <div style={{ width: pct(gap), background: "repeating-linear-gradient(45deg,#8f121a,#8f121a 4px,#d31b25 4px,#d31b25 8px)" }} title={`Sold but not recorded as received: ${formatNumber(gap)}`} />}
        {left > 0 && <div style={{ width: pct(left), background: BLUE }} title={`Left ${formatNumber(left)}`} />}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
        <Key color={RED} label="Sold" />
        <Key color={BLUE} label="Left" />
        {gap > 0 && <Key color="#8f121a" label="Sold but never recorded as received" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the plain-words summary

const MEANING_STYLE: Record<Tone, { box: string; icon: React.ReactNode }> = {
  green: { box: "border-green-200 bg-green-50 text-green-900", icon: <CheckCircle2 className="h-5 w-5 text-green-600" /> },
  amber: { box: "border-amber-200 bg-amber-50 text-amber-900", icon: <AlertTriangle className="h-5 w-5 text-amber-600" /> },
  red: { box: "border-red-200 bg-red-50 text-red-900", icon: <XCircle className="h-5 w-5 text-red-600" /> },
  gray: { box: "border-ink-200 bg-ink-50 text-ink-800", icon: <Info className="h-5 w-5 text-ink-500" /> },
};

export function MeaningCard({ meaning }: { meaning: ProductMeaning }) {
  const st = MEANING_STYLE[meaning.tone];
  return (
    <div className={`flex gap-3 rounded-xl border p-3 ${st.box}`}>
      <span className="mt-0.5 shrink-0">{st.icon}</span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{meaning.headline}</p>
        <ul className="mt-1 space-y-1">
          {meaning.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- where it came from, where it went

const nodeColor = (n: FlowNode, side: "src" | "sink"): string => (n.kind === "gap" ? "#8f121a" : n.kind === "left" ? BLUE : side === "src" ? (n.label === "Opening stock" ? "#71717a" : GREEN) : RED);

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/**
 * Left: what filled the stock. Middle: this item. Right: where it went and what is left.
 * Wide screens get a flow diagram with ribbons as thick as the numbers; phones get the same story top to bottom.
 */
export function SupplyFlow({ flow, name }: { flow: ProductFlow; name: string }) {
  const [ref, width] = useElementWidth();
  const empty = !flow.sources.length && !flow.sinks.length;
  const wide = width >= 700;
  let body: React.ReactNode;
  if (empty) body = <p className="py-8 text-center text-sm text-ink-500">No stock to draw for this selection.</p>;
  else if (!width) body = <div style={{ height: 200 }} />;
  else if (wide) body = <WideFlow flow={flow} name={name} width={width} />;
  else body = <StackedFlow flow={flow} name={name} />;
  return (
    <div ref={ref} className="w-full">
      {body}
    </div>
  );
}

function WideFlow({ flow, name, width }: { flow: ProductFlow; name: string; width: number }) {
  const W = width;
  const colW = Math.min(230, Math.round(W * 0.27));
  const midW = Math.min(180, Math.round(W * 0.2));
  const gap = (W - 2 * colW - midW) / 2;
  const leftX = 0;
  const midX = colW + gap;
  const rightX = W - colW;
  const rowH = 52;
  const nodeH = 40;
  const pad = 22;
  const rows = Math.max(flow.sources.length, flow.sinks.length, 3);
  const H = pad * 2 + rows * rowH;
  const maxQty = Math.max(...flow.sources.map((n) => n.qty), ...flow.sinks.map((n) => n.qty), 1);
  const ribbon = (q: number) => Math.max(3, (q / maxQty) * 30);
  const colTop = (count: number) => pad + ((rows - count) * rowH) / 2;
  const midTop = pad;
  const midH = H - pad * 2;
  const chars = Math.max(10, Math.floor((colW - 22) / 6.4));

  // where each ribbon meets the middle box: spread evenly down its edge
  const slot = (i: number, count: number) => midTop + 24 + ((midH - 48) * (count === 1 ? 0.5 : i / (count - 1)));

  const link = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`Flow diagram. ${flow.sources.map((n) => `${n.label} ${formatNumber(n.qty)}`).join(", ")} flow into ${name}. ${flow.sinks.map((n) => `${n.label} ${formatNumber(n.qty)}`).join(", ")} flow out.`}>
      <text x={leftX} y={13} fontSize={11} fontWeight={600} fill="#15803d">
        CAME FROM
      </text>
      <text x={W} y={13} fontSize={11} fontWeight={600} fill="#b01019" textAnchor="end">
        WENT TO
      </text>

      {flow.sources.map((n, i) => {
        const y = colTop(flow.sources.length) + i * rowH + rowH / 2;
        const c = nodeColor(n, "src");
        return (
          <g key={`s${i}`}>
            <path d={link(leftX + colW, y, midX, slot(i, flow.sources.length))} fill="none" stroke={c} strokeOpacity={0.28} strokeWidth={ribbon(n.qty)} />
            <rect x={leftX} y={y - nodeH / 2} width={colW} height={nodeH} rx={8} fill="#fff" stroke="#e4e4e7" />
            <rect x={leftX} y={y - nodeH / 2} width={5} height={nodeH} rx={2.5} fill={c} />
            <text x={leftX + 14} y={y - 3} fontSize={12} fontWeight={600} fill="#27272a">
              {clip(n.label, chars - 6)}
            </text>
            <text x={leftX + 14} y={y + 12} fontSize={11} fill="#71717a">
              {n.sub ? clip(n.sub, chars - 8) : ""}
            </text>
            <text x={leftX + colW - 10} y={y + 5} fontSize={13} fontWeight={700} fill={c} textAnchor="end">
              {formatNumber(n.qty)}
            </text>
            <title>{`${n.label}: ${formatNumber(n.qty)}`}</title>
          </g>
        );
      })}

      {flow.sinks.map((n, i) => {
        const y = colTop(flow.sinks.length) + i * rowH + rowH / 2;
        const c = nodeColor(n, "sink");
        return (
          <g key={`k${i}`}>
            <path d={link(midX + midW, slot(i, flow.sinks.length), rightX, y)} fill="none" stroke={c} strokeOpacity={0.28} strokeWidth={ribbon(n.qty)} />
            <rect x={rightX} y={y - nodeH / 2} width={colW} height={nodeH} rx={8} fill="#fff" stroke="#e4e4e7" />
            <rect x={rightX + colW - 5} y={y - nodeH / 2} width={5} height={nodeH} rx={2.5} fill={c} />
            <text x={rightX + 12} y={y - 3} fontSize={12} fontWeight={600} fill="#27272a">
              {clip(n.label, chars - 6)}
            </text>
            <text x={rightX + 12} y={y + 12} fontSize={11} fill="#71717a">
              {n.sub ? clip(n.sub, chars - 8) : ""}
            </text>
            <text x={rightX + colW - 14} y={y + 5} fontSize={13} fontWeight={700} fill={c} textAnchor="end">
              {formatNumber(n.qty)}
            </text>
            <title>{`${n.label}: ${formatNumber(n.qty)}`}</title>
          </g>
        );
      })}

      <rect x={midX} y={midTop} width={midW} height={midH} rx={12} fill="#18181c" />
      <text x={midX + midW / 2} y={midTop + midH / 2 - 22} textAnchor="middle" fontSize={11} fill="#a1a1aa">
        THIS ITEM
      </text>
      <text x={midX + midW / 2} y={midTop + midH / 2 - 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff">
        {clip(name, Math.floor((midW - 20) / 7.4))}
      </text>
      <text x={midX + midW / 2} y={midTop + midH / 2 + 22} textAnchor="middle" fontSize={22} fontWeight={700} fill="#fff">
        {formatNumber(flow.total)}
      </text>
      <text x={midX + midW / 2} y={midTop + midH / 2 + 38} textAnchor="middle" fontSize={11} fill="#a1a1aa">
        pieces in this view
      </text>
    </svg>
  );
}

function FlowList({ nodes, side }: { nodes: FlowNode[]; side: "src" | "sink" }) {
  const max = Math.max(...nodes.map((n) => n.qty), 1);
  return (
    <ul className="space-y-2.5">
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
            <div className="mt-0.5 h-2 rounded-full bg-ink-100">
              <div className="h-2 rounded-full" style={{ width: `${Math.max(3, (n.qty / max) * 100)}%`, background: c }} />
            </div>
            {n.sub && <p className="mt-0.5 text-xs text-ink-500">{n.sub}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function StackedFlow({ flow, name }: { flow: ProductFlow; name: string }) {
  return (
    <div className="space-y-2">
      {flow.sources.length > 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50/50 p-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-green-800">CAME FROM</p>
          <FlowList nodes={flow.sources} side="src" />
        </div>
      )}
      <div className="flex justify-center text-ink-400" aria-hidden>
        <ArrowDown className="h-5 w-5" />
      </div>
      <div className="rounded-xl bg-ink-900 px-4 py-3 text-center text-white">
        <p className="text-[11px] tracking-wide text-ink-300">THIS ITEM</p>
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-2xl font-bold tabular-nums">{formatNumber(flow.total)}</p>
        <p className="text-[11px] text-ink-300">pieces in this view</p>
      </div>
      <div className="flex justify-center text-ink-400" aria-hidden>
        <ArrowDown className="h-5 w-5" />
      </div>
      {flow.sinks.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-red-800">WENT TO</p>
          <FlowList nodes={flow.sinks} side="sink" />
        </div>
      )}
    </div>
  );
}
