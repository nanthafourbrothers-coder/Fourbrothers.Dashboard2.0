"use client";

// Settings and backup: download everything, restore from a backup, export any table.

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db, useTable } from "@/lib/data/store";
import { useStockSince } from "@/lib/data/useStock";
import { downloadBlob, exportTable } from "@/lib/export";
import { formatNumber, todayYmd } from "@/lib/parse/normalize";
import type { TableMap, TableName } from "@/lib/types";
import { Button, EmptyState, PageHeader, useUi } from "@/components/ui";

// parents first, so references exist when children are restored
const BACKUP_TABLES = ["products", "product_aliases", "import_batches", "datasets", "stock_movements", "dataset_rows", "shipments", "shipment_files"] as const satisfies readonly TableName[];
type BackupTable = (typeof BACKUP_TABLES)[number];

const LABELS: Record<BackupTable, string> = {
  products: "Stock items",
  product_aliases: "Linked names",
  import_batches: "Import history",
  datasets: "Sections",
  stock_movements: "Stock in and out",
  dataset_rows: "Section rows",
  shipments: "Shipments",
  shipment_files: "File records",
};

export default function SettingsPage() {
  const auth = useAuth();
  const { toast, confirm } = useUi();
  const t = {
    products: useTable("products"),
    product_aliases: useTable("product_aliases"),
    import_batches: useTable("import_batches"),
    datasets: useTable("datasets"),
    stock_movements: useTable("stock_movements"),
    dataset_rows: useTable("dataset_rows"),
    shipments: useTable("shipments"),
    shipment_files: useTable("shipment_files"),
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const since = useStockSince();
  const settingsRows = useTable("settings").rows;
  const [sinceDraft, setSinceDraft] = useState("");
  useEffect(() => setSinceDraft(since ?? ""), [since]);

  const saveSince = async () => {
    try {
      if (!sinceDraft) {
        if (since) await db.remove("settings", ["stock_from"]);
        toast("success", "Every line is counted again.");
      } else {
        await db.upsert("settings", [{ key: "stock_from", value: sinceDraft }], "key");
        toast("success", "Saved. Stock on hand is now counted from that day.");
      }
      await db.audit("setting", "settings", `count stock from ${sinceDraft || "the beginning"}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save. Only an admin can change settings.");
    }
  };

  if (!auth.can("manage")) {
    return (
      <div className="card">
        <EmptyState title="Managers and admins only" />
      </div>
    );
  }

  const backup = () => {
    const data: Record<string, unknown> = { app: "fourbrothers-manager", version: 1, exported_at: new Date().toISOString() };
    for (const k of BACKUP_TABLES) data[k] = t[k].rows;
    data.settings = settingsRows;
    downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `fourbrothers-backup-${todayYmd()}.json`);
    void db.audit("backup", undefined, "Full backup downloaded");
    toast("success", "Backup downloaded. Photos and files are not inside it: they stay in storage.");
  };

  const restore = async (file: File) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return toast("error", "That is not a backup file made by this app.");
    }
    if (parsed.app !== "fourbrothers-manager") return toast("error", "That is not a backup file made by this app.");
    const counts = BACKUP_TABLES.map((k) => `${LABELS[k]}: ${Array.isArray(parsed[k]) ? (parsed[k] as unknown[]).length : 0}`).join("\n");
    if (!(await confirm(`Restore this backup?\n\n${counts}\n\nRecords with the same id are updated, missing ones are added, nothing is deleted.`, { confirmLabel: "Restore" }))) return;
    setBusy("restore");
    try {
      for (const k of BACKUP_TABLES) {
        const rows = Array.isArray(parsed[k]) ? (parsed[k] as Record<string, unknown>[]) : [];
        if (!rows.length) continue;
        setProgress(`Restoring ${LABELS[k]} (${formatNumber(rows.length)})`);
        const clean = rows.map((r) => ({ ...r, created_by: null }));
        await db.upsert(k, clean as Partial<TableMap[typeof k]>[], "id");
      }
      const st = Array.isArray(parsed.settings) ? (parsed.settings as { key: string; value: unknown }[]) : [];
      if (st.length) await db.upsert("settings", st, "key");
      await db.audit("restore", undefined, file.name);
      toast("success", "Backup restored.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not restore.");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const exportOne = async (k: BackupTable, format: "csv" | "xlsx") => {
    const rows = t[k].rows as unknown as Record<string, unknown>[];
    if (!rows.length) return toast("info", "Nothing to export yet.");
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== "data" && c !== "columns" && c !== "summary");
    await exportTable(format, { filename: `${k}-${todayYmd()}`, title: LABELS[k], columns: keys.map((key) => ({ key, label: key, type: "text" as const })), rows });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings and backup" subtitle="Keep your own copy of the data. Free database plans do not include automatic backups, so download one regularly." />

      <section className="card p-5">
        <h2 className="font-semibold">Count stock from</h2>
        <p className="mt-1 text-sm text-ink-600">
          Opening stock is a count taken on one day, for example a Shopify inventory file or a physical count. Choose that day here. Stock in and out lines dated before it stay saved and searchable, but are not counted, so nothing is counted twice.
          Leave it empty to count every line from the beginning.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input className="input w-44" type="date" value={sinceDraft} onChange={(e) => setSinceDraft(e.target.value)} disabled={!auth.can("admin")} aria-label="Count stock from" />
          {auth.can("admin") ? <Button variant="primary" onClick={saveSince}>Save</Button> : <span className="text-sm text-ink-500">Only an admin can change this.</span>}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Full backup</h2>
        <p className="mt-1 text-sm text-ink-600">One file with stock items, linked names, stock lines, sections, shipments and import history.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={backup}>
            <Download className="h-4 w-4" /> Download backup
          </Button>
          {auth.can("admin") && (
            <>
              <Button busy={busy === "restore"} onClick={() => input.current?.click()}>
                <Upload className="h-4 w-4" /> Restore from backup
              </Button>
              <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void restore(f); }} />
            </>
          )}
          <span className="text-sm text-ink-500">{progress}</span>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Export one table</h2>
        <div className="mt-3 divide-y divide-ink-100">
          {BACKUP_TABLES.map((k) => (
            <div key={k} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1">{LABELS[k]}</span>
              <span className="tabular-nums text-ink-500">{formatNumber(t[k].rows.length)} rows</span>
              <Button size="sm" onClick={() => exportOne(k, "csv")}>CSV</Button>
              <Button size="sm" onClick={() => exportOne(k, "xlsx")}>Excel</Button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-500">Section rows are best exported from the section itself, where each column has its own name.</p>
      </section>

      <section className="card p-5 text-sm text-ink-700">
        <h2 className="font-semibold text-ink-900">About this setup</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Data: {auth.mode === "supabase" ? "shared database on Supabase. Everyone you add sees the same live data." : "demo mode. Data lives only in this browser until Supabase is connected."}</li>
          <li>Signed in as {auth.profile?.email} ({auth.role}).</li>
          <li>Table views remember your chosen columns and page size on this device only.</li>
        </ul>
      </section>
    </div>
  );
}
