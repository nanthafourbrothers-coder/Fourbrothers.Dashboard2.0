// Plain-language overviews: what a product's numbers mean, what is inside a file, and how every uploaded
// file flowed into the app. Pure functions, no database access, so the same logic is shown the same way
// in the product popup, the dashboard and the import page, and can be tested.

import type { ProductAnalysis } from "./analysis";
import type { StockFlag, StockRow } from "./stock";
import type { ImportBatch, Movement, ProductAlias } from "./types";
import { formatDateDisplay, formatNumber } from "./parse/normalize";

const NOT_SET = "Not set";

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function monthLabel(key: string): string {
  return new Date(key + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function nextMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- one product, in plain words

export type Tone = "green" | "amber" | "red" | "gray";

export interface ProductMeaning {
  tone: Tone;
  headline: string;
  /** short sentences, most important first */
  lines: string[];
}

const STATUS: Record<StockFlag, { tone: Tone; headline: (onHand: number) => string }> = {
  ok: { tone: "green", headline: (n) => `In stock: ${formatNumber(n)} on hand` },
  low: { tone: "amber", headline: (n) => `Running low: only ${formatNumber(n)} left` },
  out: { tone: "red", headline: () => "Out of stock" },
  negative: { tone: "red", headline: (n) => `Below zero: ${formatNumber(n)}` },
  uncounted: { tone: "gray", headline: () => "No stock count yet" },
};

const ADVICE: Record<StockFlag, string> = {
  ok: "",
  low: "Plan a purchase soon so it does not run out.",
  out: "Nothing is left. Buy or produce more if it is still selling.",
  negative: "More was sold than was recorded as bought. Usually the opening stock or a purchase bill has not been entered yet. Set the opening stock from Excel, or enter a count in the Count and names tab.",
  uncounted: "No opening stock or counted line has been entered for this item, so the number may be incomplete. Enter a count in the Count and names tab.",
};

/** Turns a product's numbers into a few short sentences anyone can read. */
export function explainProduct(item: Pick<StockRow, "flag" | "on_hand">, a: ProductAnalysis, periodLabel: string): ProductMeaning {
  const s = STATUS[item.flag];
  const lines: string[] = [];
  const k = a.kpis;
  if (!k.in && !k.out && !k.adjust) {
    lines.push(`No stock moved in this period (${periodLabel}).`);
  } else {
    const parts = [`${formatNumber(k.in)} came in`, `${formatNumber(k.out)} went out`];
    if (k.adjust) parts.push(`${formatNumber(Math.abs(k.adjust))} ${k.adjust > 0 ? "added" : "removed"} by counts`);
    lines.push(`${periodLabel}: ${parts.join(", ")}.`);
  }
  const topState = a.byState.find((x) => x.label !== NOT_SET && !x.label.endsWith(" others"));
  if (topState && topState.qty > 0) lines.push(`Most sales went to ${topState.label} (${topState.share.toFixed(0)}% of the pieces sold).`);
  const topParty = a.parties.find((p) => p.party !== NOT_SET);
  if (topParty) lines.push(`Biggest customer: ${topParty.party} bought ${formatNumber(topParty.qty)}.`);

  // how long the stock lasts at the pace of the selected sales
  const outDates = a.lines.filter((m) => m.type === "OUT").map((m) => m.date).sort();
  if (item.on_hand > 0 && outDates.length > 1) {
    const span = daysBetween(outDates[0], outDates[outDates.length - 1]) + 1;
    const sold = a.lines.filter((m) => m.type === "OUT").reduce((t, m) => t + (Number(m.qty) || 0), 0);
    if (span >= 14 && sold > 0) {
      const perDay = sold / span;
      lines.push(`At this pace (${perDay >= 10 ? formatNumber(perDay) : perDay.toFixed(1)} a day) the stock on hand lasts about ${formatNumber(Math.round(item.on_hand / perDay))} days.`);
    }
  }
  if (ADVICE[item.flag]) lines.push(ADVICE[item.flag]);
  return { tone: s.tone, headline: s.headline(item.on_hand), lines };
}

// ---------------------------------------------------------------- where one product came from and went

export interface FlowNode {
  label: string;
  qty: number;
  sub?: string;
  /** gap: sold but never recorded as received. left: still in the godown. */
  kind?: "gap" | "left";
}

export interface ProductFlow {
  /** what filled the stock: opening, purchases (by supplier when known), count additions, and any unrecorded gap */
  sources: FlowNode[];
  /** what emptied it: sales by state, count removals, and what is left. Always adds up to the same total as `sources`. */
  sinks: FlowNode[];
  /** stock still on hand at the end of the period (0 or more) */
  left: number;
  /** pieces sold beyond what was recorded as available (stock below zero) */
  shortfall: number;
  onHand: number;
  /** total on each side of the diagram */
  total: number;
}

function topWithOthers(nodes: FlowNode[], max: number): FlowNode[] {
  const real = nodes.filter((n) => n.qty > 0);
  if (real.length <= max) return real;
  const head = real.slice(0, max - 1);
  const rest = real.slice(max - 1);
  return [...head, { label: `${rest.length} others`, qty: rest.reduce((s, n) => s + n.qty, 0) }];
}

/**
 * The nodes of the "came from / went to" diagram, for the period chosen in the popup.
 * Both sides add up to the same total: what came in (or was missing from the records) equals what went out plus what is left.
 * `salesFiltered`: the state / place filters are on, so places shown are only part of the sales.
 */
export function productFlow(a: ProductAnalysis, opts: { maxPerSide?: number; salesFiltered?: boolean } = {}): ProductFlow {
  const maxPerSide = opts.maxPerSide ?? 5;
  const k = a.kpis;
  const sources: FlowNode[] = [];
  if (k.opening > 0) sources.push({ label: "Opening stock", qty: k.opening });
  const supplierTotal = a.suppliers.reduce((s, p) => s + p.qty, 0);
  if (a.suppliers.length && supplierTotal > 0) {
    const sup = a.suppliers.map((p) => ({ label: p.party, qty: p.qty, sub: `${p.invoices} bill${p.invoices === 1 ? "" : "s"}` }));
    const room = Math.max(1, maxPerSide - sources.length);
    sources.push(...topWithOthers(sup, room));
    if (k.in - supplierTotal > 0.0001) sources.push({ label: "Purchases (supplier not recorded)", qty: k.in - supplierTotal });
  } else if (k.in > 0) sources.push({ label: "Purchases", qty: k.in });
  if (k.adjust > 0) sources.push({ label: "Added by stock count", qty: k.adjust });

  const sinks: FlowNode[] = [];
  const stateNodes = a.byState.map((x) => ({ label: x.label, qty: x.qty, sub: `${x.invoices} invoice${x.invoices === 1 ? "" : "s"}` }));
  const stateTotal = stateNodes.reduce((s, n) => s + n.qty, 0);
  sinks.push(...topWithOthers(stateNodes, maxPerSide));
  if (k.out - stateTotal > 0.0001) sinks.push({ label: opts.salesFiltered ? "Sold in other places" : "Sold (place not recorded)", qty: k.out - stateTotal });
  if (k.adjust < 0) sinks.push({ label: "Removed by stock count", qty: -k.adjust });

  const available = k.opening + k.in + Math.max(0, k.adjust);
  const used = k.out + Math.max(0, -k.adjust);
  const shortfall = Math.max(0, used - available);
  const left = Math.max(0, k.onHand);
  if (shortfall > 0) sources.push({ label: "Not recorded yet", qty: shortfall, sub: "opening or purchase missing", kind: "gap" });
  if (left > 0) sinks.push({ label: "Left in stock", qty: left, kind: "left" });
  return { sources, sinks, left, shortfall, onHand: k.onHand, total: sources.reduce((s, n) => s + n.qty, 0) };
}

// ---------------------------------------------------------------- what is inside one file

export interface MovementLike {
  date?: string | null;
  raw_name?: string | null;
  qty?: number | string | null;
  state?: string | null;
  party?: string | null;
  type?: string | null;
}

export interface Ranked {
  label: string;
  qty: number;
}

export interface FileOverview {
  lines: number;
  units: number;
  items: number;
  first: string | null;
  last: string | null;
  topItems: Ranked[];
  topStates: Ranked[];
  topParties: Ranked[];
  months: { key: string; label: string; qty: number }[];
}

function rank(map: Map<string, number>, n: number): Ranked[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, qty]) => ({ label, qty }));
}

/** Summary of the stock lines in a file (before saving) or of a saved batch. */
export function overviewOfLines(rows: MovementLike[]): FileOverview {
  const items = new Map<string, number>();
  const states = new Map<string, number>();
  const parties = new Map<string, number>();
  const byMonth = new Map<string, number>();
  let units = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    const q = Number(r.qty) || 0;
    units += q;
    const name = (r.raw_name ?? "").trim() || "(no name)";
    items.set(name, (items.get(name) ?? 0) + q);
    if (r.state && r.state.trim()) states.set(r.state.trim(), (states.get(r.state.trim()) ?? 0) + q);
    if (r.party && r.party.trim()) parties.set(r.party.trim(), (parties.get(r.party.trim()) ?? 0) + q);
    if (r.date) {
      if (!first || r.date < first) first = r.date;
      if (!last || r.date > last) last = r.date;
      const m = r.date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + q);
    }
  }
  const months: FileOverview["months"] = [];
  if (byMonth.size) {
    const keys = [...byMonth.keys()].sort();
    for (let m = keys[0], guard = 0; m <= keys[keys.length - 1] && guard < 60; m = nextMonth(m), guard++) months.push({ key: m, label: monthLabel(m), qty: byMonth.get(m) ?? 0 });
  }
  return { lines: rows.length, units, items: items.size, first, last, topItems: rank(items, 8), topStates: rank(states, 6), topParties: rank(parties, 6), months };
}

/** One sentence describing the dates a file covers. */
export function coverageText(o: Pick<FileOverview, "first" | "last">): string {
  if (!o.first || !o.last) return "";
  return o.first === o.last ? `on ${formatDateDisplay(o.first)}` : `from ${formatDateDisplay(o.first)} to ${formatDateDisplay(o.last)}`;
}

// ---------------------------------------------------------------- every uploaded file, as one flow

export const KIND_LABEL: Record<string, string> = {
  tally_register: "Tally sales register",
  purchase_book: "Purchase book",
  shopify_inventory: "Shopify inventory",
  shopify_products: "Shopify products",
  shopify_orders: "Shopify orders",
  generic: "Other file",
};

export const DESTINATION_LABEL: Record<string, string> = {
  movements: "Stock in and out",
  stock_items: "Stock items",
  dataset: "A section",
  shipments: "Shipments",
};

export interface PipeFile {
  name: string;
  saved: number;
  skipped: number;
  rows: number;
  kindLabel: string;
  when: string;
}

export interface Pipe {
  key: string;
  /** what the files became, in the app's words */
  title: string;
  /** one short sentence on what the files became */
  what: string;
  tone: "green" | "red" | "blue" | "amber" | "gray";
  href: string;
  linkLabel: string;
  files: PipeFile[];
  rows: number;
  saved: number;
  skipped: number;
}

function directionOf(b: ImportBatch): "IN" | "OUT" | "BOTH" {
  if (b.kind === "purchase_book") return "IN";
  if (b.kind === "tally_register") return "OUT";
  const t = (b.summary as { byType?: Record<string, number> } | null)?.byType;
  if (t) {
    const i = Number(t.IN) || 0;
    const o = Number(t.OUT) || 0;
    if (i && !o) return "IN";
    if (o && !i) return "OUT";
  }
  return "BOTH";
}

function pipeOf(b: ImportBatch): Omit<Pipe, "files" | "rows" | "saved" | "skipped"> {
  switch (b.destination) {
    case "movements": {
      const d = directionOf(b);
      if (d === "IN") return { key: "in", title: "Stock in", what: "Purchases added to the stock", tone: "green", href: "/movements?type=IN", linkLabel: "Receipts" };
      if (d === "OUT") return { key: "out", title: "Stock out", what: "Sales taken off the stock", tone: "red", href: "/movements?type=OUT", linkLabel: "Sales register" };
      return { key: "both", title: "Stock in and out", what: "Stock lines added to the ledger", tone: "amber", href: "/movements", linkLabel: "Stock lines" };
    }
    case "stock_items":
      return { key: "items", title: "Stock items", what: "Products created or updated", tone: "blue", href: "/stock", linkLabel: "Stock items" };
    case "shipments":
      return { key: "ship", title: "Shipments", what: "One shipment per order", tone: "blue", href: "/shipments", linkLabel: "Shipments" };
    default:
      return { key: "section", title: "Sections", what: "Whole files kept as searchable tables", tone: "gray", href: "/sections", linkLabel: "Sections" };
  }
}

/** The flow row for one saved file, used right after an upload. */
export function pipeForBatch(b: ImportBatch): Pipe {
  return {
    ...pipeOf(b),
    files: [{ name: b.filename.split("/").pop() || b.filename, saved: b.inserted, skipped: b.skipped, rows: b.row_count, kindLabel: KIND_LABEL[b.kind] ?? "Other file", when: b.created_at }],
    rows: b.row_count,
    saved: b.inserted,
    skipped: b.skipped,
  };
}

const PIPE_ORDER = ["items", "in", "out", "both", "ship", "section"];

export interface MonthCoverage {
  key: string;
  label: string;
  in: number;
  out: number;
}

export interface UploadOverview {
  fileCount: number;
  rows: number;
  saved: number;
  skipped: number;
  lastUpload: string | null;
  pipes: Pipe[];
  recent: (PipeFile & { id: string; destination: string; destLabel: string })[];
  coverage: { first: string | null; last: string | null; months: MonthCoverage[] };
  health: {
    stockLines: number;
    unlinkedLines: number;
    unlinkedNames: number;
    flags: Record<StockFlag, number>;
    items: number;
  };
}

/** Everything the dashboard needs to show how the uploaded files became stock, sales and shipments. */
export function buildUploadOverview(batches: ImportBatch[], movements: Movement[], aliases: ProductAlias[], stock: Pick<StockRow, "flag">[]): UploadOverview {
  const sorted = [...batches].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pipes = new Map<string, Pipe>();
  for (const b of sorted) {
    const p = pipeOf(b);
    const cur = pipes.get(p.key) ?? { ...p, files: [], rows: 0, saved: 0, skipped: 0 };
    cur.files.push({ name: b.filename.split("/").pop() || b.filename, saved: b.inserted, skipped: b.skipped, rows: b.row_count, kindLabel: KIND_LABEL[b.kind] ?? "Other file", when: b.created_at });
    cur.rows += b.row_count;
    cur.saved += b.inserted;
    cur.skipped += b.skipped;
    pipes.set(p.key, cur);
  }

  // month by month: did the files bring any sales or purchases?
  const byMonth = new Map<string, { in: number; out: number }>();
  let first: string | null = null;
  let last: string | null = null;
  for (const m of movements) {
    if (m.type === "ADJUST" || !m.date) continue;
    const k = m.date.slice(0, 7);
    const e = byMonth.get(k) ?? { in: 0, out: 0 };
    if (m.type === "IN") e.in++;
    else e.out++;
    byMonth.set(k, e);
    if (!first || m.date < first) first = m.date;
    if (!last || m.date > last) last = m.date;
  }
  let months: MonthCoverage[] = [];
  if (byMonth.size) {
    const keys = [...byMonth.keys()].sort();
    for (let m = keys[0], guard = 0; m <= keys[keys.length - 1] && guard < 120; m = nextMonth(m), guard++) {
      const e = byMonth.get(m);
      months.push({ key: m, label: monthLabel(m), in: e?.in ?? 0, out: e?.out ?? 0 });
    }
    if (months.length > 24) months = months.slice(-24);
  }

  // data quality: are the names in the files linked to stock items?
  const ignored = new Set(aliases.filter((a) => a.product_id == null).map((a) => a.alias_key));
  const unlinked = new Set<string>();
  let unlinkedLines = 0;
  for (const m of movements) {
    if (m.product_id) continue;
    unlinkedLines++;
    unlinked.add(m.raw_name.trim().toLowerCase());
  }
  for (const k of ignored) unlinked.delete(k);

  const flags: Record<StockFlag, number> = { ok: 0, low: 0, out: 0, negative: 0, uncounted: 0 };
  for (const s of stock) flags[s.flag]++;

  return {
    fileCount: sorted.length,
    rows: sorted.reduce((s, b) => s + b.row_count, 0),
    saved: sorted.reduce((s, b) => s + b.inserted, 0),
    skipped: sorted.reduce((s, b) => s + b.skipped, 0),
    lastUpload: sorted[0]?.created_at ?? null,
    pipes: [...pipes.values()].sort((a, b) => PIPE_ORDER.indexOf(a.key) - PIPE_ORDER.indexOf(b.key)),
    recent: sorted.slice(0, 6).map((b) => ({
      id: b.id,
      name: b.filename.split("/").pop() || b.filename,
      saved: b.inserted,
      skipped: b.skipped,
      rows: b.row_count,
      kindLabel: KIND_LABEL[b.kind] ?? "Other file",
      when: b.created_at,
      destination: b.destination,
      destLabel: DESTINATION_LABEL[b.destination] ?? b.destination,
    })),
    coverage: { first, last, months },
    health: { stockLines: movements.length, unlinkedLines, unlinkedNames: unlinked.size, flags, items: stock.length },
  };
}

/** "5 min ago", "3 days ago", or a date for anything older. */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDateDisplay(iso.slice(0, 10));
}
