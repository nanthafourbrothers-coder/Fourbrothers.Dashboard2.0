"use client";

// Dashboard: how much came in, how much went out, what is running low, where it sold.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useTable } from "@/lib/data/store";
import { unmappedNames } from "@/lib/stock";
import { useStockRows } from "@/lib/data/useStock";
import { addDaysYmd, aliasKey, formatDateDisplay, formatNumber, todayYmd } from "@/lib/parse/normalize";
import type { Movement } from "@/lib/types";
import { Badge, EmptyState, Field, PageHeader, Spinner, Stat, useLocalPref } from "@/components/ui";

type Range = "7" | "30" | "90" | "365" | "all" | "custom";
const RANGES: { id: Range; label: string }[] = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "365", label: "1 year" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function bucketOf(date: string, mode: "day" | "week" | "month"): string {
  if (mode === "day") return date;
  if (mode === "month") return date.slice(0, 7);
  const d = new Date(date + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Monday first
  return addDaysYmd(date, -dow);
}

function bucketLabel(b: string, mode: "day" | "week" | "month"): string {
  if (mode === "month") return new Date(b + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
  return new Date(b + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function DashboardPage() {
  const auth = useAuth();
  const movements = useTable("stock_movements");
  const products = useTable("products");
  const aliases = useTable("product_aliases");
  const shipments = useTable("shipments");
  const [range, setRange] = useLocalPref<Range>("dash:range", "30");
  const [from, setFrom] = useState(addDaysYmd(todayYmd(), -30));
  const [to, setTo] = useState(todayYmd());

  const loaded = movements.loaded && products.loaded && aliases.loaded;
  const today = todayYmd();

  const [start, end] = useMemo<[string | null, string | null]>(() => {
    if (range === "all") return [null, null];
    if (range === "custom") return [from || null, to || null];
    return [addDaysYmd(today, -(Number(range) - 1)), today];
  }, [range, from, to, today]);

  const inRange = useMemo(() => movements.rows.filter((m) => (!start || m.date >= start) && (!end || m.date <= end)), [movements.rows, start, end]);
  const { rows: stock } = useStockRows();
  const unmapped = useMemo(() => unmappedNames(movements.rows, aliases.rows).length, [movements.rows, aliases.rows]);

  const totals = useMemo(() => {
    let i = 0;
    let o = 0;
    const invoices = new Set<string>();
    for (const m of inRange) {
      const q = Number(m.qty) || 0;
      if (m.type === "IN") i += q;
      else if (m.type === "OUT") {
        o += q;
        if (m.voucher_no) invoices.add(`${m.voucher_type}|${m.voucher_no}`);
      }
    }
    return { i, o, invoices: invoices.size };
  }, [inRange]);

  // chart buckets
  const chart = useMemo(() => {
    if (!inRange.length) return { mode: "day" as const, data: [] as { label: string; in: number; out: number }[] };
    const dates = inRange.map((m) => m.date).sort();
    const span = daysBetween(start ?? dates[0], end ?? dates[dates.length - 1]);
    const mode = span <= 45 ? "day" : span <= 200 ? "week" : "month";
    const map = new Map<string, { in: number; out: number }>();
    for (const m of inRange) {
      if (m.type === "ADJUST") continue;
      const b = bucketOf(m.date, mode);
      const e = map.get(b) ?? { in: 0, out: 0 };
      if (m.type === "IN") e.in += Number(m.qty) || 0;
      else e.out += Number(m.qty) || 0;
      map.set(b, e);
    }
    const data = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([b, v]) => ({ label: bucketLabel(b, mode), ...v }));
    return { mode, data };
  }, [inRange, start, end]);

  const nameOf = useMemo(() => new Map(products.rows.map((p) => [p.id, p.name])), [products.rows]);

  const breakdowns = useMemo(() => {
    const items = new Map<string, number>();
    const channels = new Map<string, number>();
    const states = new Map<string, number>();
    for (const m of inRange) {
      if (m.type !== "OUT") continue;
      const q = Number(m.qty) || 0;
      const label = m.product_id ? (nameOf.get(m.product_id) ?? m.raw_name) : aliasKey(m.raw_name);
      items.set(label, (items.get(label) ?? 0) + q);
      const ch = m.channel || "Not set";
      channels.set(ch, (channels.get(ch) ?? 0) + q);
      const st = m.state || "Not set";
      states.set(st, (states.get(st) ?? 0) + q);
    }
    const top = (map: Map<string, number>, n: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return { items: top(items, 8), channels: top(channels, 6), states: top(states, 8) };
  }, [inRange, nameOf]);

  const attention = useMemo(() => stock.filter((s) => s.flag !== "ok" && s.flag !== "uncounted").sort((a, b) => a.on_hand - b.on_hand), [stock]);
  const counts = { uncounted: stock.filter((s) => s.flag === "uncounted").length, out: stock.filter((s) => s.flag === "out").length, low: stock.filter((s) => s.flag === "low").length, neg: stock.filter((s) => s.flag === "negative").length };
  const onHand = stock.reduce((s, r) => s + Math.max(0, r.on_hand), 0);

  const recent = useMemo(() => [...movements.rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.date.localeCompare(a.date)).slice(0, 8), [movements.rows]);
  const openShipments = shipments.rows.filter((s) => s.status === "Pending" || s.status === "Packed").length;

  if (!loaded) return <Spinner label="Loading your numbers" />;

  const empty = movements.rows.length === 0 && products.rows.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hello${auth.profile?.full_name ? ", " + auth.profile.full_name.split(" ")[0] : ""}`}
        subtitle="Stock position and movement for fourbrothers.in and your other sales channels."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
              {RANGES.map((r) => (
                <button key={r.id} onClick={() => setRange(r.id)} className={`rounded-md px-2.5 py-1 ${range === r.id ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"}`}>
                  {r.label}
                </button>
              ))}
            </div>
            {range === "custom" && (
              <>
                <Field label="From">
                  <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="To">
                  <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </>
            )}
          </div>
        }
      />

      {empty ? (
        <div className="card">
          <EmptyState
            title="Nothing here yet"
            text="Upload your Tally invoice register, purchase book or Shopify exports. Stock, sales and shipments appear here as soon as they are saved."
            action={
              <Link href="/import" className="btn btn-primary">
                Import your first file
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Stat label="Stock items" value={formatNumber(stock.length)} sub={`${formatNumber(onHand)} units on hand`} href="/stock" />
            <Stat label="Stock in (period)" value={formatNumber(totals.i)} tone="green" href="/movements?type=IN" />
            <Stat label="Stock out (period)" value={formatNumber(totals.o)} sub={`${formatNumber(totals.invoices)} invoices`} href="/movements?type=OUT" />
            <Stat label="Out of stock" value={counts.out} tone={counts.out ? "red" : undefined} href="/stock?flag=out" />
            <Stat label="Running low" value={counts.low} tone={counts.low ? "amber" : undefined} href="/stock?flag=low" />
            <Stat label="Shipments to send" value={openShipments} sub="Pending or packed" href="/shipments" />
          </div>

          {(unmapped > 0 || counts.neg > 0 || counts.uncounted > 0) && (
            <div className="card flex flex-wrap items-center gap-x-6 gap-y-1 border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
              {unmapped > 0 && (
                <span>
                  {formatNumber(unmapped)} names in your files are not linked to a stock item yet.{" "}
                  <Link className="font-medium underline" href="/mapping">
                    Match them
                  </Link>
                </span>
              )}
              {counts.uncounted > 0 && (
                <span>
                  {formatNumber(counts.uncounted)} items have no opening stock or counted lines yet.{" "}
                  <Link className="font-medium underline" href="/stock?flag=uncounted">
                    See them
                  </Link>
                </span>
              )}
              {counts.neg > 0 && (
                <span>
                  {counts.neg} item(s) show stock below zero. Usually opening stock or a purchase has not been entered.{" "}
                  <Link className="font-medium underline" href="/stock?flag=negative">
                    See them
                  </Link>
                </span>
              )}
            </div>
          )}

          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-900">Stock in and out ({chart.mode === "day" ? "per day" : chart.mode === "week" ? "per week" : "per month"})</h2>
              <div className="flex items-center gap-3 text-xs text-ink-600">
                <span className="flex items-center gap-1">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm bg-green-600" /> In
                </span>
                <span className="flex items-center gap-1">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-600" /> Out
                </span>
              </div>
            </div>
            {chart.data.length ? <BarChart data={chart.data} /> : <p className="py-10 text-center text-sm text-ink-500">No stock movement in this period.</p>}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Top selling items (period)">
              <Bars rows={breakdowns.items} />
            </Panel>
            <Panel title="Sales by channel (period)">
              <Bars rows={breakdowns.channels} />
            </Panel>
            <Panel title="Sales by state (period)">
              <Bars rows={breakdowns.states} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Needs restocking" action={<Link className="text-xs text-brand-700 hover:underline" href="/stock?flag=attention">See all {attention.length}</Link>}>
              {attention.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-500">Nothing is out or low.</p>
              ) : (
                <ul className="divide-y divide-ink-100 text-sm">
                  {attention.slice(0, 8).map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <b className="tabular-nums">{formatNumber(s.on_hand)}</b>
                      <Badge tone={s.flag === "low" ? "amber" : "red"}>{s.flag === "low" ? "Low" : s.flag === "out" ? "Out" : "Below zero"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Latest entries" action={<Link className="text-xs text-brand-700 hover:underline" href="/movements">Open all</Link>}>
              <ul className="divide-y divide-ink-100 text-sm">
                {recent.map((m: Movement) => (
                  <li key={m.id} className="flex items-center gap-2 py-1.5">
                    <Badge tone={m.type === "IN" ? "green" : m.type === "OUT" ? "red" : "amber"}>{m.type === "IN" ? "In" : m.type === "OUT" ? "Out" : "Adjust"}</Badge>
                    <span className="min-w-0 flex-1 truncate">{m.raw_name}</span>
                    <span className="tabular-nums">{formatNumber(m.qty)}</span>
                    <span className="w-24 text-right text-xs text-ink-500">{formatDateDisplay(m.date)}</span>
                  </li>
                ))}
                {!recent.length && <li className="py-6 text-center text-ink-500">No entries yet.</li>}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Bars({ rows }: { rows: [string, number][] }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-500">No sales in this period.</p>;
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(([label, v]) => (
        <li key={label}>
          <div className="flex justify-between gap-2">
            <span className="min-w-0 truncate" title={label}>{label}</span>
            <span className="tabular-nums text-ink-700">{formatNumber(v)}</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-full bg-ink-100">
            <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function BarChart({ data }: { data: { label: string; in: number; out: number }[] }) {
  const W = 900;
  const H = 240;
  const pad = { l: 44, r: 8, t: 8, b: 26 };
  const max = niceMax(Math.max(...data.flatMap((d) => [d.in, d.out]), 1));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / data.length;
  const bw = Math.min(22, Math.max(2, (slot - 4) / 2));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const every = Math.max(1, Math.ceil(data.length / 12));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Bar chart of stock in and stock out">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e7e7ea" strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#71717a">
            {formatNumber(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = pad.l + slot * i + slot / 2;
        return (
          <g key={i}>
            <title>{`${d.label}: in ${formatNumber(d.in)}, out ${formatNumber(d.out)}`}</title>
            <rect x={cx - bw - 1} y={y(d.in)} width={bw} height={Math.max(0, pad.t + ih - y(d.in))} rx={2} fill="#16a34a" />
            <rect x={cx + 1} y={y(d.out)} width={bw} height={Math.max(0, pad.t + ih - y(d.out))} rx={2} fill="#D31B25" />
            {i % every === 0 && (
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="#71717a">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}
