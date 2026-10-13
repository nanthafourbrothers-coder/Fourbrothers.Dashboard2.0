"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, GitMerge } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db, useTable } from "@/lib/data/store";
import type { StockRow } from "@/lib/stock";
import { useStockRows } from "@/lib/data/useStock";
import { formatDateDisplay, formatNumber } from "@/lib/parse/normalize";
import type { Product } from "@/lib/types";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { StockItemModal } from "@/components/StockItemModal";
import { Badge, Button, EmptyState, Field, Modal, PageHeader, useUi } from "@/components/ui";
import Link from "next/link";

const FLAG_LABEL: Record<string, string> = { ok: "In stock", low: "Low", out: "Out of stock", negative: "Below zero", uncounted: "Not counted yet" };

export default function StockPage() {
  const auth = useAuth();
  const { toast, confirm } = useUi();
  const params = useSearchParams();
  const products = useTable("products");
  const movements = useTable("stock_movements");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [merging, setMerging] = useState<string[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { rows, since } = useStockRows(showArchived);
  const flag = params.get("flag");
  const initialFilters = flag ? { flag: { set: flag === "attention" ? ["low", "out", "negative"] : [flag] } } : undefined;

  const canEdit = auth.can("manage");
  const columns: GridColumn<StockRow>[] = [
    { key: "name", label: "Item", editable: true, width: 260 },
    { key: "sku", label: "SKU", editable: true },
    { key: "category", label: "Category", editable: true },
    { key: "location", label: "Location", editable: true },
    { key: "opening_qty", label: "Opening", type: "number", editable: true, digits: 0 },
    { key: "in_qty", label: "In", type: "number", digits: 0, sum: true },
    { key: "out_qty", label: "Out", type: "number", digits: 0, sum: true },
    { key: "adjust_qty", label: "Adjusted", type: "number", digits: 0, hidden: true },
    {
      key: "on_hand", label: "On hand", type: "number", digits: 0, sum: true,
      render: (r) => <b className={r.flag === "ok" || r.flag === "uncounted" ? "" : r.flag === "low" ? "text-amber-700" : "text-red-700"}>{formatNumber(r.on_hand)}</b>,
    },
    {
      key: "flag", label: "Status",
      get: (r) => r.flag,
      format: (v) => FLAG_LABEL[String(v)] ?? String(v),
      render: (r) => (r.flag === "ok" ? <span className="text-ink-400">In stock</span> : <Badge tone={r.flag === "uncounted" ? "gray" : r.flag === "low" ? "amber" : "red"}>{FLAG_LABEL[r.flag]}</Badge>),
    },
    { key: "reorder_level", label: "Reorder at", type: "number", editable: true, digits: 0 },
    { key: "shopify_qty", label: "Shopify qty", type: "number", digits: 0 },
    { key: "variance", label: "App minus Shopify", type: "number", digits: 0, hidden: true },
    { key: "last_out", label: "Last sold", type: "date" },
    { key: "price", label: "Price", type: "number", editable: true },
    { key: "cost", label: "Cost", type: "number", editable: true, hidden: true },
    { key: "unit", label: "Unit", editable: true, hidden: true },
    { key: "vendor", label: "Vendor", hidden: true },
    { key: "notes", label: "Notes", editable: true, hidden: true },
    { key: "status", label: "Record", options: ["active", "archived"], editable: true, hidden: true },
  ];

  const attention = rows.filter((r) => r.flag !== "ok" && r.flag !== "uncounted").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock items"
        subtitle="Stock on hand = opening stock + purchases (in) - sales (out) + adjustments. Double click a cell to edit it. Click a row for its full history."
        actions={
          <Link href="/import" className="btn">
            Import a file
          </Link>
        }
      />
      {products.loaded && products.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No stock items yet"
            text="Import your Tally invoice register or a Shopify inventory file to build the list, or add items one by one."
            action={
              <div className="flex gap-2">
                <Link href="/import" className="btn btn-primary">
                  Import files
                </Link>
                {canEdit && <Button onClick={() => setAdding(true)}>Add an item</Button>}
              </div>
            }
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/stock" className={`rounded-full border px-3 py-1 ${!flag ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
              All
            </Link>
            <Link href="/stock?flag=attention" className={`rounded-full border px-3 py-1 ${flag === "attention" ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
              Needs attention ({attention})
            </Link>
            <Link href="/stock?flag=out" className={`rounded-full border px-3 py-1 ${flag === "out" ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
              Out of stock ({rows.filter((r) => r.flag === "out").length})
            </Link>
            <Link href="/stock?flag=low" className={`rounded-full border px-3 py-1 ${flag === "low" ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
              Low ({rows.filter((r) => r.flag === "low").length})
            </Link>
            {rows.some((r) => r.flag === "uncounted") && (
              <Link href="/stock?flag=uncounted" className={`rounded-full border px-3 py-1 ${flag === "uncounted" ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
                Not counted yet ({rows.filter((r) => r.flag === "uncounted").length})
              </Link>
            )}
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
            </label>
          </div>
          {since && (
            <p className="text-xs text-ink-500">
              Counting stock from {formatDateDisplay(since)}. Earlier lines stay saved but are not counted, because opening stock is the count on that day. <Link className="text-brand-700 underline" href="/settings">Change</Link>
            </p>
          )}
          <DataGrid
            key={flag ?? "all"}
            id="stock"
            title="stock items"
            rows={rows}
            rowId={(r) => r.id}
            columns={columns}
            loading={!products.loaded || !movements.loaded}
            canEdit={canEdit}
            canDelete={canEdit}
            initialFilters={initialFilters}
            initialSearch={params.get("q") ?? undefined}
            defaultSort={{ key: "name", dir: "asc" }}
            onEdit={async (r, key, value) => {
              await db.update("products", r.id, { [key]: value } as Partial<Product>);
            }}
            onDelete={async (ids) => {
              await db.remove("products", ids);
            }}
            onAdd={canEdit ? () => setAdding(true) : undefined}
            addLabel="Add item"
            onRowClick={(r) => setOpen(r.id)}
            bulkActions={
              canEdit
                ? [
                    { label: "Merge into one item", onClick: (ids) => (ids.length < 2 ? toast("info", "Select at least two items to merge.") : setMerging(ids)) },
                    {
                      label: "Archive",
                      onClick: async (ids) => {
                        if (!(await confirm(`Archive ${ids.length} item(s)? They are hidden from stock lists but keep their history.`, { confirmLabel: "Archive" }))) return;
                        await db.updateMany("products", ids, { status: "archived" });
                        toast("success", "Archived.");
                      },
                    },
                  ]
                : undefined
            }
            rowClass={(r) => (r.status === "archived" ? "opacity-50" : undefined)}
          />
        </>
      )}
      {open && rows.find((r) => r.id === open) && <StockItemModal item={rows.find((r) => r.id === open)!} onClose={() => setOpen(null)} />}
      {adding && <AddItemModal onClose={() => setAdding(false)} />}
      {merging && <MergeModal ids={merging} rows={rows} onClose={() => setMerging(null)} />}
    </div>
  );
}

function AddItemModal({ onClose }: { onClose: () => void }) {
  const { toast } = useUi();
  const [f, setF] = useState({ name: "", sku: "", category: "", location: "", opening_qty: "0", reorder_level: "0", price: "", unit: "Pcs" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.name.trim()) return toast("error", "Item name is required.");
    setBusy(true);
    try {
      await db.insert("products", [
        {
          name: f.name.trim(),
          sku: f.sku.trim() || null,
          ext_key: f.sku.trim() || `manual::${f.name.trim().toLowerCase()}`,
          category: f.category.trim() || null,
          location: f.location.trim() || null,
          opening_qty: Number(f.opening_qty) || 0,
          reorder_level: Number(f.reorder_level) || 0,
          price: f.price ? Number(f.price) : null,
          unit: f.unit.trim() || null,
        },
      ]);
      toast("success", "Item added.");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not add the item.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Add stock item" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Add item</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item name *" className="sm:col-span-2"><input className="input" value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="SKU / code"><input className="input" value={f.sku} onChange={set("sku")} /></Field>
        <Field label="Category"><input className="input" value={f.category} onChange={set("category")} /></Field>
        <Field label="Location"><input className="input" value={f.location} onChange={set("location")} placeholder="Godown, shop…" /></Field>
        <Field label="Unit"><input className="input" value={f.unit} onChange={set("unit")} /></Field>
        <Field label="Opening stock"><input className="input" type="number" value={f.opening_qty} onChange={set("opening_qty")} /></Field>
        <Field label="Reorder when stock is at or below"><input className="input" type="number" value={f.reorder_level} onChange={set("reorder_level")} /></Field>
        <Field label="Selling price"><input className="input" type="number" value={f.price} onChange={set("price")} /></Field>
      </div>
    </Modal>
  );
}

function MergeModal({ ids, rows, onClose }: { ids: string[]; rows: StockRow[]; onClose: () => void }) {
  const { toast } = useUi();
  const items = rows.filter((r) => ids.includes(r.id));
  const [target, setTarget] = useState(items[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const movements = useTable("stock_movements").rows;
  const aliases = useTable("product_aliases").rows;
  const merge = async () => {
    setBusy(true);
    try {
      const others = items.filter((i) => i.id !== target);
      const tgt = items.find((i) => i.id === target)!;
      const moveIds = movements.filter((m) => m.product_id && others.some((o) => o.id === m.product_id)).map((m) => m.id);
      await db.updateMany("stock_movements", moveIds, { product_id: target });
      const aliasIds = aliases.filter((a) => a.product_id && others.some((o) => o.id === a.product_id)).map((a) => a.id);
      await db.updateMany("product_aliases", aliasIds, { product_id: target });
      const extra = others.reduce((s, o) => s + Number(o.opening_qty || 0), 0);
      if (extra) await db.update("products", target, { opening_qty: Number(tgt.opening_qty || 0) + extra });
      await db.remove("products", others.map((o) => o.id));
      await db.audit("merge items", "products", `${others.map((o) => o.name).join(", ")} into ${tgt.name}`, target);
      toast("success", `Merged ${others.length} item(s) into ${tgt.name}.`);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not merge.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Merge items" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={merge}>Merge</Button></>}>
      <p className="mb-3 text-sm text-ink-600">All stock lines, linked names and opening stock of the other items move into the item you keep. The others are removed.</p>
      <div className="space-y-1.5">
        {items.map((i) => (
          <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm hover:bg-ink-50">
            <input type="radio" name="keep" checked={target === i.id} onChange={() => setTarget(i.id)} />
            <span className="flex-1">{i.name}</span>
            <span className="text-ink-500">on hand {formatNumber(i.on_hand)}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs text-ink-500"><GitMerge className="h-3.5 w-3.5" /> Keep the one you selected above. <Archive className="ml-2 h-3.5 w-3.5" /> Prefer to keep the old one visible? Use Archive instead.</p>
    </Modal>
  );
}
