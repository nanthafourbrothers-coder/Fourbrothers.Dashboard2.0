// Tally style register: one row per voucher (invoice) followed by one row per item.
//
//   Date       Particulars        Quantity  Buyer   Buyer Address  Voucher Type  Voucher No.  GSTIN/UIN
//   01-Oct-26  STAR AGENCIES                STAR..  ...            INVOICE       1650         32CC...
//              4B MINT FRESH - 1  36
//              4B MINT FRESH - 2  36
//
// Every item row becomes one flat line that carries its voucher details.

import { cleanText, channelFromVoucher, parseAddress, parseDateLoose, parseNumberLoose, stateFromGstin, formatNumber } from "./normalize";
import type { RawSheet, Cell } from "./rawFile";
import { findHeaderRowByKeywords, isBlank, trimGrid, type Issue, type ParsedRow, type ParsedTable } from "./table";
import { pickColumns } from "./movementColumns";

interface TallyCols {
  date: number;
  particulars: number;
  qty: number;
  buyer: number;
  address: number;
  vtype: number;
  vno: number;
  gstin: number;
}

function mapColumns(labels: string[]): TallyCols | null {
  const find = (test: (l: string) => boolean) => labels.findIndex(test);
  const cols: TallyCols = {
    date: find((l) => l === "date"),
    particulars: find((l) => l === "particulars" || l === "particular"),
    qty: find((l) => l.includes("quantity") || l === "qty"),
    buyer: find((l) => /^(buyer|party|party name|buyer name)$/.test(l)),
    address: find((l) => l.includes("address")),
    vtype: find((l) => l === "voucher type" || l === "vch type"),
    vno: find((l) => l.startsWith("voucher no") || l.startsWith("vch no") || l === "voucher number"),
    gstin: find((l) => l.includes("gstin") || l.includes("uin")),
  };
  if (cols.date < 0 || cols.particulars < 0 || cols.qty < 0 || (cols.vtype < 0 && cols.vno < 0)) return null;
  return cols;
}

export function detectTally(grid: Cell[][]): { headerRow: number; cols: TallyCols } | null {
  const headerRow = findHeaderRowByKeywords(grid, (labels) => mapColumns(labels) != null);
  if (headerRow < 0) return null;
  const cols = mapColumns(grid[headerRow].map((c) => cleanText(c).toLowerCase()))!;
  // Must look like the header/children layout: some rows have a date and no quantity, others a quantity and no date.
  let headers = 0;
  let children = 0;
  for (const r of grid.slice(headerRow + 1, headerRow + 200)) {
    const hasDate = !isBlank(r[cols.date]);
    const hasQty = parseNumberLoose(r[cols.qty], true) != null;
    if (hasDate && !hasQty) headers++;
    if (!hasDate && hasQty && !isBlank(r[cols.particulars])) children++;
  }
  if (headers < 1 || children < 1) return null;
  return { headerRow, cols };
}

export function parseTallyRegister(raw: RawSheet): ParsedTable | null {
  const grid = trimGrid(raw.rows);
  const det = detectTally(grid);
  if (!det) return null;
  const { headerRow, cols } = det;
  const issues: Issue[] = [];
  const notes: string[] = [...raw.notes];
  const rows: ParsedRow[] = [];

  interface Voucher {
    date: string | null;
    party: string;
    address: string;
    vtype: string;
    vno: string;
    gstin: string;
    items: number;
    line: number;
  }
  let current: Voucher | null = null;
  const vouchers: Voucher[] = [];
  let controlTotal: number | null = null;
  let collapsed = 0;

  for (let i = headerRow + 1; i < grid.length; i++) {
    const r = grid[i];
    const line = i + 1; // spreadsheet row number as the user sees it
    if (r.every(isBlank)) continue;
    const dateCell = r[cols.date];
    const part = cleanText(r[cols.particulars]);
    const vtype = cols.vtype >= 0 ? cleanText(r[cols.vtype]) : "";
    const vno = cols.vno >= 0 ? cleanText(r[cols.vno]) : "";
    const isHeader = !isBlank(dateCell) || (!!part && (!!vno || !!vtype));

    if (isHeader) {
      const date = parseDateLoose(dateCell);
      if (!isBlank(dateCell) && !date) issues.push({ level: "error", message: `Row ${line}: date "${cleanText(dateCell)}" could not be read.` });
      const party = cleanText(cols.buyer >= 0 ? r[cols.buyer] : "") || part;
      current = {
        date,
        party,
        address: cols.address >= 0 ? cleanText(r[cols.address]) : "",
        vtype,
        vno,
        gstin: cols.gstin >= 0 ? cleanText(r[cols.gstin]).toUpperCase() : "",
        items: 0,
        line,
      };
      vouchers.push(current);
      continue;
    }

    if (!part) continue;
    if (/^(grand\s+)?total$/i.test(part)) {
      controlTotal = parseNumberLoose(r[cols.qty], true);
      continue;
    }
    if (!current) {
      issues.push({ level: "warn", message: `Row ${line}: item "${part}" appears before any invoice row and was skipped.` });
      continue;
    }
    const rawQty = r[cols.qty];
    const qty = parseNumberLoose(rawQty, true);
    if (qty == null) {
      issues.push({ level: "warn", message: `Row ${line}: item "${part}" has no readable quantity.` });
    } else if (qty === 0) {
      issues.push({ level: "warn", message: `Row ${line}: item "${part}" has quantity 0.` });
    } else if (qty < 0) {
      issues.push({ level: "warn", message: `Row ${line}: item "${part}" has a negative quantity (${qty}).` });
    }
    if (/\s{2,}/.test(String(r[cols.particulars] ?? ""))) collapsed++;
    const { city, pincode } = parseAddress(current.address);
    rows.push({
      date: current.date,
      item: part,
      qty,
      party: current.party,
      voucher_type: current.vtype || null,
      voucher_no: current.vno || null,
      channel: channelFromVoucher(current.vtype, current.party),
      city,
      state: stateFromGstin(current.gstin),
      pincode,
      gstin: current.gstin || null,
      address: current.address || null,
      notes: null,
    });
    current.items++;
  }

  const empty = vouchers.filter((v) => v.items === 0);
  if (empty.length) issues.push({ level: "info", message: `${empty.length} voucher(s) have no item lines and add no stock movement (${empty.slice(0, 5).map((v) => v.vno || `row ${v.line}`).join(", ")}${empty.length > 5 ? ", ..." : ""}).` });

  const seen = new Map<string, number>();
  for (const v of vouchers) {
    const k = `${v.vtype}|${v.vno}`;
    if (!v.vno) continue;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length) issues.push({ level: "warn", message: `Voucher number(s) used more than once: ${dups.slice(0, 5).map(([k]) => k.split("|")[1]).join(", ")}. Check that nothing was repeated.` });
  if (collapsed) notes.push(`${collapsed} item name(s) had extra spaces that were tidied.`);

  const totalQty = rows.reduce((s, r) => s + (typeof r.qty === "number" ? r.qty : 0), 0);
  if (controlTotal != null) {
    if (Math.abs(controlTotal - totalQty) < 0.0001) notes.push(`The report's own total (${formatNumber(controlTotal)}) matches the imported quantity.`);
    else issues.push({ level: "error", message: `The report's own total is ${formatNumber(controlTotal)} but the item lines add up to ${formatNumber(totalQty)}.` });
  }
  const dates = rows.map((r) => r.date).filter((d): d is string => typeof d === "string").sort();
  const stats = [
    { label: "Vouchers", value: String(vouchers.length) },
    { label: "Item lines", value: String(rows.length) },
    { label: "Total qty", value: formatNumber(totalQty) },
    { label: "Dates", value: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "none" },
  ];

  return {
    source: raw.source,
    sheet: raw.name,
    kind: "tally_register",
    kindLabel: "Tally invoice register (stock out)",
    columns: pickColumns(["date", "item", "qty", "party", "voucher_type", "voucher_no", "channel", "city", "state", "pincode", "gstin", "address"]),
    rows,
    issues,
    notes,
    stats,
    suggested: "movements",
    direction: "auto",
    headerRow,
  };
}
