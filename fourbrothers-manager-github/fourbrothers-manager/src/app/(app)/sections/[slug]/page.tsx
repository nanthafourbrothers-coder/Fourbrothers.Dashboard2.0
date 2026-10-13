"use client";

// One section: a table made from an uploaded file. Edit cells, add rows, manage columns, export.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Columns3, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db, useTable } from "@/lib/data/store";
import { makeColumnKey, todayYmd } from "@/lib/parse/normalize";
import type { ColumnDef, ColumnType, Dataset } from "@/lib/types";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { Button, EmptyState, Field, Modal, PageHeader, Spinner, useUi } from "@/components/ui";

type Row = { id: string; data: Record<string, unknown> };

export default function SectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const auth = useAuth();
  const router = useRouter();
  const query = useSearchParams().get("q") ?? undefined;
  const { toast, confirm } = useUi();
  const datasets = useTable("datasets");
  const allRows = useTable("dataset_rows");
  const [adding, setAdding] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const dataset = datasets.rows.find((d) => d.slug === slug);
  const rows: Row[] = useMemo(() => (dataset ? allRows.rows.filter((r) => r.dataset_id === dataset.id).map((r) => ({ id: r.id, data: r.data })) : []), [allRows.rows, dataset]);

  if (!datasets.loaded) return <Spinner />;
  if (!dataset) {
    return (
      <div className="card">
        <EmptyState title="Section not found" text="It may have been renamed or deleted." action={<Link href="/sections" className="btn">All sections</Link>} />
      </div>
    );
  }

  const canWrite = auth.can("write");
  const canManage = auth.can("manage");
  const columns: GridColumn<Row>[] = dataset.columns.map((c) => ({
    key: c.key,
    label: c.label,
    type: c.type === "datetime" ? "text" : c.type,
    options: c.options,
    editable: true,
    hidden: c.hidden,
    width: c.width,
    get: (r) => r.data[c.key],
    digits: c.type === "number" ? 2 : undefined,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={dataset.name}
        subtitle={
          <>
            {dataset.description ? dataset.description + " " : ""}
            {dataset.source_file ? `First made from ${dataset.source_file}. ` : ""}
            <Link href="/sections" className="text-brand-700 hover:underline">All sections</Link>
          </>
        }
        actions={
          <>
            {canManage && (
              <Link href="/import" className="btn" title="Upload another file, then choose Add to an existing section">
                <FileUp className="h-4 w-4" /> Add rows from a file
              </Link>
            )}
            {canManage && (
              <Button onClick={() => setColumnsOpen(true)}>
                <Columns3 className="h-4 w-4" /> Columns
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setRenaming(true)}>
                <Pencil className="h-4 w-4" /> Rename
              </Button>
            )}
            {canManage && (
              <Button
                variant="danger"
                onClick={async () => {
                  if (!(await confirm(`Delete the section "${dataset.name}" and its ${rows.length} rows? This cannot be undone.`, { danger: true, confirmLabel: "Delete section" }))) return;
                  try {
                    await db.remove("datasets", [dataset.id]);
                    await db.audit("delete section", "datasets", dataset.name, dataset.id);
                    router.push("/sections");
                  } catch (e) {
                    toast("error", e instanceof Error ? e.message : "Could not delete.");
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />
      <DataGrid
        key={dataset.id}
        id={`section:${dataset.id}`}
        title={dataset.name}
        rows={rows}
        rowId={(r) => r.id}
        columns={columns}
        loading={!allRows.loaded}
        canEdit={canWrite}
        canDelete={canManage}
        initialSearch={query}
        onAdd={canWrite ? () => setAdding(true) : undefined}
        addLabel="Add row"
        onEdit={async (r, key, value) => {
          await db.update("dataset_rows", r.id, { data: { ...r.data, [key]: value } });
        }}
        onDelete={async (ids) => {
          await db.remove("dataset_rows", ids);
          await db.audit("delete rows", "dataset_rows", `${ids.length} rows from ${dataset.name}`, dataset.id);
        }}
        emptyText="This section has no rows yet. Add one, or upload a file."
      />
      {adding && <AddRowModal dataset={dataset} onClose={() => setAdding(false)} />}
      {columnsOpen && <ColumnsModal dataset={dataset} onClose={() => setColumnsOpen(false)} />}
      {renaming && <RenameModal dataset={dataset} onClose={() => setRenaming(false)} />}
    </div>
  );
}

function AddRowModal({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const { toast } = useUi();
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(dataset.columns.filter((c) => c.type === "date").map((c) => [c.key, todayYmd()])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const data: Record<string, unknown> = {};
    for (const c of dataset.columns) {
      const raw = (vals[c.key] ?? "").trim();
      if (!raw) continue;
      if (c.type === "number") {
        const n = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(n)) return toast("error", `${c.label} must be a number.`);
        data[c.key] = n;
      } else if (c.type === "boolean") data[c.key] = raw === "true";
      else data[c.key] = raw;
    }
    if (!Object.keys(data).length) return toast("error", "Fill in at least one field.");
    setBusy(true);
    try {
      await db.insert("dataset_rows", [{ dataset_id: dataset.id, data }]);
      toast("success", "Row added.");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not add the row.");
      setBusy(false);
    }
  };
  return (
    <Modal title={`Add a row to ${dataset.name}`} size="lg" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Add row</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {dataset.columns.map((c, i) => (
          <Field key={c.key} label={c.label}>
            {c.options?.length ? (
              <select className="input" value={vals[c.key] ?? ""} onChange={(e) => setVals({ ...vals, [c.key]: e.target.value })}>
                <option value="" />
                {c.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : c.type === "boolean" ? (
              <select className="input" value={vals[c.key] ?? ""} onChange={(e) => setVals({ ...vals, [c.key]: e.target.value })}>
                <option value="" />
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input className="input" type={c.type === "date" ? "date" : "text"} inputMode={c.type === "number" ? "decimal" : undefined} value={vals[c.key] ?? ""} onChange={(e) => setVals({ ...vals, [c.key]: e.target.value })} autoFocus={i === 0} />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function ColumnsModal({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const { toast, confirm } = useUi();
  const [cols, setCols] = useState<ColumnDef[]>(dataset.columns);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [busy, setBusy] = useState(false);

  const add = () => {
    if (!label.trim()) return toast("error", "Name the new column.");
    if (cols.some((c) => c.label.trim().toLowerCase() === label.trim().toLowerCase())) return toast("error", "A column with that name exists.");
    const key = makeColumnKey(label, new Set(cols.map((c) => c.key)));
    setCols([...cols, { key, label: label.trim(), type }]);
    setLabel("");
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    setCols(next);
  };

  const save = async () => {
    if (cols.some((c) => !c.label.trim())) return toast("error", "Every column needs a name.");
    setBusy(true);
    try {
      await db.update("datasets", dataset.id, { columns: cols.map((c) => ({ ...c, label: c.label.trim() })) });
      toast("success", "Columns saved.");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <Modal title="Columns" size="lg" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save columns</Button></>}>
      <p className="mb-3 text-sm text-ink-600">Rename, reorder, change the type, hide or add columns. Removing a column hides it from the table; the values stay in the saved rows, so nothing is lost if you add it back with the same name.</p>
      <div className="space-y-1.5">
        {cols.map((c, i) => (
          <div key={c.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 p-2">
            <input className="input min-w-[10rem] flex-1" value={c.label} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Column name" />
            <select className="input w-28" value={c.type} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, type: e.target.value as ColumnType } : x)))} aria-label="Column type">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="boolean">Yes / No</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-ink-600">
              <input type="checkbox" checked={!c.hidden} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, hidden: !e.target.checked } : x)))} /> Shown
            </label>
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</Button>
            <Button size="sm" variant="ghost" disabled={i === cols.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (cols.length === 1) return toast("error", "A section needs at least one column.");
                if (await confirm(`Remove the column "${c.label}" from this section? The values stay stored but are no longer shown.`, { danger: true, confirmLabel: "Remove" })) setCols(cols.filter((_, j) => j !== i));
              }}
              aria-label="Remove column"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="New column" className="min-w-[10rem] flex-1"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /></Field>
        <Field label="Type">
          <select className="input w-28" value={type} onChange={(e) => setType(e.target.value as ColumnType)}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="boolean">Yes / No</option>
          </select>
        </Field>
        <Button onClick={add}><Plus className="h-4 w-4" /> Add</Button>
      </div>
    </Modal>
  );
}

function RenameModal({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const { toast } = useUi();
  const [name, setName] = useState(dataset.name);
  const [description, setDescription] = useState(dataset.description ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return toast("error", "Name is required.");
    setBusy(true);
    try {
      await db.update("datasets", dataset.id, { name: name.trim(), description: description.trim() || null });
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Rename section" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Description" hint="The web address stays the same."><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
