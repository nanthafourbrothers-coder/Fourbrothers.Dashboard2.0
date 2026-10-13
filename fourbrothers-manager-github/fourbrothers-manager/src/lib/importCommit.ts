"use client";

// Writes planned imports to the database. Every import is recorded as a batch so it can be undone.

import type { ColumnDef, Dataset, ImportBatch, Movement, Product, Shipment } from "./types";
import type { ParsedTable } from "./parse/table";
import { slugify } from "./parse/normalize";
import { db } from "./data/store";
import { rowsForDataset, type MovementPlan } from "./importPlan";

export type Progress = (message: string, done?: number, total?: number) => void;

async function startBatch(filename: string, kind: string, destination: string, rowCount: number): Promise<ImportBatch> {
  const [b] = await db.insert("import_batches", [{ filename, kind, destination, row_count: rowCount, inserted: 0, skipped: 0 }]);
  return b;
}

async function finishBatch(b: ImportBatch, inserted: number, skipped: number, summary?: Record<string, unknown>) {
  await db.update("import_batches", b.id, { inserted, skipped, summary: summary ?? null });
}

export async function commitMovements(table: ParsedTable, plan: MovementPlan, progress: Progress): Promise<ImportBatch> {
  const batch = await startBatch(table.source, table.kind, "movements", table.rows.length);
  try {
    if (plan.replaceIds.length) {
      progress(`Removing ${plan.changed.length} changed voucher(s) before re-adding them`);
      await db.remove("stock_movements", plan.replaceIds);
    }
    const rows = plan.inserts.map((r) => ({ ...r, batch_id: batch.id }));
    progress(`Saving ${rows.length} stock lines`, 0, rows.length);
    const saved = await db.insert("stock_movements", rows as Partial<Movement>[], { ignoreDuplicatesOn: "dedupe_key" });
    const skipped = table.rows.length - saved.length;
    await finishBatch(batch, saved.length, skipped, { duplicates: plan.duplicates, invalid: plan.invalid, unmapped: plan.unmapped, totalQty: plan.totalQty, byType: plan.byType, replaced: plan.replaceIds.length });
    await db.audit("import", "stock_movements", `${table.source}: ${saved.length} lines saved, ${plan.duplicates} duplicates skipped`, batch.id);
    return { ...batch, inserted: saved.length, skipped };
  } catch (e) {
    // do not leave an empty batch behind when nothing could be saved
    await db.remove("import_batches", [batch.id]).catch(() => undefined);
    throw e;
  }
}

export async function commitStockItems(table: ParsedTable, rows: Partial<Product>[], progress: Progress): Promise<ImportBatch> {
  const batch = await startBatch(table.source, table.kind, "stock_items", table.rows.length);
  try {
    progress(`Saving ${rows.length} stock items`, 0, rows.length);
    const saved = await db.upsert("products", rows, "ext_key");
    await finishBatch(batch, saved.length, 0);
    await db.audit("import", "products", `${table.source}: ${saved.length} stock items created or updated`, batch.id);
    return { ...batch, inserted: saved.length };
  } catch (e) {
    await db.remove("import_batches", [batch.id]).catch(() => undefined);
    throw e;
  }
}

export async function commitShipments(table: ParsedTable, rows: Partial<Shipment>[], progress: Progress): Promise<ImportBatch> {
  const batch = await startBatch(table.source, table.kind, "shipments", table.rows.length);
  try {
    progress(`Saving ${rows.length} shipments`, 0, rows.length);
    const saved = await db.insert("shipments", rows);
    await finishBatch(batch, saved.length, 0);
    await db.audit("import", "shipments", `${table.source}: ${saved.length} shipments created from orders`, batch.id);
    return { ...batch, inserted: saved.length };
  } catch (e) {
    await db.remove("import_batches", [batch.id]).catch(() => undefined);
    throw e;
  }
}

export type DatasetTarget =
  | { mode: "new"; name: string; description?: string }
  | { mode: "append" | "replace"; dataset: Dataset; dedupeOn?: string[] };

export async function uniqueSlug(name: string, existing: Dataset[]): Promise<string> {
  const base = slugify(name);
  const used = new Set(existing.map((d) => d.slug));
  let slug = base;
  let i = 2;
  while (used.has(slug)) slug = `${base}-${i++}`;
  return slug;
}

export async function commitDataset(table: ParsedTable, target: DatasetTarget, existingDatasets: Dataset[], existingRows: { dataset_id: string; data: Record<string, unknown> }[], progress: Progress): Promise<{ batch: ImportBatch; dataset: Dataset }> {
  const batch = await startBatch(table.source, table.kind, "dataset", table.rows.length);
  try {
    let dataset: Dataset;
    let columns: ColumnDef[] = table.columns;
    let rows = rowsForDataset(table);
    let skipped = 0;
    if (target.mode === "new") {
      const slug = await uniqueSlug(target.name, existingDatasets);
      [dataset] = await db.insert("datasets", [{ name: target.name.trim(), slug, description: target.description ?? null, columns, source_file: table.source }]);
    } else {
      dataset = target.dataset;
      // match incoming columns to existing ones by label so the same report can be uploaded again and again
      const have = new Map(dataset.columns.map((c) => [c.label.trim().toLowerCase(), c]));
      const remap = new Map<string, string>();
      const merged = [...dataset.columns];
      for (const c of table.columns) {
        const hit = have.get(c.label.trim().toLowerCase());
        if (hit) remap.set(c.key, hit.key);
        else {
          let key = c.key;
          const taken = new Set(merged.map((m) => m.key));
          while (taken.has(key)) key += "_x";
          remap.set(c.key, key);
          merged.push({ ...c, key });
        }
      }
      rows = rows.map((r) => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) o[remap.get(k) ?? k] = v;
        return o;
      });
      columns = merged;
      if (target.mode === "replace") {
        progress("Removing old rows");
        await db.removeWhere("dataset_rows", "dataset_id", dataset.id);
      } else if (target.dedupeOn?.length) {
        const keyOf = (data: Record<string, unknown>) => target.dedupeOn!.map((k) => String(data[k] ?? "").trim().toLowerCase()).join("||");
        const seen = new Set(existingRows.filter((r) => r.dataset_id === dataset.id).map((r) => keyOf(r.data)));
        const fresh: Record<string, unknown>[] = [];
        for (const r of rows) {
          const k = keyOf(r);
          if (seen.has(k)) skipped++;
          else {
            seen.add(k);
            fresh.push(r);
          }
        }
        rows = fresh;
      }
      if (merged.length !== dataset.columns.length) dataset = await db.update("datasets", dataset.id, { columns: merged });
    }
    progress(`Saving ${rows.length} rows`, 0, rows.length);
    const saved = await db.insert(
      "dataset_rows",
      rows.map((data) => ({ dataset_id: dataset.id, data, batch_id: batch.id })),
    );
    await finishBatch(batch, saved.length, skipped, { dataset: dataset.name, dataset_id: dataset.id, created_dataset: target.mode === "new" });
    await db.audit("import", "datasets", `${table.source}: ${saved.length} rows into "${dataset.name}"`, batch.id);
    return { batch: { ...batch, inserted: saved.length, skipped }, dataset };
  } catch (e) {
    await db.remove("import_batches", [batch.id]).catch(() => undefined);
    throw e;
  }
}

/** Undo a whole import: removes the lines it added (stock lines and section rows). Stock items and shipments are left in place. */
export async function undoBatch(batch: ImportBatch) {
  await db.remove("import_batches", [batch.id]);
  const s = batch.summary as { created_dataset?: boolean; dataset_id?: string } | null;
  if (s?.created_dataset && s.dataset_id) await db.remove("datasets", [s.dataset_id]).catch(() => undefined);
  await db.audit("undo import", "import_batches", `${batch.filename} (${batch.destination})`, batch.id);
}
