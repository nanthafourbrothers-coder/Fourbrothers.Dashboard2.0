// Download helpers: CSV, Excel, JSON and PDF for any table on screen.

import type { ColumnDef } from "./types";
import { formatDateDisplay } from "./parse/normalize";

export type ExportFormat = "csv" | "xlsx" | "json" | "pdf";

export interface ExportSpec {
  filename: string; // without extension
  title?: string;
  columns: Pick<ColumnDef, "key" | "label" | "type">[];
  rows: Record<string, unknown>[];
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Stops spreadsheet programs from running text that starts with = + @ as a formula. */
function safeText(v: string): string {
  return /^[=+@]/.test(v) || /^-[^\d.]/.test(v) ? `'${v}` : v;
}

function plain(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(spec: ExportSpec): string {
  const head = spec.columns.map((c) => csvCell(c.label)).join(",");
  const lines = spec.rows.map((r) =>
    spec.columns
      .map((c) => {
        const v = r[c.key];
        const s = plain(v);
        return csvCell(c.type === "number" || typeof v === "number" ? s : safeText(s));
      })
      .join(","),
  );
  return "﻿" + [head, ...lines].join("\r\n");
}

export async function exportTable(format: ExportFormat, spec: ExportSpec): Promise<void> {
  const base = spec.filename.replace(/[^\w\-. ]+/g, "_");
  if (format === "csv") {
    downloadBlob(new Blob([toCsv(spec)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
  } else if (format === "json") {
    const out = spec.rows.map((r) => Object.fromEntries(spec.columns.map((c) => [c.label, r[c.key] ?? null])));
    downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), `${base}.json`);
  } else if (format === "xlsx") {
    const mod = await import("exceljs");
    const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const wb = new ExcelJS.Workbook();
    wb.creator = "FOURBROTHERS MANAGER";
    const ws = wb.addWorksheet((spec.title ?? "Data").slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    ws.columns = spec.columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(48, Math.max(12, c.label.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F1F2" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of spec.rows) {
      const row: Record<string, unknown> = {};
      for (const c of spec.columns) {
        const v = r[c.key];
        if (v == null || v === "") row[c.key] = null;
        else if (c.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
          const [y, m, d] = v.slice(0, 10).split("-").map(Number);
          row[c.key] = new Date(Date.UTC(y, m - 1, d));
        } else if (c.type === "number" && typeof v === "number") row[c.key] = v;
        else row[c.key] = typeof v === "string" ? safeText(v) : v;
      }
      ws.addRow(row);
    }
    spec.columns.forEach((c, i) => {
      if (c.type === "date") ws.getColumn(i + 1).numFmt = "dd-mmm-yyyy";
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
    const buf = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${base}.xlsx`);
  } else {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: spec.columns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
    doc.setFontSize(13);
    doc.text(spec.title ?? spec.filename, 40, 36);
    doc.setFontSize(8);
    doc.text(`FOURBROTHERS MANAGER  |  ${spec.rows.length} rows  |  ${new Date().toLocaleString("en-IN")}`, 40, 50);
    autoTable(doc, {
      startY: 60,
      head: [spec.columns.map((c) => c.label)],
      body: spec.rows.map((r) =>
        spec.columns.map((c) => {
          const v = r[c.key];
          if (c.type === "date" && typeof v === "string") return formatDateDisplay(v);
          return plain(v);
        }),
      ),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [211, 27, 37] },
      margin: { left: 30, right: 30 },
    });
    doc.save(`${base}.pdf`);
  }
}
