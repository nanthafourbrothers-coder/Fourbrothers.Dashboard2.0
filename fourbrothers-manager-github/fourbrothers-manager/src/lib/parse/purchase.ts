// Purchase entry book: a title line, then S.NO | DATE | PRODUCT NAME | QUANTITY.
// The date and S.NO are written once per entry and left blank on the lines below, so they are carried down.

import { cleanText, formatNumber, parseDateLoose, parseNumberLoose, stripNameNoise } from "./normalize";
import type { RawSheet, Cell } from "./rawFile";
import { findHeaderRowByKeywords, isBlank, trimGrid, type Issue, type ParsedRow, type ParsedTable } from "./table";
import { pickColumns } from "./movementColumns";

interface PurchaseCols {
  sno: number;
  date: number;
  product: number;
  qty: number;
  supplier: number;
  billNo: number;
  notes: number;
}

function mapColumns(labels: string[]): PurchaseCols | null {
  const find = (test: (l: string) => boolean) => labels.findIndex(test);
  const cols: PurchaseCols = {
    sno: find((l) => /^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|serial|#)$/.test(l)),
    date: find((l) => /^(date|purchase date|bill date|entry date|inward date)$/.test(l)),
    product: find((l) => /^(product|product name|item|item name|stock item|description|material|particulars)$/.test(l)),
    qty: find((l) => /^(qty|quantity|pcs|nos|units|received qty)$/.test(l)),
    supplier: find((l) => /^(supplier|vendor|party|from|company)$/.test(l)),
    billNo: find((l) => /^(bill no\.?|invoice no\.?|challan no\.?|lr no\.?|ref no\.?|voucher no\.?)$/.test(l)),
    notes: find((l) => /^(remarks?|notes?|narration)$/.test(l)),
  };
  if (cols.date < 0 || cols.product < 0 || cols.qty < 0) return null;
  return cols;
}

export function parsePurchaseBook(raw: RawSheet): ParsedTable | null {
  const grid = trimGrid(raw.rows);
  const headerRow = findHeaderRowByKeywords(grid, (labels) => mapColumns(labels) != null);
  if (headerRow < 0) return null;
  const cols = mapColumns(grid[headerRow].map((c) => cleanText(c).toLowerCase()))!;
  const issues: Issue[] = [];
  const notes: string[] = [...raw.notes];
  const title = [...new Set(grid.slice(0, headerRow).flat().map(cleanText).filter(Boolean))].join(" ");
  if (title) notes.push(`Title line: "${title}"`);

  const rows: ParsedRow[] = [];
  let curDate: string | null = null;
  let curSno = "";
  let inheritedDate = 0;
  let noisy = 0;
  let missingQty = 0;

  for (let i = headerRow + 1; i < grid.length; i++) {
    const r = grid[i];
    const line = i + 1;
    if (r.every(isBlank)) continue;
    const product = cleanText(r[cols.product]);
    const dateCell: Cell = r[cols.date];
    let hasOwnDate = false;
    if (!isBlank(dateCell)) {
      const d = parseDateLoose(dateCell);
      if (d) {
        curDate = d;
        hasOwnDate = true;
      } else {
        issues.push({ level: "error", message: `Row ${line}: date "${cleanText(dateCell)}" could not be read.` });
      }
    }
    if (cols.sno >= 0 && !isBlank(r[cols.sno])) curSno = cleanText(r[cols.sno]);
    if (!product && isBlank(r[cols.qty])) continue;
    if (/^(grand\s+)?total$/i.test(product)) continue;
    if (!product) {
      issues.push({ level: "warn", message: `Row ${line}: a quantity is present but the product name is empty.` });
      continue;
    }
    const qty = parseNumberLoose(r[cols.qty], true);
    if (qty == null) {
      missingQty++;
      issues.push({ level: "warn", message: `Row ${line}: "${product}" has no quantity. Fill it in the preview or remove the row.` });
    } else if (qty <= 0) {
      issues.push({ level: "warn", message: `Row ${line}: "${product}" has quantity ${qty}.` });
    }
    if (!curDate) issues.push({ level: "error", message: `Row ${line}: no date found for "${product}" (no date on this row or above it).` });
    else if (!hasOwnDate) inheritedDate++;
    if (stripNameNoise(product) !== product) noisy++;

    rows.push({
      date: curDate,
      item: product,
      qty,
      party: cols.supplier >= 0 ? cleanText(r[cols.supplier]) || null : null,
      voucher_no: cols.billNo >= 0 ? cleanText(r[cols.billNo]) || null : null,
      notes: [cols.notes >= 0 ? cleanText(r[cols.notes]) : "", curSno ? `Purchase book S.NO ${curSno}` : ""].filter(Boolean).join(" | ") || null,
    });
  }

  if (inheritedDate) notes.push(`${inheritedDate} line(s) had no date of their own and use the date from the entry above, as written in the book.`);
  if (noisy) notes.push(`${noisy} product name(s) include a weight, rate or LR number in brackets or at the end. The original text is kept and matching ignores that part.`);
  if (missingQty) notes.push(`${missingQty} line(s) have no quantity.`);

  const totalQty = rows.reduce((s, r) => s + (typeof r.qty === "number" ? r.qty : 0), 0);
  const dates = rows.map((r) => r.date).filter((d): d is string => typeof d === "string").sort();
  return {
    source: raw.source,
    sheet: raw.name,
    kind: "purchase_book",
    kindLabel: "Purchase entry book (stock in)",
    columns: pickColumns(["date", "item", "qty", "party", "voucher_no", "notes"]),
    rows,
    issues,
    notes,
    stats: [
      { label: "Entries", value: String(new Set(rows.map((r) => String(r.notes ?? "").match(/S\.NO (\S+)/)?.[1] ?? "")).size) },
      { label: "Lines", value: String(rows.length) },
      { label: "Total qty", value: formatNumber(totalQty) },
      { label: "Dates", value: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "none" },
    ],
    suggested: "movements",
    direction: "IN",
    headerRow,
  };
}
