// Turns any supported file into plain grids of cells ("raw sheets").
// xlsx / csv / tsv / txt / json / pdf / zip are supported. The same code runs in the browser and in Node tests.

import { unzipSync } from "fflate";
import Papa from "papaparse";
import { extractPdfRows } from "./pdf";

export type Cell = string | number | boolean | Date | null;

export interface RawSheet {
  /** file name shown to the user, e.g. "OUTSTOCK_REPORT.xlsx" */
  source: string;
  /** sheet or page group name, e.g. "INVOICE Register" */
  name: string;
  format: "xlsx" | "csv" | "json" | "pdf";
  rows: Cell[][];
  /** extra info for the user: ignored sheets, decoding fallbacks, etc. */
  notes: string[];
}

export interface ReadResult {
  sheets: RawSheet[];
  errors: string[];
}

const MAX_ZIP_ENTRIES = 200;
const MAX_ZIP_BYTES = 150 * 1024 * 1024;

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export const SUPPORTED_EXTENSIONS = ["xlsx", "xlsm", "csv", "tsv", "txt", "json", "pdf", "zip"];

export async function readAnyFile(name: string, data: ArrayBuffer | Uint8Array, depth = 0): Promise<ReadResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const ext = extOf(name);
  const result: ReadResult = { sheets: [], errors: [] };
  try {
    if (ext === "xlsx" || ext === "xlsm") {
      result.sheets.push(...(await readXlsx(name, bytes)));
    } else if (ext === "csv" || ext === "tsv" || ext === "txt") {
      result.sheets.push(readDelimited(name, bytes, ext === "tsv" ? "\t" : undefined));
    } else if (ext === "json") {
      result.sheets.push(readJson(name, bytes));
    } else if (ext === "pdf") {
      const rows = await extractPdfRows(bytes);
      if (!rows.length) {
        result.errors.push(`${name}: no selectable text found. This looks like a scanned PDF or an image. Use the Shipments section to store it as a photo or document.`);
      } else {
        result.sheets.push({ source: name, name: "PDF text", format: "pdf", rows, notes: ["Text was read from the PDF and arranged into columns. Please check the preview carefully before importing."] });
      }
    } else if (ext === "zip") {
      if (depth > 2) {
        result.errors.push(`${name}: zip files nested too deeply.`);
      } else {
        let total = 0;
        let count = 0;
        const entries = unzipSync(bytes, {
          filter: (f) => {
            if (f.name.endsWith("/") || f.name.includes("__MACOSX") || f.name.split("/").pop()!.startsWith(".")) return false;
            count++;
            total += f.originalSize;
            return count <= MAX_ZIP_ENTRIES && total <= MAX_ZIP_BYTES && SUPPORTED_EXTENSIONS.includes(extOf(f.name));
          },
        });
        const names = Object.keys(entries);
        if (!names.length) result.errors.push(`${name}: the zip has no supported files (xlsx, csv, json, pdf).`);
        for (const inner of names) {
          const sub = await readAnyFile(`${name.replace(/\.zip$/i, "")}/${inner}`, entries[inner], depth + 1);
          result.sheets.push(...sub.sheets);
          result.errors.push(...sub.errors);
        }
      }
    } else if (ext === "xls" || ext === "ods" || ext === "xlsb") {
      result.errors.push(`${name}: old Excel format (.${ext}) is not supported. Open it in Excel and use Save As .xlsx or .csv, then upload again.`);
    } else if (["png", "jpg", "jpeg", "webp", "heic", "gif"].includes(ext)) {
      result.errors.push(`${name}: images cannot be read as tables. Upload invoice photos in the Shipments section instead.`);
    } else {
      result.errors.push(`${name}: file type .${ext || "unknown"} is not supported. Use xlsx, csv, json, pdf or zip.`);
    }
  } catch (e) {
    result.errors.push(`${name}: could not be read (${e instanceof Error ? e.message : String(e)}).`);
  }
  return result;
}

function decodeText(bytes: Uint8Array, notes: string[]): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    notes.push("The file is not UTF-8, so it was read as Windows-1252 text.");
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function trimEmptyRows(rows: Cell[][]): Cell[][] {
  const isEmpty = (r: Cell[]) => r.every((c) => c == null || (typeof c === "string" && c.trim() === ""));
  let start = 0;
  let end = rows.length;
  while (start < end && isEmpty(rows[start])) start++;
  while (end > start && isEmpty(rows[end - 1])) end--;
  return rows.slice(start, end);
}

function readDelimited(name: string, bytes: Uint8Array, delimiter?: string): RawSheet {
  const notes: string[] = [];
  const text = decodeText(bytes, notes);
  const parsed = Papa.parse<string[]>(text, { delimiter: delimiter ?? "", skipEmptyLines: false });
  if (parsed.errors.length) {
    const first = parsed.errors[0];
    notes.push(`CSV reader warning on row ${(first.row ?? 0) + 1}: ${first.message}`);
  }
  const rows = (parsed.data as string[][]).map((r) => r.map((c) => (c === "" ? null : c)));
  return { source: name, name: name.split("/").pop() ?? name, format: "csv", rows: trimEmptyRows(rows), notes };
}

function readJson(name: string, bytes: Uint8Array): RawSheet {
  const notes: string[] = [];
  const parsed: unknown = JSON.parse(decodeText(bytes, notes));
  let arr: unknown = parsed;
  if (!Array.isArray(arr) && parsed && typeof parsed === "object") {
    const firstArray = Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v));
    if (firstArray) arr = firstArray;
  }
  if (!Array.isArray(arr)) throw new Error("JSON must be a list of records");
  const keys: string[] = [];
  for (const rec of arr) {
    if (rec && typeof rec === "object") for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  }
  const rows: Cell[][] = [keys];
  for (const rec of arr as Record<string, unknown>[]) {
    rows.push(
      keys.map((k) => {
        const v = rec?.[k];
        if (v == null) return null;
        if (typeof v === "object") return JSON.stringify(v);
        return v as Cell;
      }),
    );
  }
  return { source: name, name: name.split("/").pop() ?? name, format: "json", rows, notes };
}

// ---------- xlsx ----------

type ExcelCellValue = unknown;

function excelValue(v: ExcelCellValue): Cell {
  if (v == null) return null;
  if (typeof v === "string") return v === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("") || null;
    if ("result" in o && o.result !== undefined) return excelValue(o.result);
    if ("formula" in o) return null; // formula without cached result
    if (typeof o.text === "string") return o.text || null; // hyperlink
    if (typeof o.error === "string") return null;
  }
  return String(v);
}

async function readXlsx(name: string, bytes: Uint8Array): Promise<RawSheet[]> {
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  // ExcelJS expects a Buffer in Node and accepts typed arrays in the browser.
  const input = typeof Buffer !== "undefined" ? Buffer.from(bytes) : bytes;
  await wb.xlsx.load(input as never);
  const sheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    const notes: string[] = [];
    if (ws.state && ws.state !== "visible") notes.push("This sheet is hidden in Excel.");
    const rows: Cell[][] = [];
    const colCount = ws.columnCount;
    const rowCount = ws.rowCount;
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const out: Cell[] = new Array(colCount).fill(null);
      let any = false;
      for (let c = 1; c <= colCount; c++) {
        const val = excelValue(row.getCell(c).value);
        out[c - 1] = val;
        if (val != null) any = true;
      }
      rows.push(any ? out : new Array(colCount).fill(null));
    }
    const trimmed = trimEmptyRows(rows);
    if (trimmed.length) sheets.push({ source: name, name: ws.name, format: "xlsx", rows: trimmed, notes });
  });
  return sheets;
}
