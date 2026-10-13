// Shopify export layouts: inventory, products and orders.

import type { ColumnDef } from "../types";
import { cleanMultiline, cleanText, formatNumber, parseNumberLoose } from "./normalize";
import type { Cell, RawSheet } from "./rawFile";
import { buildGenericTable, findHeaderRowByKeywords, isBlank, trimGrid, type Issue, type ParsedRow, type ParsedTable } from "./table";

function indexByLabel(headerRow: Cell[]): Map<string, number> {
  const m = new Map<string, number>();
  headerRow.forEach((c, i) => {
    const l = cleanText(c).toLowerCase();
    if (l && !m.has(l)) m.set(l, i);
  });
  return m;
}

const has = (labels: string[], ...need: string[]) => need.every((n) => labels.includes(n));

function variantName(r: Cell[], ix: Map<string, number>): string {
  const parts: string[] = [];
  for (const n of [1, 2, 3]) {
    const i = ix.get(`option${n} value`);
    const v = i != null ? cleanText(r[i]) : "";
    if (v && v.toLowerCase() !== "default title") parts.push(v);
  }
  return parts.join(" / ");
}

const get = (r: Cell[], ix: Map<string, number>, label: string): Cell => {
  const i = ix.get(label);
  return i == null ? null : r[i];
};
const str = (r: Cell[], ix: Map<string, number>, label: string): string => cleanText(get(r, ix, label));
const num = (r: Cell[], ix: Map<string, number>, label: string): number | null => parseNumberLoose(get(r, ix, label));

export function extKey(sku: string, handle: string, variant: string): string {
  return sku ? sku : `${handle}::${variant}`.toLowerCase();
}

// ---------- inventory export ----------

export function parseShopifyInventory(raw: RawSheet): ParsedTable | null {
  const grid = trimGrid(raw.rows);
  const h = findHeaderRowByKeywords(grid, (l) => has(l, "handle", "sku") && l.some((x) => x.startsWith("on hand")));
  if (h < 0) return null;
  const ix = indexByLabel(grid[h]);
  const onHandLabel = [...ix.keys()].find((k) => k.startsWith("on hand"))!;
  const availLabel = [...ix.keys()].find((k) => k.startsWith("available"));
  const commitLabel = [...ix.keys()].find((k) => k.startsWith("committed"));
  const unavLabel = [...ix.keys()].find((k) => k.startsWith("unavailable"));
  const incLabel = [...ix.keys()].find((k) => k.startsWith("incoming"));
  const issues: Issue[] = [];
  const rows: ParsedRow[] = [];
  let noSku = 0;
  let negative = 0;
  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i];
    if (r.every(isBlank)) continue;
    const title = str(r, ix, "title");
    const handle = str(r, ix, "handle");
    if (!title && !handle) continue;
    const variant = variantName(r, ix);
    const sku = str(r, ix, "sku");
    const onHand = num(r, ix, onHandLabel);
    if (!sku) noSku++;
    if (onHand != null && onHand < 0) negative++;
    rows.push({
      name: variant ? `${title} - ${variant}` : title,
      sku: sku || null,
      variant: variant || null,
      handle: handle || null,
      location: str(r, ix, "location") || null,
      on_hand: onHand,
      available: availLabel ? num(r, ix, availLabel) : null,
      committed: commitLabel ? num(r, ix, commitLabel) : null,
      unavailable: unavLabel ? num(r, ix, unavLabel) : null,
      incoming: incLabel ? num(r, ix, incLabel) : null,
      ext_key: extKey(sku, handle, variant),
    });
  }
  if (noSku) issues.push({ level: "info", message: `${noSku} variant(s) have no SKU. They are identified by product handle and option instead.` });
  if (negative) issues.push({ level: "warn", message: `${negative} variant(s) have negative stock in Shopify.` });
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) {
    const k = `${r.ext_key}|${r.location}`;
    if (seen.has(k)) dup.add(String(r.ext_key));
    seen.add(k);
  }
  if (dup.size) issues.push({ level: "warn", message: `${dup.size} SKU(s) appear more than once for the same location: ${[...dup].slice(0, 4).join(", ")}.` });
  const total = rows.reduce((s, r) => s + (typeof r.on_hand === "number" ? r.on_hand : 0), 0);
  const columns: ColumnDef[] = [
    { key: "name", label: "Product", type: "text" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "variant", label: "Variant", type: "text" },
    { key: "handle", label: "Handle", type: "text" },
    { key: "location", label: "Location", type: "text" },
    { key: "on_hand", label: "On hand", type: "number" },
    { key: "available", label: "Available", type: "number" },
    { key: "committed", label: "Committed", type: "number" },
    { key: "unavailable", label: "Unavailable", type: "number" },
    { key: "incoming", label: "Incoming", type: "number" },
    { key: "ext_key", label: "Key", type: "text", hidden: true },
  ];
  return {
    source: raw.source,
    sheet: raw.name,
    kind: "shopify_inventory",
    kindLabel: "Shopify inventory export",
    columns,
    rows,
    issues,
    notes: [...raw.notes],
    stats: [
      { label: "Variants", value: String(rows.length) },
      { label: "Units on hand", value: formatNumber(total) },
    ],
    suggested: "stock_items",
    headerRow: h,
  };
}

// ---------- products export ----------

export function parseShopifyProducts(raw: RawSheet): ParsedTable | null {
  const grid = trimGrid(raw.rows);
  const h = findHeaderRowByKeywords(grid, (l) => has(l, "handle", "title", "variant sku"));
  if (h < 0) return null;
  const ix = indexByLabel(grid[h]);
  const issues: Issue[] = [];
  const rows: ParsedRow[] = [];
  const productByHandle = new Map<string, { title: string; vendor: string; category: string; type: string; tags: string; status: string }>();
  const imageByHandle = new Map<string, string>();
  const body = grid.slice(h + 1).filter((r) => !r.every(isBlank));
  let noSku = 0;
  let imageOnly = 0;
  for (const r of body) {
    const handle = str(r, ix, "handle");
    if (!handle) continue;
    if (str(r, ix, "title")) {
      productByHandle.set(handle, {
        title: str(r, ix, "title"),
        vendor: str(r, ix, "vendor"),
        category: str(r, ix, "product category"),
        type: str(r, ix, "type"),
        tags: str(r, ix, "tags"),
        status: str(r, ix, "status"),
      });
    }
    const img = str(r, ix, "image src");
    if (img && !imageByHandle.has(handle)) imageByHandle.set(handle, img);
  }
  for (const r of body) {
    const handle = str(r, ix, "handle");
    const isVariant = !!str(r, ix, "variant sku") || !!str(r, ix, "option1 value") || !!str(r, ix, "variant price");
    if (!isVariant) {
      imageOnly++;
      continue;
    }
    const p = productByHandle.get(handle);
    if (!p) {
      issues.push({ level: "warn", message: `A variant for handle "${handle}" has no product title and was skipped.` });
      continue;
    }
    const variant = variantName(r, ix);
    const sku = str(r, ix, "variant sku");
    if (!sku) noSku++;
    rows.push({
      name: variant ? `${p.title} - ${variant}` : p.title,
      title: p.title,
      variant: variant || null,
      sku: sku || null,
      handle,
      price: num(r, ix, "variant price"),
      compare_at_price: num(r, ix, "variant compare at price"),
      cost: num(r, ix, "cost per item"),
      qty: num(r, ix, "variant inventory qty"),
      vendor: p.vendor || null,
      category: p.category ? p.category.split(">").pop()!.trim() : null,
      type: p.type || null,
      tags: p.tags || null,
      status: p.status || null,
      barcode: str(r, ix, "variant barcode") || str(r, ix, "variant barcodes") || null,
      grams: num(r, ix, "variant grams"),
      image: imageByHandle.get(handle) ?? null,
      ext_key: extKey(sku, handle, variant),
    });
  }
  if (noSku) issues.push({ level: "info", message: `${noSku} variant(s) have no SKU. They are identified by product handle and option instead.` });
  const products = new Set(rows.map((r) => r.handle));
  const columns: ColumnDef[] = [
    { key: "name", label: "Product", type: "text" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "price", label: "Price", type: "number" },
    { key: "cost", label: "Cost", type: "number" },
    { key: "qty", label: "Qty in Shopify", type: "number" },
    { key: "status", label: "Status", type: "text" },
    { key: "category", label: "Category", type: "text" },
    { key: "vendor", label: "Vendor", type: "text" },
    { key: "variant", label: "Variant", type: "text" },
    { key: "handle", label: "Handle", type: "text" },
    { key: "title", label: "Title", type: "text", hidden: true },
    { key: "compare_at_price", label: "Compare at", type: "number", hidden: true },
    { key: "type", label: "Type", type: "text", hidden: true },
    { key: "tags", label: "Tags", type: "text", hidden: true },
    { key: "barcode", label: "Barcode", type: "text", hidden: true },
    { key: "grams", label: "Grams", type: "number", hidden: true },
    { key: "image", label: "Image", type: "text", hidden: true },
    { key: "ext_key", label: "Key", type: "text", hidden: true },
  ];
  return {
    source: raw.source,
    sheet: raw.name,
    kind: "shopify_products",
    kindLabel: "Shopify products export",
    columns,
    rows,
    issues,
    notes: [...raw.notes, `${imageOnly} extra image row(s) were folded into their products.`],
    stats: [
      { label: "Products", value: String(products.size) },
      { label: "Variants", value: String(rows.length) },
    ],
    suggested: "stock_items",
    headerRow: h,
  };
}

// ---------- orders export ----------

const ORDER_MONEY = /^(subtotal|shipping|taxes|total|discount amount|refunded amount|outstanding balance|duties|lineitem .*|tax \d value|id)$/i;
const ORDER_VISIBLE = new Set([
  "name", "created_at", "financial_status", "fulfillment_status", "lineitem_quantity", "lineitem_name", "lineitem_sku",
  "lineitem_price", "subtotal", "shipping", "taxes", "total", "discount_code", "shipping_name", "shipping_city",
  "shipping_province_name", "shipping_phone", "payment_method", "source",
]);

export function parseShopifyOrders(raw: RawSheet): ParsedTable | null {
  const grid = trimGrid(raw.rows);
  const h = findHeaderRowByKeywords(grid, (l) => has(l, "name", "financial status", "lineitem name"));
  if (h < 0) return null;
  const header = grid[h];
  const labels = header.map((c) => cleanText(c));
  const nameIdx = labels.findIndex((l) => l.toLowerCase() === "name");
  const carry = labels.map((l) => !ORDER_MONEY.test(l.toLowerCase()) && !l.toLowerCase().startsWith("lineitem"));
  const filled: Cell[][] = [header];
  let first: Cell[] | null = null;
  let currentOrder = "";
  let carried = 0;
  for (const r0 of grid.slice(h + 1)) {
    if (r0.every(isBlank)) continue;
    const r = [...r0];
    const order = cleanText(r[nameIdx]);
    if (order && order !== currentOrder) {
      currentOrder = order;
      first = r0;
    } else if (first) {
      r.forEach((c, i) => {
        if (carry[i] && isBlank(c) && !isBlank(first![i])) {
          r[i] = first![i];
          carried++;
        }
      });
    }
    filled.push(r);
  }
  const table = buildGenericTable({ ...raw, rows: filled }, { headerRow: 0 });
  const orderKey = table.columns.find((c) => c.label.toLowerCase() === "name")?.key ?? "name";
  const totalKey = table.columns.find((c) => c.label.toLowerCase() === "total")?.key;
  const qtyKey = table.columns.find((c) => c.label.toLowerCase() === "lineitem quantity")?.key;
  const orders = new Set(table.rows.map((r) => String(r[orderKey])));
  let revenue = 0;
  const seenOrder = new Set<string>();
  for (const r of table.rows) {
    const o = String(r[orderKey]);
    if (seenOrder.has(o)) continue;
    seenOrder.add(o);
    if (totalKey && typeof r[totalKey] === "number") revenue += r[totalKey] as number;
  }
  const units = qtyKey ? table.rows.reduce((s, r) => s + (typeof r[qtyKey] === "number" ? (r[qtyKey] as number) : 0), 0) : 0;
  table.columns = table.columns.map((c) => ({ ...c, hidden: !ORDER_VISIBLE.has(c.key) }));
  return {
    ...table,
    kind: "shopify_orders",
    kindLabel: "Shopify orders export",
    notes: [...table.notes, `Order details (customer, address, status) were copied onto each item line of the same order (${carried} cells). Money totals are kept on the first line only so sums stay correct.`],
    stats: [
      { label: "Orders", value: String(orders.size) },
      { label: "Item lines", value: String(table.rows.length) },
      { label: "Units", value: formatNumber(units) },
      { label: "Order value", value: formatNumber(revenue, 2) },
    ],
    suggested: "dataset",
  };
}

export { cleanMultiline };
