"use client";

import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import { FileUp, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTable } from "@/lib/data/store";
import { readAnyFile } from "@/lib/parse/rawFile";
import { interpretSheet } from "@/lib/parse/detect";
import type { ParsedTable } from "@/lib/parse/table";
import { undoBatch } from "@/lib/importCommit";
import { formatNumber } from "@/lib/parse/normalize";
import { ImportCard } from "@/components/ImportCard";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { Button, PageHeader, Spinner, useUi } from "@/components/ui";
import type { ImportBatch } from "@/lib/types";

const MAX_BYTES = 40 * 1024 * 1024;

interface Loaded {
  id: number;
  table: ParsedTable;
}

export default function ImportPage() {
  const { toast, confirm } = useUi();
  const auth = useAuth();
  const batches = useTable("import_batches");
  const [items, setItems] = useState<Loaded[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [drag, setDrag] = useState(false);
  const counter = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setReading(true);
    const errs: string[] = [];
    const added: Loaded[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) {
        errs.push(`${f.name}: larger than 40 MB. Split it into smaller files.`);
        continue;
      }
      const res = await readAnyFile(f.name, await f.arrayBuffer());
      errs.push(...res.errors);
      for (const sheet of res.sheets) {
        const table = interpretSheet(sheet);
        if (!table.rows.length) {
          errs.push(`${f.name}${sheet.name ? ` (${sheet.name})` : ""}: no data rows were found.`);
          continue;
        }
        added.push({ id: ++counter.current, table });
      }
    }
    setItems((cur) => [...added, ...cur]);
    setErrors(errs);
    setReading(false);
    if (added.length) toast("success", `${added.length} table${added.length > 1 ? "s" : ""} read. Check the preview, then save.`);
  }, [toast]);

  const columns: GridColumn<ImportBatch>[] = [
    { key: "created_at", label: "When", type: "datetime", get: (b) => b.created_at.slice(0, 16).replace("T", " ") },
    { key: "filename", label: "File" },
    { key: "destination", label: "Went to", get: (b) => ({ movements: "Stock in and out", stock_items: "Stock items", dataset: "A section", shipments: "Shipments" })[b.destination] ?? b.destination },
    { key: "row_count", label: "Rows in file", type: "number", digits: 0 },
    { key: "inserted", label: "Saved", type: "number", digits: 0 },
    { key: "skipped", label: "Skipped", type: "number", digits: 0 },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import files"
        subtitle="Drop Excel, CSV, PDF, JSON or ZIP files. Tally registers, purchase books and Shopify exports are recognised automatically. Nothing is saved until you press Save, and every import can be undone."
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={clsx("card flex flex-col items-center justify-center gap-2 border-2 border-dashed px-6 py-10 text-center transition", drag ? "border-brand-500 bg-brand-50" : "border-ink-300")}
      >
        <FileUp className="h-8 w-8 text-brand-600" />
        <p className="text-sm font-semibold">Drag files here, or choose them</p>
        <p className="text-xs text-ink-500">.xlsx  .csv  .tsv  .json  .pdf  .zip (Shopify exports come as zip, that works too)</p>
        <Button variant="primary" onClick={() => input.current?.click()} disabled={reading}>
          Choose files
        </Button>
        <input ref={input} type="file" multiple hidden accept=".xlsx,.xlsm,.csv,.tsv,.txt,.json,.pdf,.zip" onChange={(e) => e.target.files && void handleFiles(e.target.files)} />
        {reading && <Spinner label="Reading your files" />}
      </div>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Some files could not be used</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {items.map((it) => (
        <ImportCard key={it.id} initial={it.table} onRemove={() => setItems((cur) => cur.filter((x) => x.id !== it.id))} />
      ))}

      <section>
        <h2 className="mb-2 text-base font-semibold">Import history</h2>
        <DataGrid
          id="import-history"
          title="imports"
          rows={[...batches.rows].sort((a, b) => b.created_at.localeCompare(a.created_at))}
          rowId={(b) => b.id}
          columns={columns}
          loading={!batches.loaded}
          pageSize={25}
          maxHeightClass="max-h-80"
          rowActions={
            auth.can("manage")
              ? (b) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Undo this import"
                    aria-label="Undo this import"
                    onClick={async () => {
                      if (!(await confirm(`Undo the import of ${b.filename}? ${formatNumber(b.inserted)} saved lines will be removed.`, { danger: true, confirmLabel: "Undo import" }))) return;
                      try {
                        await undoBatch(b);
                        toast("success", "Import undone.");
                      } catch (e) {
                        toast("error", e instanceof Error ? e.message : "Could not undo.");
                      }
                    }}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                )
              : undefined
          }
          emptyText="No imports yet."
        />
      </section>
    </div>
  );
}
