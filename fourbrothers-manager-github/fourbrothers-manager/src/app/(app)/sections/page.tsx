"use client";

// All sections. A section is a table made from an uploaded file (or created by hand) with its own rows and columns.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Database, FileUp, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db, useTable } from "@/lib/data/store";
import { formatDateDisplay, formatNumber, makeColumnKey } from "@/lib/parse/normalize";
import { uniqueSlug } from "@/lib/importCommit";
import type { ColumnDef } from "@/lib/types";
import { Button, EmptyState, Field, Modal, PageHeader, Spinner, useUi } from "@/components/ui";

export default function SectionsPage() {
  const auth = useAuth();
  const datasets = useTable("datasets");
  const rows = useTable("dataset_rows");
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows.rows) m.set(r.dataset_id, (m.get(r.dataset_id) ?? 0) + 1);
    return m;
  }, [rows.rows]);

  const sorted = [...datasets.rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sections"
        subtitle="Every new Excel or CSV you upload as a new section appears here as its own searchable, editable table. You can also start a blank one."
        actions={
          <>
            <Link href="/import" className="btn">
              <FileUp className="h-4 w-4" /> Upload a file
            </Link>
            {auth.can("manage") && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Blank section
              </Button>
            )}
          </>
        }
      />
      {!datasets.loaded ? (
        <Spinner />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState title="No sections yet" text="Upload any spreadsheet and choose New section. Its data is saved and a page for it is added to the menu." action={<Link href="/import" className="btn btn-primary">Import a file</Link>} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((d) => (
            <Link key={d.id} href={`/sections/${d.slug}`} className="card block p-4 transition hover:border-brand-300 hover:shadow-pop">
              <div className="flex items-start gap-3">
                <Database className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">{d.name}</p>
                  {d.description && <p className="mt-0.5 line-clamp-2 text-sm text-ink-500">{d.description}</p>}
                  <p className="mt-2 text-xs text-ink-500">
                    {formatNumber(counts.get(d.id) ?? 0)} rows | {d.columns.length} columns
                  </p>
                  <p className="text-xs text-ink-400">
                    {d.source_file ? `From ${d.source_file} | ` : ""}Updated {formatDateDisplay(d.updated_at.slice(0, 10))}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <NewSectionModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewSectionModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { toast } = useUi();
  const datasets = useTable("datasets").rows;
  const [name, setName] = useState("");
  const [cols, setCols] = useState("Date, Name, Details, Amount");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const labels = cols.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!name.trim()) return toast("error", "Give the section a name.");
    if (!labels.length) return toast("error", "List at least one column.");
    setBusy(true);
    try {
      const used = new Set<string>();
      const columns: ColumnDef[] = labels.map((label) => ({ key: makeColumnKey(label, used), label, type: /date/i.test(label) ? "date" : /amount|qty|quantity|price|total|rate/i.test(label) ? "number" : "text" }));
      const slug = await uniqueSlug(name, datasets);
      const [d] = await db.insert("datasets", [{ name: name.trim(), slug, columns, description: null, source_file: null }]);
      await db.audit("create section", "datasets", d.name, d.id);
      router.push(`/sections/${d.slug}`);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not create the section.");
      setBusy(false);
    }
  };

  return (
    <Modal title="New blank section" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Create</Button></>}>
      <div className="space-y-3">
        <Field label="Section name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Returns register" /></Field>
        <Field label="Columns, separated by commas" hint="Columns with date, amount, qty or price in the name become date or number columns. You can change columns later."><textarea className="input min-h-[80px]" value={cols} onChange={(e) => setCols(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
