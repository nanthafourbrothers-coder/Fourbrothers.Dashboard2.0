"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, ArrowLeftRight, Boxes, CheckCircle2, Database, FileSpreadsheet, Info, Truck, Undo2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTable } from "@/lib/data/store";
import { suggestSectionName } from "@/lib/parse/detect";
import { formatNumber, parseDateLoose, parseNumberLoose, slugify } from "@/lib/parse/normalize";
import type { Destination, ParsedRow, ParsedTable } from "@/lib/parse/table";
import {
  MOVEMENT_FIELDS, STOCK_ITEM_FIELDS, applyMapping, buildMovementDrafts, guessMapping, planMovements, planShipmentsFromOrders, planStockItems,
  type Mapping, type QtyMode,
} from "@/lib/importPlan";
import { commitDataset, commitMovements, commitShipments, commitStockItems, undoBatch } from "@/lib/importCommit";
import { NameResolver } from "@/lib/stock";
import type { ImportBatch } from "@/lib/types";
import { Badge, Button, Field, useUi } from "./ui";
import { PreviewTable, type PreviewColumn } from "./PreviewTable";

const DEST_INFO: Record<Destination, { label: string; help: string; icon: React.ReactNode }> = {
  movements: { label: "Stock in and out", help: "Adds lines to the stock ledger", icon: <ArrowLeftRight className="h-4 w-4" /> },
  stock_items: { label: "Stock items", help: "Creates or updates the product list", icon: <Boxes className="h-4 w-4" /> },
  dataset: { label: "A section", help: "Keeps the whole file as its own searchable, editable table", icon: <Database className="h-4 w-4" /> },
  shipments: { label: "Shipments", help: "One shipment record per order, ready for photos", icon: <Truck className="h-4 w-4" /> },
};

function allowedDestinations(t: ParsedTable): Destination[] {
  switch (t.kind) {
    case "tally_register":
    case "purchase_book":
      return ["movements", "dataset"];
    case "shopify_inventory":
    case "shopify_products":
      return ["stock_items", "dataset"];
    case "shopify_orders":
      return ["dataset", "shipments"];
    default:
      return ["dataset", "movements", "stock_items"];
  }
}

const isMovementReady = (t: ParsedTable) => t.kind === "tally_register" || t.kind === "purchase_book";
const isStockReady = (t: ParsedTable) => t.kind === "shopify_inventory" || t.kind === "shopify_products";

export function ImportCard({ initial, onRemove }: { initial: ParsedTable; onRemove: () => void }) {
  const auth = useAuth();
  const { toast, confirm } = useUi();
  const products = useTable("products").rows;
  const aliases = useTable("product_aliases").rows;
  const movements = useTable("stock_movements").rows;
  const datasets = useTable("datasets").rows;
  const datasetRows = useTable("dataset_rows").rows;
  const shipments = useTable("shipments").rows;

  const [table, setTable] = useState<ParsedTable>(initial);
  const [dest, setDest] = useState<Destination>(initial.suggested);
  const [direction, setDirection] = useState<"IN" | "OUT" | "auto">(initial.direction ?? "OUT");
  const [fallback, setFallback] = useState<"IN" | "OUT">("OUT");
  const [moveMap, setMoveMap] = useState<Mapping>(() => guessMapping(initial.columns, MOVEMENT_FIELDS));
  const [stockMap, setStockMap] = useState<Mapping>(() => guessMapping(initial.columns, STOCK_ITEM_FIELDS));
  const [qtyMode, setQtyMode] = useState<QtyMode>("shopify");
  const [replaceChanged, setReplaceChanged] = useState(false);
  const [dsMode, setDsMode] = useState<"new" | "append" | "replace">("new");
  const [dsName, setDsName] = useState(() => suggestSectionName(initial));
  const [dsTarget, setDsTarget] = useState("");
  const [dedupeOn, setDedupeOn] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ batch: ImportBatch; text: string; link?: { href: string; label: string }; unmapped?: number } | null>(null);
  const [showIssues, setShowIssues] = useState(false);

  const allowed = allowedDestinations(table);
  const canManage = auth.can("manage");
  const canWrite = auth.can("write");

  const resolver = useMemo(() => new NameResolver(products, aliases), [products, aliases]);

  // ------------------------------------------------ movements plan
  const movementRows: ParsedRow[] = useMemo(() => (isMovementReady(table) ? table.rows : applyMapping(table, moveMap, MOVEMENT_FIELDS)), [table, moveMap]);
  const drafts = useMemo(() => (dest === "movements" ? buildMovementDrafts(movementRows, direction, fallback) : []), [dest, movementRows, direction, fallback]);
  const mPlan = useMemo(() => (dest === "movements" ? planMovements(drafts, movements, resolver, { replaceChanged }) : null), [dest, drafts, movements, resolver, replaceChanged]);

  // ------------------------------------------------ stock items plan
  const stockRows: ParsedRow[] = useMemo(() => (isStockReady(table) ? table.rows : applyMapping(table, stockMap, STOCK_ITEM_FIELDS)), [table, stockMap]);
  const sPlan = useMemo(() => (dest === "stock_items" ? planStockItems(table, stockRows, products, qtyMode) : null), [dest, table, stockRows, products, qtyMode]);

  // ------------------------------------------------ shipments plan
  const shPlan = useMemo(() => (dest === "shipments" && table.kind === "shopify_orders" ? planShipmentsFromOrders(table, shipments) : null), [dest, table, shipments]);

  const existingDataset = datasets.find((d) => d.name.trim().toLowerCase() === dsName.trim().toLowerCase());
  const targetDataset = datasets.find((d) => d.id === dsTarget);

  const editRaw = (index: number, key: string, raw: string) => {
    const srcKey = dest === "movements" && !isMovementReady(table) ? moveMap[key] : dest === "stock_items" && !isStockReady(table) ? stockMap[key] : key;
    if (!srcKey) return;
    const col = table.columns.find((c) => c.key === srcKey);
    let value: ParsedRow[string] = raw.trim() === "" ? null : raw;
    if (raw.trim() !== "") {
      if (key === "qty" || col?.type === "number") {
        const n = parseNumberLoose(raw, true);
        value = n ?? raw;
      } else if (key === "date" || col?.type === "date") {
        value = parseDateLoose(raw) ?? raw;
      }
    }
    setTable((t) => ({ ...t, rows: t.rows.map((r, i) => (i === index ? { ...r, [srcKey]: value } : r)) }));
  };
  const deleteRow = (index: number) => setTable((t) => ({ ...t, rows: t.rows.filter((_, i) => i !== index) }));

  // ------------------------------------------------ commit
  const save = async () => {
    setBusy(true);
    setProgress("Starting");
    try {
      const p = (m: string) => setProgress(m);
      if (dest === "movements" && mPlan) {
        if (mPlan.replaceIds.length && !(await confirm(`Replace ${mPlan.changed.length} voucher(s) that are already saved with different lines? The old lines will be removed.`, { danger: true, confirmLabel: "Replace" }))) return;
        const batch = await commitMovements(table, mPlan, p);
        setResult({
          batch,
          text: `${formatNumber(batch.inserted)} stock lines saved (${formatNumber(mPlan.totalQty)} units). ${mPlan.duplicates ? `${mPlan.duplicates} already saved lines were skipped. ` : ""}${mPlan.invalid ? `${mPlan.invalid} lines with problems were not saved.` : ""}`,
          link: { href: "/movements", label: "Open stock in and out" },
          unmapped: mPlan.unmapped,
        });
      } else if (dest === "stock_items" && sPlan) {
        if (qtyMode === "opening" && movements.length > 0 && !(await confirm("Stock movements already exist. Setting opening stock from this file changes the stock on hand of every item in it. Continue?", { danger: true, confirmLabel: "Set opening stock" }))) return;
        const batch = await commitStockItems(table, sPlan.rows, p);
        setResult({ batch, text: `${sPlan.newCount} new and ${sPlan.updateCount} existing stock items saved.`, link: { href: "/stock", label: "Open stock items" } });
      } else if (dest === "shipments" && shPlan) {
        const batch = await commitShipments(table, shPlan.rows, p);
        setResult({ batch, text: `${shPlan.rows.length} shipments created from orders. Add photos from the Shipments screen.`, link: { href: "/shipments", label: "Open shipments" } });
      } else if (dest === "dataset") {
        if (dsMode === "new" && !dsName.trim()) return toast("error", "Give the new section a name.");
        if (dsMode !== "new" && !targetDataset) return toast("error", "Choose which section to add to.");
        if (dsMode === "replace" && !(await confirm(`Replace all rows in "${targetDataset!.name}" with this file?`, { danger: true, confirmLabel: "Replace" }))) return;
        const target = dsMode === "new" ? ({ mode: "new", name: dsName } as const) : ({ mode: dsMode, dataset: targetDataset!, dedupeOn } as const);
        const { batch, dataset } = await commitDataset(table, target, datasets, datasetRows, p);
        setResult({ batch, text: `${formatNumber(batch.inserted)} rows saved in "${dataset.name}".${batch.skipped ? ` ${batch.skipped} duplicates skipped.` : ""}`, link: { href: `/sections/${dataset.slug}`, label: `Open ${dataset.name}` } });
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const undo = async () => {
    if (!result) return;
    if (!(await confirm(`Undo this import? The ${result.batch.destination === "dataset" ? "rows" : "stock lines"} it added will be removed.`, { danger: true, confirmLabel: "Undo import" }))) return;
    try {
      await undoBatch(result.batch);
      setResult(null);
      toast("success", "Import undone.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not undo.");
    }
  };

  // ------------------------------------------------ preview columns
  const preview = useMemo(() => {
    if (dest === "movements" && mPlan) {
      const cols: PreviewColumn[] = [
        { key: "date", label: "Date", type: "date" },
        { key: "type", label: "Type", computed: true },
        { key: "item", label: "Item" },
        { key: "qty", label: "Qty", type: "number" },
        { key: "party", label: "Party" },
        { key: "voucher_no", label: "Voucher" },
        { key: "voucher_type", label: "Voucher type" },
        { key: "city", label: "City" },
        { key: "state", label: "State" },
      ];
      const rows = drafts.map((d) => ({ ...d }));
      return { cols, rows: rows as unknown as Record<string, unknown>[], statuses: mPlan.statuses };
    }
    const cols: PreviewColumn[] = table.columns.filter((c) => !c.hidden).slice(0, 16).map((c) => ({ key: c.key, label: c.label, type: c.type }));
    return { cols, rows: table.rows as Record<string, unknown>[], statuses: undefined };
  }, [dest, mPlan, drafts, table]);

  // totals check for the movement import
  const check = useMemo(() => {
    if (!mPlan) return null;
    let file = 0;
    let dup = 0;
    let bad = 0;
    let changed = 0;
    drafts.forEach((d, i) => {
      const q = d.qty ?? 0;
      file += q;
      const s = mPlan.statuses[i];
      if (s?.status === "duplicate") dup += q;
      else if (s?.status === "invalid") bad += q;
      else if (s?.status === "changed") changed += q;
    });
    return { file, save: mPlan.totalQty, dup, bad, changed, balanced: Math.abs(file - (mPlan.totalQty + dup + bad + changed)) < 0.0001 };
  }, [mPlan, drafts]);

  const issues = table.issues;
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.filter((i) => i.level === "warn").length;

  const canSave =
    !busy && !result &&
    ((dest === "movements" && canWrite && canManage && !!mPlan && mPlan.inserts.length > 0) ||
      (dest === "stock_items" && canManage && !!sPlan && sPlan.rows.length > 0) ||
      (dest === "shipments" && canWrite && !!shPlan && shPlan.rows.length > 0) ||
      (dest === "dataset" && canManage && table.rows.length > 0));

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-start gap-3 border-b border-ink-100 p-4">
        <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{table.source.split("/").pop()}</h2>
            {table.sheet && table.sheet !== table.source && <span className="text-sm text-ink-500">sheet: {table.sheet}</span>}
            <Badge tone={table.kind === "generic" ? "gray" : "brand"}>{table.kindLabel}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {table.stats.map((s) => (
              <span key={s.label} className="text-ink-600">
                {s.label}: <b className="text-ink-900">{s.value}</b>
              </span>
            ))}
          </div>
        </div>
        {!result && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remove this file from the list">
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>

      {(table.notes.length > 0 || issues.length > 0) && (
        <div className="space-y-1 border-b border-ink-100 bg-ink-50/60 px-4 py-3 text-sm">
          {table.notes.map((n, i) => (
            <p key={i} className="flex gap-2 text-ink-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              {n}
            </p>
          ))}
          {issues.length > 0 && (
            <div>
              <button className="flex items-center gap-2 text-left text-ink-800" onClick={() => setShowIssues((s) => !s)}>
                <AlertTriangle className={clsx("h-4 w-4", errorCount ? "text-red-600" : "text-amber-600")} />
                <span>
                  {errorCount > 0 && <b className="text-red-700">{errorCount} error{errorCount > 1 ? "s" : ""}</b>}
                  {errorCount > 0 && warnCount > 0 && ", "}
                  {warnCount > 0 && <b className="text-amber-700">{warnCount} warning{warnCount > 1 ? "s" : ""}</b>}
                  {errorCount + warnCount === 0 && `${issues.length} note${issues.length > 1 ? "s" : ""}`}
                </span>
                <span className="text-xs text-brand-700 underline">{showIssues ? "Hide" : "Show details"}</span>
              </button>
              {showIssues && (
                <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-9 text-ink-700">
                  {issues.map((i, k) => (
                    <li key={k} className={clsx(i.level === "error" && "text-red-700", i.level === "warn" && "text-amber-800")}>
                      {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {result ? (
        <div className="space-y-3 p-4">
          <div className="flex items-start gap-3 rounded-lg bg-green-50 p-3 text-green-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">Saved</p>
              <p>{result.text}</p>
            </div>
          </div>
          {!!result.unmapped && result.unmapped > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {result.unmapped} line(s) use item names that are not linked to a stock item yet. They are saved, but they will not change stock levels until you link the names.{" "}
              <Link href="/mapping" className="font-medium underline">
                Match names now
              </Link>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {result.link && (
              <Link href={result.link.href} className="btn btn-primary">
                {result.link.label}
              </Link>
            )}
            {canManage && (
              <Button onClick={undo}>
                <Undo2 className="h-4 w-4" /> Undo this import
              </Button>
            )}
            <Button variant="ghost" onClick={onRemove}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {/* destination */}
          <div>
            <p className="label">Where should this go?</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {allowed.map((d) => (
                <button
                  key={d}
                  onClick={() => setDest(d)}
                  className={clsx("rounded-lg border p-3 text-left transition", dest === d ? "border-brand-500 bg-brand-50 ring-1 ring-brand-300" : "border-ink-200 bg-white hover:bg-ink-50")}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {DEST_INFO[d].icon}
                    {DEST_INFO[d].label}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-500">{DEST_INFO[d].help}</span>
                </button>
              ))}
            </div>
          </div>

          {/* movement options */}
          {dest === "movements" && (
            <div className="space-y-3 rounded-lg border border-ink-200 p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Direction of stock">
                  <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT" | "auto")}>
                    <option value="auto">Decide from voucher type</option>
                    <option value="OUT">Stock out (sales, dispatch)</option>
                    <option value="IN">Stock in (purchase, receipt)</option>
                  </select>
                </Field>
                {direction === "auto" && (
                  <Field label="If voucher type is unclear" hint="Used only for types the app does not recognise">
                    <select className="input" value={fallback} onChange={(e) => setFallback(e.target.value as "IN" | "OUT")}>
                      <option value="OUT">Treat as stock out</option>
                      <option value="IN">Treat as stock in</option>
                    </select>
                  </Field>
                )}
              </div>
              {!isMovementReady(table) && <MappingEditor title="Which column holds what?" fields={MOVEMENT_FIELDS} table={table} mapping={moveMap} onChange={setMoveMap} />}
              {mPlan && mPlan.changed.length > 0 && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <input type="checkbox" className="mt-1" checked={replaceChanged} onChange={(e) => setReplaceChanged(e.target.checked)} />
                  <span>
                    <b>{mPlan.changed.length} voucher(s) were saved before with different lines</b> ({mPlan.changed.slice(0, 4).map((c) => c.label).join(", ")}
                    {mPlan.changed.length > 4 ? ", …" : ""}). Tick this to replace the old lines with the ones in this file. Left unticked, they are skipped.
                  </span>
                </label>
              )}
              {mPlan && check && (
                <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <Tile label="Will be saved" value={`${formatNumber(mPlan.inserts.length)} lines`} sub={`${formatNumber(check.save)} units`} tone="green" />
                  <Tile label="Already saved (skipped)" value={`${formatNumber(mPlan.duplicates)} lines`} sub={`${formatNumber(check.dup)} units`} />
                  <Tile label="Need a fix" value={`${formatNumber(mPlan.invalid)} lines`} sub={mPlan.invalid ? "Correct in the table below or they are skipped" : "None"} tone={mPlan.invalid ? "red" : undefined} />
                  <Tile label="Names not linked yet" value={`${formatNumber(mPlan.unmapped)} lines`} sub={mPlan.unmapped ? "Link them after saving" : "All linked"} tone={mPlan.unmapped ? "amber" : undefined} />
                  <p className="col-span-full text-xs text-ink-500">
                    Check: file total {formatNumber(check.file)} units = saved {formatNumber(check.save)} + already saved {formatNumber(check.dup)} + need a fix {formatNumber(check.bad)}
                    {check.changed ? ` + changed vouchers ${formatNumber(check.changed)}` : ""}
                    {check.balanced ? " ✓" : " (does not add up, please review)"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* stock item options */}
          {dest === "stock_items" && (
            <div className="space-y-3 rounded-lg border border-ink-200 p-3">
              {!isStockReady(table) && <MappingEditor title="Which column holds what?" fields={STOCK_ITEM_FIELDS} table={table} mapping={stockMap} onChange={setStockMap} />}
              <Field label="What should the quantities in this file mean?">
                <select className="input max-w-md" value={qtyMode} onChange={(e) => setQtyMode(e.target.value as QtyMode)}>
                  <option value="shopify">Shopify quantity, for comparison only (safe)</option>
                  <option value="opening">Opening stock: start counting from these numbers</option>
                  <option value="none">Ignore quantities</option>
                </select>
              </Field>
              {qtyMode === "opening" && <p className="text-xs text-amber-800">Use this once, when you start. Stock on hand = opening stock + purchases - sales. Then set Count stock from, in Settings, to the date of this file so older lines are not counted twice.</p>}
              {sPlan && (
                <div className="grid gap-2 text-sm sm:grid-cols-4">
                  <Tile label="New items" value={formatNumber(sPlan.newCount)} tone="green" />
                  <Tile label="Existing items updated" value={formatNumber(sPlan.updateCount)} />
                  <Tile label="Same code merged" value={formatNumber(sPlan.mergedDuplicates)} sub={sPlan.mergedDuplicates ? "Quantities added together" : undefined} />
                  <Tile label="Skipped (no name)" value={formatNumber(sPlan.invalid)} tone={sPlan.invalid ? "red" : undefined} />
                </div>
              )}
              <p className="text-xs text-ink-500">Opening stock, reorder level, unit and notes you typed in the app are never overwritten by a Shopify file.</p>
            </div>
          )}

          {/* shipments */}
          {dest === "shipments" && shPlan && (
            <div className="grid gap-2 rounded-lg border border-ink-200 p-3 text-sm sm:grid-cols-3">
              <Tile label="Shipments to create" value={formatNumber(shPlan.rows.length)} tone="green" sub="Name, phone, city and order number are filled in" />
              <Tile label="Already in Shipments" value={formatNumber(shPlan.skippedExisting)} />
              <Tile label="Orders in file" value={table.stats.find((s) => s.label === "Orders")?.value ?? ""} />
            </div>
          )}

          {/* dataset */}
          {dest === "dataset" && (
            <div className="space-y-3 rounded-lg border border-ink-200 p-3">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["new", "Make a new section"],
                    ["append", "Add rows to a section"],
                    ["replace", "Replace a section's rows"],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} onClick={() => setDsMode(m)} className={clsx("rounded-full border px-3 py-1 text-sm", dsMode === m ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 hover:bg-ink-50")}>
                    {label}
                  </button>
                ))}
              </div>
              {dsMode === "new" ? (
                <div className="max-w-md">
                  <Field label="Section name" hint={existingDataset ? `A section called "${existingDataset.name}" already exists. A new one will be named ${slugify(dsName)}-2.` : "It appears in the left menu as soon as it is saved."}>
                    <input className="input" value={dsName} onChange={(e) => setDsName(e.target.value)} />
                  </Field>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Section">
                    <select className="input" value={dsTarget} onChange={(e) => setDsTarget(e.target.value)}>
                      <option value="">Choose…</option>
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {dsMode === "append" && targetDataset && (
                    <Field label="Skip rows that already exist (match on)" hint="Leave empty to add every row. Columns are matched by heading name.">
                      <select
                        multiple
                        className="input h-24"
                        value={dedupeOn}
                        onChange={(e) => setDedupeOn([...e.target.selectedOptions].map((o) => o.value))}
                      >
                        {targetDataset.columns.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
              )}
            </div>
          )}

          {/* preview */}
          <div>
            <p className="label">Preview {dest === "movements" ? "(what will be saved)" : ""}</p>
            <PreviewTable
              columns={preview.cols}
              rows={preview.rows}
              statuses={preview.statuses}
              onEdit={dest === "movements" || dest === "dataset" || dest === "stock_items" ? editRaw : undefined}
              onDelete={deleteRow}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-100 pt-3">
            {!canManage && <p className="mr-auto text-sm text-amber-800">Your role cannot import files. Ask a manager or admin.</p>}
            {busy && <span className="text-sm text-ink-500">{progress}</span>}
            <Button variant="primary" disabled={!canSave} busy={busy} onClick={save}>
              {dest === "movements" && mPlan ? `Save ${formatNumber(mPlan.inserts.length)} stock lines` : dest === "stock_items" && sPlan ? `Save ${formatNumber(sPlan.rows.length)} stock items` : dest === "shipments" && shPlan ? `Create ${formatNumber(shPlan.rows.length)} shipments` : `Save ${formatNumber(table.rows.length)} rows`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "red" | "amber" }) {
  return (
    <div className={clsx("rounded-lg border px-3 py-2", tone === "green" && "border-green-200 bg-green-50", tone === "red" && "border-red-200 bg-red-50", tone === "amber" && "border-amber-200 bg-amber-50", !tone && "border-ink-200 bg-white")}>
      <p className="text-xs text-ink-600">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

function MappingEditor({ title, fields, table, mapping, onChange }: { title: string; fields: { key: string; label: string; required?: boolean }[]; table: ParsedTable; mapping: Mapping; onChange: (m: Mapping) => void }) {
  return (
    <div>
      <p className="label">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-sm">
            <span className="w-40 shrink-0 text-ink-700">
              {f.label}
              {f.required && <span className="text-red-600"> *</span>}
            </span>
            <select className="input !py-1" value={mapping[f.key] ?? ""} onChange={(e) => onChange({ ...mapping, [f.key]: e.target.value || null })}>
              <option value="">(not in file)</option>
              {table.columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
