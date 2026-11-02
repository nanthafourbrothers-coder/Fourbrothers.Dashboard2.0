// Product analysis: the numbers behind the product popup. Pure functions, no database access.
//
// Stock for a period is a roll-forward:
//   Opening  = the item's opening stock + everything counted before the period starts
//   In       = purchases (stock in) inside the period
//   Out      = sales and dispatches (stock out) inside the period
//   Adjusted = stock counts / corrections inside the period
//   On hand  = Opening + In - Out + Adjusted
// With "All time" selected, Opening is just the item's opening stock, so the figures agree with the Excel files.

import type { Movement, Product } from "./types";
import { addDaysYmd, todayYmd } from "./parse/normalize";

// ---------------------------------------------------------------- periods

export type PeriodId = "all" | "today" | "7" | "30" | "month" | "lastmonth" | "fy" | "custom";

export interface PeriodState {
  id: PeriodId;
  from: string; // used when id = custom
  to: string;
}

export interface Period {
  id: PeriodId;
  from: string | null;
  to: string | null;
  label: string;
}

export const PERIOD_CHOICES: { id: PeriodId; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "fy", label: "This financial year" },
  { id: "custom", label: "Custom dates" },
];

const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const monthEnd = (ymd: string) => {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

function fmt(ymd: string): string {
  return new Date(ymd + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function resolvePeriod(s: PeriodState, today = todayYmd()): Period {
  switch (s.id) {
    case "today":
      return { id: s.id, from: today, to: today, label: `Today, ${fmt(today)}` };
    case "7":
      return { id: s.id, from: addDaysYmd(today, -6), to: today, label: `${fmt(addDaysYmd(today, -6))} to ${fmt(today)}` };
    case "30":
      return { id: s.id, from: addDaysYmd(today, -29), to: today, label: `${fmt(addDaysYmd(today, -29))} to ${fmt(today)}` };
    case "month":
      return { id: s.id, from: monthStart(today), to: today, label: `${fmt(monthStart(today))} to ${fmt(today)}` };
    case "lastmonth": {
      const prevEnd = addDaysYmd(monthStart(today), -1);
      return { id: s.id, from: monthStart(prevEnd), to: prevEnd, label: `${fmt(monthStart(prevEnd))} to ${fmt(prevEnd)}` };
    }
    case "fy": {
      const y = Number(today.slice(0, 4));
      const startYear = Number(today.slice(5, 7)) >= 4 ? y : y - 1;
      const from = `${startYear}-04-01`;
      return { id: s.id, from, to: today, label: `FY ${startYear}-${String(startYear + 1).slice(2)} (${fmt(from)} to ${fmt(today)})` };
    }
    case "custom": {
      const from = s.from || null;
      const to = s.to || null;
      let label = "Custom dates";
      if (from && to) label = `${fmt(from)} to ${fmt(to)}`;
      else if (from) label = `From ${fmt(from)}`;
      else if (to) label = `Up to ${fmt(to)}`;
      return { id: s.id, from, to, label };
    }
    default:
      return { id: "all", from: null, to: null, label: "All time" };
  }
}

// ---------------------------------------------------------------- filters

export interface Filters {
  states: string[];
  cities: string[];
  channels: string[];
  parties: string[];
  godowns: string[];
}

export const NO_FILTERS: Filters = { states: [], cities: [], channels: [], parties: [], godowns: [] };

export const hasSalesFilter = (f: Filters) => f.states.length + f.cities.length + f.channels.length + f.parties.length > 0;
export const hasAnyFilter = (f: Filters) => hasSalesFilter(f) || f.godowns.length > 0;

const NOT_SET = "Not set";
const lab = (v: string | null | undefined) => (v && v.trim() ? v.trim() : NOT_SET);

/** Does a stock-out line fall inside the chosen sales locations / channels / parties? */
export function matchesSales(m: Movement, f: Filters): boolean {
  if (f.states.length && !f.states.includes(lab(m.state))) return false;
  if (f.cities.length && !f.cities.includes(lab(m.city))) return false;
  if (f.channels.length && !f.channels.includes(lab(m.channel))) return false;
  if (f.parties.length && !f.parties.includes(lab(m.party))) return false;
  return true;
}

const matchesGodown = (m: Movement, f: Filters) => !f.godowns.length || f.godowns.includes(lab(m.location));

export interface FilterOptions {
  states: string[];
  cities: string[];
  channels: string[];
  parties: string[];
  godowns: string[];
}

export function filterOptions(lines: Movement[]): FilterOptions {
  const uniq = (get: (m: Movement) => string | null | undefined, only?: (m: Movement) => boolean) => {
    const counts = new Map<string, number>();
    for (const m of lines) {
      if (only && !only(m)) continue;
      const k = lab(get(m));
      counts.set(k, (counts.get(k) ?? 0) + (Number(m.qty) || 0));
    }
    return [...counts.entries()].sort((a, b) => (a[0] === NOT_SET ? 1 : b[0] === NOT_SET ? -1 : b[1] - a[1])).map(([k]) => k);
  };
  const out = (m: Movement) => m.type === "OUT";
  return {
    states: uniq((m) => m.state, out),
    cities: uniq((m) => m.city, out),
    channels: uniq((m) => m.channel, out),
    parties: uniq((m) => m.party, out),
    godowns: lines.some((m) => m.location && m.location.trim()) ? uniq((m) => m.location) : [],
  };
}

// ---------------------------------------------------------------- the analysis

export interface Kpis {
  opening: number;
  in: number;
  out: number;
  adjust: number;
  onHand: number;
}

export interface SeriesPoint {
  key: string; // bucket start date or month
  label: string;
  in: number;
  out: number;
  onHand: number; // running stock at the end of the bucket (warehouse view)
}

export interface Slice {
  label: string;
  qty: number;
  share: number; // 0-100 of the selected out total
  invoices: number;
}

export interface PartyRow {
  party: string;
  city: string;
  state: string;
  qty: number;
  invoices: number;
  lines: number;
  first: string;
  last: string;
  channel: string;
  history: { date: string; voucher_no: string; voucher_type: string; qty: number; id: string }[];
}

export interface ProductAnalysis {
  kpis: Kpis;
  /** out quantity inside the period before the sales filters (for "x% of all sales") */
  periodOut: number;
  /** lines inside the period and the chosen filters, newest first */
  lines: Movement[];
  series: SeriesPoint[];
  grain: "day" | "week" | "month";
  byState: Slice[];
  byCity: Slice[];
  byChannel: Slice[];
  parties: PartyRow[];
  suppliers: PartyRow[];
  firstDate: string | null;
  lastDate: string | null;
}

export interface AnalyseOptions {
  period: Period;
  filters: Filters;
  /** lines dated before this are kept but not counted (the "count stock from" setting) */
  since?: string | null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function weekStart(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  return addDaysYmd(ymd, -((d.getUTCDay() + 6) % 7));
}

function bucketLabel(key: string, grain: "day" | "week" | "month"): string {
  if (grain === "month") return new Date(key + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
  return new Date(key + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

const signed = (m: Movement) => {
  const q = Number(m.qty) || 0;
  return m.type === "IN" ? q : m.type === "OUT" ? -q : q;
};

function slices(map: Map<string, { qty: number; vouchers: Set<string> }>, total: number, top = 12): Slice[] {
  const rows = [...map.entries()].sort((a, b) => b[1].qty - a[1].qty);
  const head = rows.slice(0, top).map(([label, v]) => ({ label, qty: v.qty, share: total ? (v.qty / total) * 100 : 0, invoices: v.vouchers.size }));
  const rest = rows.slice(top);
  if (rest.length) {
    const qty = rest.reduce((s, [, v]) => s + v.qty, 0);
    const vouchers = new Set<string>();
    rest.forEach(([, v]) => v.vouchers.forEach((x) => vouchers.add(x)));
    head.push({ label: `${rest.length} others`, qty, share: total ? (qty / total) * 100 : 0, invoices: vouchers.size });
  }
  return head;
}

const voucherKey = (m: Movement) => `${m.voucher_type ?? ""}|${m.voucher_no ?? m.id}`;

/** All the numbers for one product. `lines` must be that product's stock lines only. */
export function analyseProduct(product: Pick<Product, "opening_qty">, lines: Movement[], opts: AnalyseOptions): ProductAnalysis {
  const { period, filters, since } = opts;
  const counted = lines.filter((m) => (!since || m.date >= since) && matchesGodown(m, filters));
  const from = period.from;
  const to = period.to;

  // warehouse roll-forward (not affected by sales filters)
  let before = 0;
  let inQ = 0;
  let outQ = 0;
  let adj = 0;
  for (const m of counted) {
    const q = Number(m.qty) || 0;
    if (from && m.date < from) {
      before += signed(m);
      continue;
    }
    if (to && m.date > to) continue;
    if (m.type === "IN") inQ += q;
    else if (m.type === "OUT") outQ += q;
    else adj += q;
  }
  // opening stock is a whole-item figure, so it only applies when no godown is picked
  const base = filters.godowns.length ? 0 : Number(product.opening_qty) || 0;
  const opening = base + before;
  const kpis: Kpis = { opening, in: inQ, out: outQ, adjust: adj, onHand: opening + inQ - outQ + adj };

  // lines for charts/tables: inside the period, and, when sales filters are on, only matching stock-out lines
  const salesOn = hasSalesFilter(filters);
  const inPeriod = counted.filter((m) => (!from || m.date >= from) && (!to || m.date <= to));
  const selected = inPeriod.filter((m) => (salesOn ? m.type === "OUT" && matchesSales(m, filters) : true));
  const sorted = [...selected].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

  // time series
  const dates = inPeriod.map((m) => m.date).sort();
  const start = from ?? dates[0] ?? null;
  const end = to ?? dates[dates.length - 1] ?? null;
  const span = start && end ? Math.max(0, daysBetween(start, end)) : 0;
  const grain: "day" | "week" | "month" = span <= 60 ? "day" : span <= 240 ? "week" : "month";
  const keyOf = (d: string) => (grain === "day" ? d : grain === "month" ? d.slice(0, 7) : weekStart(d));
  const buckets = new Map<string, { in: number; out: number; net: number }>();
  for (const m of selected) {
    const k = keyOf(m.date);
    const b = buckets.get(k) ?? { in: 0, out: 0, net: 0 };
    const q = Number(m.qty) || 0;
    if (m.type === "IN") b.in += q;
    else if (m.type === "OUT") b.out += q;
    buckets.set(k, b);
  }
  // running stock uses the warehouse view even when sales filters are on, so the line always means "stock on hand"
  const wh = new Map<string, number>();
  for (const m of inPeriod) wh.set(keyOf(m.date), (wh.get(keyOf(m.date)) ?? 0) + signed(m));
  const keys = [...new Set([...buckets.keys(), ...wh.keys()])].sort();
  let run = opening;
  const series: SeriesPoint[] = keys.map((k) => {
    run += wh.get(k) ?? 0;
    const b = buckets.get(k) ?? { in: 0, out: 0, net: 0 };
    return { key: k, label: bucketLabel(k, grain), in: b.in, out: b.out, onHand: run };
  });

  // sales breakdowns (stock-out lines only)
  const outs = selected.filter((m) => m.type === "OUT");
  const outTotal = outs.reduce((s, m) => s + (Number(m.qty) || 0), 0);
  const group = (get: (m: Movement) => string) => {
    const map = new Map<string, { qty: number; vouchers: Set<string> }>();
    for (const m of outs) {
      const k = get(m);
      const e = map.get(k) ?? { qty: 0, vouchers: new Set<string>() };
      e.qty += Number(m.qty) || 0;
      e.vouchers.add(voucherKey(m));
      map.set(k, e);
    }
    return slices(map, outTotal);
  };

  const partyRows = (list: Movement[]): PartyRow[] => {
    const map = new Map<string, PartyRow & { v: Set<string> }>();
    for (const m of list) {
      const name = lab(m.party);
      const e =
        map.get(name) ??
        ({ party: name, city: m.city ?? "", state: m.state ?? "", qty: 0, invoices: 0, lines: 0, first: m.date, last: m.date, channel: m.channel ?? "", history: [], v: new Set<string>() } as PartyRow & { v: Set<string> });
      e.qty += Number(m.qty) || 0;
      e.lines++;
      e.v.add(voucherKey(m));
      if (m.date < e.first) e.first = m.date;
      if (m.date > e.last) e.last = m.date;
      if (!e.city && m.city) e.city = m.city;
      if (!e.state && m.state) e.state = m.state;
      e.history.push({ date: m.date, voucher_no: m.voucher_no ?? "", voucher_type: m.voucher_type ?? "", qty: Number(m.qty) || 0, id: m.id });
      map.set(name, e);
    }
    return [...map.values()]
      .map(({ v, ...r }) => ({ ...r, invoices: v.size, history: r.history.sort((a, b) => b.date.localeCompare(a.date)) }))
      .sort((a, b) => b.qty - a.qty);
  };

  const allDates = lines.map((m) => m.date).sort();
  return {
    kpis,
    periodOut: outQ,
    lines: sorted,
    series,
    grain,
    byState: group((m) => lab(m.state)),
    byCity: group((m) => lab(m.city)),
    byChannel: group((m) => lab(m.channel)),
    parties: partyRows(outs),
    suppliers: partyRows(selected.filter((m) => m.type === "IN" && m.party)),
    firstDate: allDates[0] ?? null,
    lastDate: allDates[allDates.length - 1] ?? null,
  };
}

// ---------------------------------------------------------------- other products in the same location

export interface OtherProduct {
  productId: string | null;
  name: string;
  qty: number;
  invoices: number;
  share: number;
}

/** What else was sold in the chosen locations / channels / parties, for every product except `excludeId`. */
export function otherProductsAt(allLines: Movement[], excludeId: string, filters: Filters, period: Period, nameOf: (m: Movement) => string, since?: string | null): OtherProduct[] {
  const map = new Map<string, { productId: string | null; name: string; qty: number; v: Set<string> }>();
  let total = 0;
  for (const m of allLines) {
    if (m.type !== "OUT" || m.product_id === excludeId) continue;
    if (since && m.date < since) continue;
    if (period.from && m.date < period.from) continue;
    if (period.to && m.date > period.to) continue;
    if (!matchesSales(m, filters)) continue;
    const name = nameOf(m);
    const k = m.product_id ?? `raw:${name}`;
    const e = map.get(k) ?? { productId: m.product_id, name, qty: 0, v: new Set<string>() };
    const q = Number(m.qty) || 0;
    e.qty += q;
    total += q;
    e.v.add(voucherKey(m));
    map.set(k, e);
  }
  return [...map.values()]
    .map((e) => ({ productId: e.productId, name: e.name, qty: e.qty, invoices: e.v.size, share: total ? (e.qty / total) * 100 : 0 }))
    .sort((a, b) => b.qty - a.qty);
}
