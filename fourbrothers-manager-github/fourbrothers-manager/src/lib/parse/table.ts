// Generic "any spreadsheet to clean table" builder: finds the header row, names columns,
// detects types and converts every cell without losing the original information.

import type { ColumnDef, ColumnType } from "../types";
import type { Cell, RawSheet } from "./rawFile";
import { cleanMultiline, cleanText, looksLikeDateTime, makeColumnKey, parseDateLoose, parseNumberLoose, toYmdFromDateObject } from "./normalize";

export type Severity = "info" | "warn" | "error";
export interface Issue {
  level: Severity;
  message: string;
  row?: number;
}

export type DetectedKind =
  | "tally_register"
  | "purchase_book"
  | "shopify_inventory"
  | "shopify_products"
  | "shopify_orders"
  | "generic";

export type Destination = "movements" | "stock_items" | "dataset" | "shipments";

export type CellValue = string | number | boolean | null;
export type ParsedRow = Record<string, CellValue>;

export interface ParsedTable {
  source: string;
  sheet: string;
  kind: DetectedKind;
  kindLabel: string;
  columns: ColumnDef[];
  rows: ParsedRow[];
  issues: Issue[];
  notes: string[];
  stats: { label: string; value: string }[];
  suggested: Destination;
  /** for movement imports: which way stock moves. "auto" reads the voucher type of each row. */
  direction?: "IN" | "OUT" | "auto";
  headerRow?: number;
}

export const isBlank = (c: Cell | undefined): boolean => c == null || (typeof c === "string" && c.trim() === "");

export function trimGrid(rows: Cell[][]): Cell[][] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const padded = rows.map((r) => (r.length < width ? [...r, ...new Array(width - r.length).fill(null)] : r));
  // drop columns that are completely empty
  const keep: number[] = [];
  for (let c = 0; c < width; c++) if (padded.some((r) => !isBlank(r[c]))) keep.push(c);
  return padded.map((r) => keep.map((c) => r[c]));
}

const textLike = (c: Cell): boolean => typeof c === "string" && c.trim() !== "" && parseNumberLoose(c) == null && parseDateLoose(c) == null;

/** Row index of the header: the first row that is mostly text and has about as many filled cells as the widest row. */
export function findHeaderRow(rows: Cell[][], scan = 40): number {
  const limit = Math.min(rows.length, scan);
  let widest = 0;
  for (let i = 0; i < limit; i++) widest = Math.max(widest, rows[i].filter((c) => !isBlank(c)).length);
  const need = Math.max(2, Math.ceil(widest * 0.6));
  for (let i = 0; i < limit - 1; i++) {
    const filled = rows[i].filter((c) => !isBlank(c));
    if (filled.length < Math.min(need, 2)) continue;
    if (filled.length < need) continue;
    const texts = filled.filter(textLike).length;
    if (texts / filled.length >= 0.7) return i;
  }
  return 0;
}

export function findHeaderRowByKeywords(rows: Cell[][], test: (labels: string[]) => boolean, scan = 25): number {
  for (let i = 0; i < Math.min(rows.length, scan); i++) {
    const labels = rows[i].map((c) => cleanText(c).toLowerCase());
    if (test(labels)) return i;
  }
  return -1;
}

const ID_LIKE = /(^|[^a-z])(ids?|skus?|phone|mobile|zip|pin|pincode|gstin|uin|barcodes?|hs code|numbers?|no|reference|ref|codes?|awb|tracking|lr|invoice|voucher|order|receipt)([^a-z]|$)/i;

function isIdLikeHeader(label: string): boolean {
  // "Lineitem quantity" etc. are numeric; only treat identifier style headers as text
  if (/(qty|quantity|price|amount|total|tax|sales|discount|items sold|weight|grams|cost|value)/i.test(label) && !/(id|sku)\b/i.test(label)) return false;
  return ID_LIKE.test(label);
}

export interface BuildOptions {
  headerRow?: number;
}

/** Spreadsheet cell to the value that is stored. Dates become YYYY-MM-DD strings. */
function normaliseCell(c: Cell, type: ColumnType): CellValue {
  if (isBlank(c)) return null;
  switch (type) {
    case "number": {
      const n = parseNumberLoose(c, false);
      return n;
    }
    case "date":
      return parseDateLoose(c) ?? (c instanceof Date ? toYmdFromDateObject(c) : cleanText(c));
    case "datetime": {
      if (c instanceof Date) {
        const d = toYmdFromDateObject(c);
        const hh = String(c.getUTCHours()).padStart(2, "0");
        const mm = String(c.getUTCMinutes()).padStart(2, "0");
        const ss = String(c.getUTCSeconds()).padStart(2, "0");
        return `${d} ${hh}:${mm}:${ss}`;
      }
      return cleanText(c);
    }
    case "boolean":
      return typeof c === "boolean" ? c : /^(true|yes|y|1)$/i.test(cleanText(c));
    default: {
      if (typeof c === "number") return String(c);
      if (c instanceof Date) return toYmdFromDateObject(c);
      if (typeof c === "boolean") return c ? "TRUE" : "FALSE";
      let s = cleanMultiline(c);
      // Shopify protects zip codes and phones with a leading apostrophe
      if (/^'\d/.test(s)) s = s.slice(1);
      return s;
    }
  }
}

export function inferColumnType(label: string, values: Cell[]): ColumnType {
  const filled = values.filter((v) => !isBlank(v));
  if (!filled.length) return "text";
  const n = filled.length;
  const frac = (count: number) => count / n;
  if (filled.every((v) => typeof v === "boolean")) return "boolean";
  const dates = filled.filter((v) => v instanceof Date || (typeof v === "string" && parseDateLoose(v) != null && !looksLikeDateTime(v))).length;
  const dts = filled.filter((v) => looksLikeDateTime(v) || (v instanceof Date && (v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds()))).length;
  if (dts > 0 && frac(filled.filter((v) => looksLikeDateTime(v) || v instanceof Date).length) >= 0.95) return "datetime";
  if (frac(dates) >= 0.95) return "date";
  if (isIdLikeHeader(label)) return "text";
  // leading zeros mean it is a code, not a number
  if (filled.some((v) => typeof v === "string" && /^0\d+$/.test(v.trim()))) return "text";
  const nums = filled.filter((v) => typeof v === "number" || (typeof v === "string" && parseNumberLoose(v) != null)).length;
  if (frac(nums) >= 0.95) {
    // very long digit strings (ids) are not numbers
    if (filled.some((v) => typeof v === "string" && /^\d{13,}$/.test(v.trim()))) return "text";
    return "number";
  }
  return "text";
}

export function buildColumns(labels: string[], columnValues: Cell[][]): ColumnDef[] {
  const used = new Set<string>();
  const seenLabels = new Map<string, number>();
  return labels.map((raw, i) => {
    let label = cleanText(raw) || `Column ${i + 1}`;
    const count = (seenLabels.get(label.toLowerCase()) ?? 0) + 1;
    seenLabels.set(label.toLowerCase(), count);
    if (count > 1) label = `${label} (${count})`;
    const type = inferColumnType(label, columnValues[i] ?? []);
    return { key: makeColumnKey(label, used), label, type };
  });
}

/** Converts a raw grid into a clean table. Used for every file that has no special layout. */
export function buildGenericTable(raw: RawSheet, opts: BuildOptions = {}): ParsedTable {
  const grid = trimGrid(raw.rows);
  const issues: Issue[] = [];
  const notes: string[] = [...raw.notes];
  if (!grid.length) {
    return { source: raw.source, sheet: raw.name, kind: "generic", kindLabel: "Table", columns: [], rows: [], issues: [{ level: "error", message: "No data found." }], notes, stats: [], suggested: "dataset" };
  }
  const headerRow = opts.headerRow ?? findHeaderRow(grid);
  if (headerRow > 0) notes.push(`${headerRow} title row${headerRow > 1 ? "s" : ""} above the column headings ${headerRow > 1 ? "were" : "was"} skipped.`);
  const headerCells = grid[headerRow];
  const body = grid.slice(headerRow + 1).filter((r) => r.some((c) => !isBlank(c)));
  const headerText = headerCells.map((c) => cleanText(c).toLowerCase());
  // remove repeated header rows (common in PDFs and multi page reports)
  const cleanBody = body.filter((r) => !(r.length === headerCells.length && r.every((c, i) => cleanText(c).toLowerCase() === headerText[i] && headerText[i] !== "")));
  if (cleanBody.length !== body.length) notes.push(`${body.length - cleanBody.length} repeated heading row(s) were removed.`);

  const columnValues = headerCells.map((_, i) => cleanBody.map((r) => r[i]));
  const columns = buildColumns(headerCells as string[], columnValues);
  const rows: ParsedRow[] = cleanBody.map((r) => {
    const o: ParsedRow = {};
    columns.forEach((col, i) => {
      o[col.key] = normaliseCell(r[i], col.type);
    });
    return o;
  });

  // Flag text cells inside number columns (they became empty)
  columns.forEach((col, i) => {
    if (col.type !== "number") return;
    let bad = 0;
    cleanBody.forEach((r) => {
      if (!isBlank(r[i]) && parseNumberLoose(r[i]) == null) bad++;
    });
    if (bad) issues.push({ level: "warn", message: `Column "${col.label}": ${bad} cell(s) are not numbers and were left empty.` });
  });

  return {
    source: raw.source,
    sheet: raw.name,
    kind: "generic",
    kindLabel: "Table",
    columns,
    rows,
    issues,
    notes,
    stats: [
      { label: "Rows", value: String(rows.length) },
      { label: "Columns", value: String(columns.length) },
    ],
    suggested: "dataset",
    headerRow,
  };
}
