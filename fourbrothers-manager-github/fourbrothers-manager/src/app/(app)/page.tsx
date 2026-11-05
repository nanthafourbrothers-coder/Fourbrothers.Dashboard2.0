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
import { LowStockAlert } from "@/components/LowStockAlert";
import { Donut, InOutChart, type Slice } from "@/components/charts";
import { UploadOverview } from "@/components/UploadOverview";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, PackageX, Truck, TrendingDown } from "lucide-react";
import { Badge, EmptyState, Field, PageHeader, Panel, Spinner, Stat, useLocalPref } from "@/components/ui";

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
    const parties = new Map<string, number>();
    const received = new Map<string, number>();
    for (const m of inRange) {
      if (m.type === "IN") {
        const label = m.product_id ? (nameOf.get(m.product_id) ?? m.raw_name) : aliasKey(m.raw_name);
        received.set(label, (received.get(label) ?? 0) + (Number(m.qty) || 0));
      }
      if (m.type !== "OUT") continue;
      const q = Number(m.qty) || 0;
      const pt = m.party || "Not set";
      parties.set(pt, (parties.get(pt) ?? 0) + q);
      const label = m.product_id ? (nameOf.get(m.product_id) ?? m.raw_name) : aliasKey(m.raw_name);
      items.set(label, (items.get(label) ?? 0) + q);
      const ch = m.channel || "Not set";
      channels.set(ch, (channels.get(ch) ?? 0) + q);
      const st = m.state || "Not set";
      states.set(st, (states.get(st) ?? 0) + q);
    }
    const top = (map: Map<string, number>, n: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return { items: top(items, 8), channels: top(channels, 6), states: top(states, 8), parties: top(parties, 8), received: top(received, 8) };
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
        subtitle="Your stock and sales at a glance."
        actions={
          <div className="flex max-w-full flex-wrap items-end gap-2">
            <div className="scroll-thin flex max-w-full overflow-x-auto rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
              {RANGES.map((r) => (
                <button key={r.id} onClick={() => setRange(r.id)} className={`whitespace-nowrap rounded-md px-2.5 py-1 ${range === r.id ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"}`}>
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Stock items" value={formatNumber(stock.length)} sub={`${formatNumber(onHand)} pieces on hand`} href="/stock" icon={<Boxes className="h-4 w-4" />} iconTone="blue" />
            <Stat label="Bought" value={formatNumber(totals.i)} sub="pieces in this period" tone="green" href="/movements?type=IN" icon={<ArrowDownToLine className="h-4 w-4" />} />
            <Stat label="Sold" value={formatNumber(totals.o)} sub={`${formatNumber(totals.invoices)} invoices`} href="/movements?type=OUT" icon={<ArrowUpFromLine className="h-4 w-4" />} iconTone="red" />
            <Stat label="Out of stock" value={counts.out} tone={counts.out ? "red" : undefined} href="/stock?flag=out" icon={<PackageX className="h-4 w-4" />} iconTone="red" />
            <Stat label="Running low" value={counts.low} tone={counts.low ? "amber" : undefined} href="/stock?flag=low" icon={<TrendingDown className="h-4 w-4" />} iconTone="amber" />
            <Stat label="To ship" value={openShipments} sub="pending or packed" href="/shipments" icon={<Truck className="h-4 w-4" />} iconTone="blue" />
          </div>

          <LowStockAlert />

          {(unmapped > 0 || counts.neg > 0 || counts.uncounted > 0) && (
            <div className="flex flex-wrap gap-2">
              {unmapped > 0 && <Notice href="/mapping" text={`${formatNumber(unmapped)} name${unmapped === 1 ? "" : "s"} not linked`} action="Match" />}
              {counts.uncounted > 0 && <Notice href="/stock?flag=uncounted" text={`${formatNumber(counts.uncounted)} items without a count`} action="See" />}
              {counts.neg > 0 && <Notice href="/stock?flag=negative" text={`${counts.neg} item${counts.neg === 1 ? "" : "s"} below zero`} action="See" />}
            </div>
          )}

          <UploadOverview />

          <Panel title={`Stock in and out ${chart.mode === "day" ? "per day" : chart.mode === "week" ? "per week" : "per month"}`}>
            <InOutChart data={chart.data} showStock={false} />
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel title="Top selling items">
              <Bars rows={breakdowns.items} />
            </Panel>
            <Panel title="Sales by channel">
              <Donut rows={toSlices(breakdowns.channels)} centerBottom="sold" empty="No sales in this period." />
            </Panel>
            <Panel title="Sales by state">
              <Donut rows={toSlices(breakdowns.states)} centerBottom="sold" empty="No sales in this period." />
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Top customers" action={<Link className="text-xs font-medium text-brand-700 hover:underline" href="/movements?type=OUT">Open</Link>}>
              <Bars rows={breakdowns.parties} />
            </Panel>
            <Panel title="Most bought" action={<Link className="text-xs font-medium text-brand-700 hover:underline" href="/movements?type=IN">Open</Link>}>
              <Bars rows={breakdowns.received} empty="No receipts in this period." />
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <Panel title="Latest entries" action={<Link className="text-xs font-medium text-brand-700 hover:underline" href="/movements">Open all</Link>}>
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

function Notice({ href, text, action }: { href: string; text: string; action: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 transition hover:bg-amber-100">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      {text}
      <span className="font-semibold text-brand-700">{action} →</span>
    </Link>
  );
}

function Bars({ rows, empty = "No sales in this period." }: { rows: [string, number][]; empty?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-500">{empty}</p>;
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(([label, v]) => (
        <li key={label}>
          <div className="flex justify-between gap-2">
            <span className="min-w-0 truncate" title={label}>{label}</span>
            <span className="tabular-nums text-ink-700">{formatNumber(v)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-ink-100">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function toSlices(rows: [string, number][]): Slice[] {
  return rows.map(([label, qty]) => ({ label, qty }));
}
