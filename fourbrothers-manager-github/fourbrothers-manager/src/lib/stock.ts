import type { Movement, Product, ProductAlias } from "./types";
import { aliasKey } from "./parse/normalize";

export type StockFlag = "ok" | "low" | "out" | "negative" | "uncounted";

export interface StockRow extends Product {
  in_qty: number;
  out_qty: number;
  adjust_qty: number;
  on_hand: number;
  flag: StockFlag;
  last_movement: string | null;
  last_out: string | null;
  variance: number | null; // app stock minus Shopify qty
}

/** `since`: lines dated before this day are kept but not counted, because opening stock is the count on that day. */
export function computeStock(products: Product[], movements: Movement[], opts: { since?: string | null } = {}): StockRow[] {
  const since = opts.since || null;
  const sums = new Map<string, { in: number; out: number; adj: number; counted: number; last: string | null; lastOut: string | null }>();
  for (const m of movements) {
    if (!m.product_id) continue;
    let s = sums.get(m.product_id);
    if (!s) {
      s = { in: 0, out: 0, adj: 0, counted: 0, last: null, lastOut: null };
      sums.set(m.product_id, s);
    }
    const q = Number(m.qty) || 0;
    if (!since || m.date >= since) {
      if (m.type === "IN") s.in += q;
      else if (m.type === "OUT") s.out += q;
      else s.adj += q;
      s.counted++;
    }
    if (!s.last || m.date > s.last) s.last = m.date;
    if (m.type === "OUT" && (!s.lastOut || m.date > s.lastOut)) s.lastOut = m.date;
  }
  return products.map((p) => {
    const s = sums.get(p.id);
    const opening = Number(p.opening_qty) || 0;
    const onHand = opening + (s?.in ?? 0) - (s?.out ?? 0) + (s?.adj ?? 0);
    const reorder = Number(p.reorder_level) || 0;
    let flag: StockFlag = "ok";
    // no opening stock and no counted line: the app has not been told anything about this item yet
    if (!s?.counted && opening === 0) flag = "uncounted";
    else if (onHand < 0) flag = "negative";
    else if (onHand === 0) flag = "out";
    else if (reorder > 0 && onHand <= reorder) flag = "low";
    return {
      ...p,
      in_qty: s?.in ?? 0,
      out_qty: s?.out ?? 0,
      adjust_qty: s?.adj ?? 0,
      on_hand: onHand,
      flag,
      last_movement: s?.last ?? null,
      last_out: s?.lastOut ?? null,
      variance: p.shopify_qty == null ? null : onHand - Number(p.shopify_qty),
    };
  });
}

/** Resolves names from files to products using aliases, then product names and SKUs. */
export class NameResolver {
  private map = new Map<string, string | null>();

  constructor(products: Product[], aliases: ProductAlias[]) {
    for (const p of products) {
      this.map.set(aliasKey(p.name), p.id);
      if (p.sku) this.map.set(aliasKey(p.sku), p.id);
    }
    // explicit aliases win over implicit ones
    for (const a of aliases) this.map.set(a.alias_key, a.product_id);
  }

  /** string = product id, null = deliberately ignored, undefined = unknown name */
  resolve(name: string): string | null | undefined {
    return this.map.get(aliasKey(name));
  }
}

export interface UnmappedName {
  key: string;
  names: string[];
  lines: number;
  qtyIn: number;
  qtyOut: number;
  first: string;
  last: string;
}

export function unmappedNames(movements: Movement[], aliases: ProductAlias[]): UnmappedName[] {
  const ignored = new Set(aliases.filter((a) => a.product_id == null).map((a) => a.alias_key));
  const groups = new Map<string, UnmappedName>();
  for (const m of movements) {
    if (m.product_id) continue;
    const key = aliasKey(m.raw_name);
    if (ignored.has(key)) continue;
    let g = groups.get(key);
    if (!g) {
      g = { key, names: [], lines: 0, qtyIn: 0, qtyOut: 0, first: m.date, last: m.date };
      groups.set(key, g);
    }
    if (!g.names.includes(m.raw_name)) g.names.push(m.raw_name);
    g.lines++;
    if (m.type === "IN") g.qtyIn += Number(m.qty) || 0;
    else if (m.type === "OUT") g.qtyOut += Number(m.qty) || 0;
    if (m.date < g.first) g.first = m.date;
    if (m.date > g.last) g.last = m.date;
  }
  return [...groups.values()].sort((a, b) => b.qtyOut + b.qtyIn - (a.qtyOut + a.qtyIn));
}
