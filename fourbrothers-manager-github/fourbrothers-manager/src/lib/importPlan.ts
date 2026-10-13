// Turns a parsed file into the exact records that will be saved. Pure functions, no database access,
// so the same logic can be tested and shown in the preview before anything is written.

import type { ColumnDef, Movement, MovementType, Product, Shipment } from "./types";
import type { ParsedRow, ParsedTable } from "./parse/table";
import { aliasKey, cleanText, directionFromVoucher, parseAddress, stateFromGstin, channelFromVoucher, parseDateLoose, parseNumberLoose } from "./parse/normalize";
import { NameResolver } from "./stock";

// ---------------------------------------------------------------- column mapping (for generic tables)

export const MOVEMENT_FIELDS: { key: string; label: string; required?: boolean; hint?: string }[] = [
  { key: "date", label: "Date", required: true },
  { key: "item", label: "Item / product name", required: true },
  { key: "qty", label: "Quantity", required: true },
  { key: "party", label: "Party (buyer or supplier)" },
  { key: "voucher_no", label: "Invoice / voucher no" },
  { key: "voucher_type", label: "Voucher type" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "gstin", label: "GSTIN" },
  { key: "address", label: "Address" },
  { key: "notes", label: "Notes" },
];

export const STOCK_ITEM_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "name", label: "Item name", required: true },
  { key: "sku", label: "SKU / code" },
  { key: "category", label: "Category" },
  { key: "location", label: "Location" },
  { key: "qty", label: "Quantity" },
  { key: "price", label: "Selling price" },
  { key: "cost", label: "Cost" },
];

export type Mapping = Record<string, string | null>;

const GUESS: Record<string, RegExp> = {
  date: /^(date|dt|invoice date|bill date|entry date|voucher date)$/i,
  item: /^(item|item name|product|product name|particulars|description|stock item|material|name)$/i,
  qty: /^(qty|quantity|pcs|nos|units|on hand|stock|closing)$/i,
  party: /^(party|buyer|customer|supplier|vendor|party name|buyer name)$/i,
  voucher_no: /^(voucher no\.?|invoice no\.?|bill no\.?|inv no\.?|challan no\.?|order|order no\.?)$/i,
  voucher_type: /^(voucher type|vch type|type)$/i,
  city: /^(city|town|location)$/i,
  state: /^(state|province)$/i,
  gstin: /^(gstin.*|gst no\.?|gst)$/i,
  address: /^(address|buyer address|billing address)$/i,
  notes: /^(notes?|remarks?|narration)$/i,
  name: /^(name|item|item name|product|product name|title|description)$/i,
  sku: /^(sku|code|item code|product code|variant sku)$/i,
  category: /^(category|type|group|product type)$/i,
  location: /^(location|godown|warehouse)$/i,
  price: /^(price|mrp|selling price|rate|variant price)$/i,
  cost: /^(cost|cost price|purchase price|cost per item)$/i,
};

export function guessMapping(columns: ColumnDef[], fields: { key: string }[]): Mapping {
  const used = new Set<string>();
  const out: Mapping = {};
  for (const f of fields) {
    const re = GUESS[f.key];
    const hit = re ? columns.find((c) => !used.has(c.key) && (re.test(c.label.trim()) || re.test(c.key))) : undefined;
    out[f.key] = hit?.key ?? null;
    if (hit) used.add(hit.key);
  }
  return out;
}

export function applyMapping(table: ParsedTable, mapping: Mapping, fields: { key: string }[]): ParsedRow[] {
  return table.rows.map((r) => {
    const o: ParsedRow = {};
    for (const f of fields) {
      const src = mapping[f.key];
      o[f.key] = src ? (r[src] ?? null) : null;
    }
    return o;
  });
}

// ---------------------------------------------------------------- stock movements

export interface MovementDraft {
  index: number;
  date: string | null;
  item: string;
  qty: number | null;
  type: MovementType | null;
  party: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  voucher_type: string | null;
  voucher_no: string | null;
  channel: string | null;
  notes: string | null;
  errors: string[];
}

const str = (v: unknown): string | null => {
  const s = cleanText(v);
  return s ? s : null;
};

export function buildMovementDrafts(rows: ParsedRow[], direction: "IN" | "OUT" | "auto", fallback: "IN" | "OUT" | null): MovementDraft[] {
  return rows.map((r, index) => {
    const errors: string[] = [];
    const date = parseDateLoose(r.date);
    if (!date) errors.push("Date is missing or not readable");
    const item = cleanText(r.item);
    if (!item) errors.push("Item name is empty");
    const qty = parseNumberLoose(r.qty, true);
    if (qty == null) errors.push("Quantity is missing");
    else if (qty <= 0) errors.push("Quantity must be above zero");
    const voucher_type = str(r.voucher_type);
    let type: MovementType | null = null;
    if (direction === "auto") {
      type = directionFromVoucher(voucher_type) ?? fallback;
      if (!type) errors.push(`Cannot tell if voucher type "${voucher_type ?? ""}" is stock in or out`);
    } else type = direction;
    const address = str(r.address);
    const gstin = str(r.gstin);
    const parsedAddr = parseAddress(address);
    const party = str(r.party);
    return {
      index,
      date,
      item,
      qty,
      type,
      party,
      address,
      city: str(r.city) ?? parsedAddr.city,
      state: str(r.state) ?? stateFromGstin(gstin),
      pincode: str(r.pincode) ?? parsedAddr.pincode,
      gstin,
      voucher_type,
      voucher_no: str(r.voucher_no),
      channel: str(r.channel) ?? channelFromVoucher(voucher_type, party),
      notes: str(r.notes),
      errors,
    };
  });
}

function baseKey(d: MovementDraft): string {
  return [d.type, d.date, d.voucher_type ?? "", d.voucher_no ?? "", aliasKey(d.item), d.qty, d.notes ?? ""].join("|");
}

export interface ChangedVoucher {
  key: string;
  label: string;
  existingIds: string[];
  newLines: number;
  oldLines: number;
}

export interface RowStatus {
  status: "ok" | "duplicate" | "invalid" | "changed";
  message?: string;
  known?: boolean; // the item name is already linked to a stock item
}

export interface MovementPlan {
  statuses: RowStatus[]; // one per draft, same order
  inserts: Partial<Movement>[];
  replaceIds: string[]; // existing movements removed when "replace changed vouchers" is on
  changed: ChangedVoucher[];
  duplicates: number;
  invalid: number;
  mapped: number;
  unmapped: number;
  ignored: number;
  totalQty: number;
  byType: Record<string, number>;
}

function voucherGroup(m: { type: string; voucher_type: string | null; voucher_no: string | null }): string | null {
  if (!m.voucher_no) return null;
  return `${m.type}|${m.voucher_type ?? ""}|${m.voucher_no}`;
}

function signature(lines: { item: string; qty: number | null; date: string | null }[]): string {
  return lines
    .map((l) => `${aliasKey(l.item)}|${l.qty}|${l.date}`)
    .sort()
    .join(";");
}

export function planMovements(drafts: MovementDraft[], existing: Movement[], resolver: NameResolver, opts: { replaceChanged: boolean; batchId?: string | null }): MovementPlan {
  const valid = drafts.filter((d) => d.errors.length === 0);
  const invalid = drafts.length - valid.length;

  // vouchers that already exist but with different lines
  const existingByGroup = new Map<string, Movement[]>();
  for (const m of existing) {
    const g = voucherGroup(m);
    if (!g) continue;
    (existingByGroup.get(g) ?? existingByGroup.set(g, []).get(g)!).push(m);
  }
  const newByGroup = new Map<string, MovementDraft[]>();
  for (const d of valid) {
    const g = voucherGroup({ type: d.type!, voucher_type: d.voucher_type, voucher_no: d.voucher_no });
    if (!g) continue;
    (newByGroup.get(g) ?? newByGroup.set(g, []).get(g)!).push(d);
  }
  const changed: ChangedVoucher[] = [];
  const changedKeys = new Set<string>();
  for (const [g, lines] of newByGroup) {
    const old = existingByGroup.get(g);
    if (!old) continue;
    const oldSig = signature(old.map((m) => ({ item: m.raw_name, qty: Number(m.qty), date: m.date })));
    const newSig = signature(lines.map((l) => ({ item: l.item, qty: l.qty, date: l.date })));
    if (oldSig !== newSig) {
      changed.push({ key: g, label: `${lines[0].voucher_type ?? ""} ${lines[0].voucher_no}`.trim(), existingIds: old.map((m) => m.id), newLines: lines.length, oldLines: old.length });
      changedKeys.add(g);
    }
  }
  const replaceIds = opts.replaceChanged ? changed.flatMap((c) => c.existingIds) : [];
  const replacedSet = new Set(replaceIds);

  const existingKeys = new Set<string>();
  for (const m of existing) if (m.dedupe_key && !replacedSet.has(m.id)) existingKeys.add(m.dedupe_key);

  const seen = new Map<string, number>();
  const inserts: Partial<Movement>[] = [];
  const statuses: RowStatus[] = new Array(drafts.length);
  let duplicates = 0;
  let mapped = 0;
  let unmapped = 0;
  let ignored = 0;
  let totalQty = 0;
  const byType: Record<string, number> = {};
  for (const d of drafts) {
    if (d.errors.length) {
      statuses[d.index] = { status: "invalid", message: d.errors.join("; ") };
      continue;
    }
    const g = voucherGroup({ type: d.type!, voucher_type: d.voucher_type, voucher_no: d.voucher_no });
    if (g && changedKeys.has(g) && !opts.replaceChanged) {
      statuses[d.index] = { status: "changed", message: "This voucher is already saved with different lines. Tick Replace to update it." };
      continue; // left alone, reported as "changed"
    }
    const bk = baseKey(d);
    const occ = seen.get(bk) ?? 0;
    seen.set(bk, occ + 1);
    const dedupe_key = `${bk}|${occ}`;
    if (existingKeys.has(dedupe_key)) {
      duplicates++;
      statuses[d.index] = { status: "duplicate", message: "Already saved" };
      continue;
    }
    const pid = resolver.resolve(d.item);
    statuses[d.index] = { status: "ok", known: pid !== undefined };
    if (pid === undefined) unmapped++;
    else if (pid === null) ignored++;
    else mapped++;
    totalQty += d.qty!;
    byType[d.type!] = (byType[d.type!] ?? 0) + d.qty!;
    inserts.push({
      date: d.date!,
      type: d.type!,
      product_id: pid ?? null,
      raw_name: d.item,
      qty: d.qty!,
      party: d.party,
      address: d.address,
      city: d.city,
      state: d.state,
      pincode: d.pincode,
      gstin: d.gstin,
      voucher_type: d.voucher_type,
      voucher_no: d.voucher_no,
      channel: d.channel,
      source: "import",
      batch_id: opts.batchId ?? null,
      dedupe_key,
      notes: d.notes,
    });
  }
  return { statuses, inserts, replaceIds, changed, duplicates, invalid, mapped, unmapped, ignored, totalQty, byType };
}

// ---------------------------------------------------------------- stock items

export type QtyMode = "opening" | "shopify" | "none";

export interface StockItemPlan {
  rows: Partial<Product>[];
  newCount: number;
  updateCount: number;
  mergedDuplicates: number;
  invalid: number;
}

export function planStockItems(table: ParsedTable, rows: ParsedRow[], existing: Product[], qtyMode: QtyMode): StockItemPlan {
  const isInventory = table.kind === "shopify_inventory";
  const isProducts = table.kind === "shopify_products";
  const byKey = new Map<string, Partial<Product>>();
  let merged = 0;
  let invalid = 0;
  for (const r of rows) {
    const name = cleanText(r.name);
    if (!name) {
      invalid++;
      continue;
    }
    const sku = str(r.sku);
    const ext_key = str(r.ext_key) ?? (sku ? sku : `manual::${aliasKey(name).toLowerCase()}`);
    const qtyRaw = r.on_hand ?? r.qty;
    const qty = typeof qtyRaw === "number" && Number.isFinite(qtyRaw) ? qtyRaw : null;
    const row: Partial<Product> = { ext_key, sku, name };
    if (isInventory) {
      row.location = str(r.location);
      row.shopify_handle = str(r.handle);
    } else if (isProducts) {
      row.category = str(r.category);
      row.price = typeof r.price === "number" ? r.price : null;
      row.cost = typeof r.cost === "number" ? r.cost : null;
      row.vendor = str(r.vendor);
      row.image_url = str(r.image);
      row.shopify_handle = str(r.handle);
    } else {
      row.category = str(r.category);
      row.location = str(r.location);
      row.price = typeof r.price === "number" ? r.price : null;
      row.cost = typeof r.cost === "number" ? r.cost : null;
    }
    if (qtyMode === "opening") row.opening_qty = qty ?? 0;
    if (qtyMode !== "none" && (isInventory || isProducts)) row.shopify_qty = qty;
    if (qtyMode === "shopify" && !(isInventory || isProducts)) row.shopify_qty = qty;
    const prev = byKey.get(ext_key);
    if (prev) {
      merged++;
      if (typeof row.opening_qty === "number") row.opening_qty = (prev.opening_qty ?? 0) + row.opening_qty;
      if (typeof row.shopify_qty === "number") row.shopify_qty = (prev.shopify_qty ?? 0) + row.shopify_qty;
      if (row.location && prev.location && row.location !== prev.location) row.location = `${prev.location} + ${row.location}`;
    }
    byKey.set(ext_key, row);
  }
  const exist = new Set(existing.map((p) => p.ext_key).filter(Boolean));
  const out = [...byKey.values()];
  const updateCount = out.filter((r) => exist.has(r.ext_key!)).length;
  return { rows: out, newCount: out.length - updateCount, updateCount, mergedDuplicates: merged, invalid };
}

// ---------------------------------------------------------------- shipments from Shopify orders

export interface ShipmentPlan {
  rows: Partial<Shipment>[];
  skippedExisting: number;
}

export function planShipmentsFromOrders(table: ParsedTable, existing: Shipment[]): ShipmentPlan {
  const col = (label: string) => table.columns.find((c) => c.label.toLowerCase() === label.toLowerCase())?.key;
  const k = {
    name: col("Name"),
    created: col("Created at"),
    fulfilledAt: col("Fulfilled at"),
    fulfillment: col("Fulfillment Status"),
    shipName: col("Shipping Name"),
    billName: col("Billing Name"),
    phone: col("Shipping Phone"),
    phone2: col("Phone"),
    billPhone: col("Billing Phone"),
    street: col("Shipping Street"),
    city: col("Shipping City"),
    zip: col("Shipping Zip"),
    province: col("Shipping Province Name"),
    method: col("Shipping Method"),
    notes: col("Notes"),
  };
  const have = new Set(existing.map((s) => s.invoice_no).filter(Boolean));
  const seen = new Set<string>();
  const rows: Partial<Shipment>[] = [];
  let skippedExisting = 0;
  for (const r of table.rows) {
    const order = k.name ? cleanText(r[k.name]) : "";
    if (!order || seen.has(order)) continue;
    seen.add(order);
    if (have.has(order)) {
      skippedExisting++;
      continue;
    }
    const get = (key?: string) => (key ? str(r[key]) : null);
    const dateSrc = get(k.fulfilledAt) ?? get(k.created) ?? "";
    const ship_date = /^\d{4}-\d{2}-\d{2}/.test(dateSrc) ? dateSrc.slice(0, 10) : null;
    if (!ship_date) continue;
    const fulfilled = (get(k.fulfillment) ?? "").toLowerCase();
    const address = [get(k.street), get(k.city), get(k.province), get(k.zip)].filter(Boolean).join(", ");
    rows.push({
      ship_date,
      customer_name: get(k.shipName) ?? get(k.billName) ?? "Customer",
      phone: get(k.phone) ?? get(k.phone2) ?? get(k.billPhone),
      city: get(k.city),
      state: get(k.province),
      address: address || null,
      invoice_no: order,
      courier: get(k.method),
      tracking_no: null,
      status: fulfilled === "fulfilled" ? "Dispatched" : "Pending",
      notes: get(k.notes),
    });
  }
  return { rows, skippedExisting };
}

// ---------------------------------------------------------------- sections (datasets)

export function rowsForDataset(table: ParsedTable): Record<string, unknown>[] {
  return table.rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of table.columns) o[c.key] = r[c.key] ?? null;
    return o;
  });
}
