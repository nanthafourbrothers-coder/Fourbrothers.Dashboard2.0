"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db, useTable } from "@/lib/data/store";
import { NameResolver } from "@/lib/stock";
import { aliasKey, cleanText, formatNumber, parseAddress, stateFromGstin, todayYmd } from "@/lib/parse/normalize";
import type { Movement, MovementType } from "@/lib/types";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { Badge, Button, Field, Modal, PageHeader, useUi } from "@/components/ui";

export default function MovementsPage() {
  const auth = useAuth();
  const params = useSearchParams();
  const movements = useTable("stock_movements");
  const products = useTable("products");
  const aliases = useTable("product_aliases");
  const [adding, setAdding] = useState<MovementType | null>(null);
  const [view, setView] = useState<Movement[]>([]);
  const onView = useCallback((rows: Movement[]) => setView(rows), []);

  const resolver = useMemo(() => new NameResolver(products.rows, aliases.rows), [products.rows, aliases.rows]);
  const nameById = useMemo(() => new Map(products.rows.map((p) => [p.id, p.name])), [products.rows]);

  const totals = useMemo(() => {
    let i = 0;
    let o = 0;
    let a = 0;
    const vouchers = new Set<string>();
    for (const m of view) {
      const q = Number(m.qty) || 0;
      if (m.type === "IN") i += q;
      else if (m.type === "OUT") o += q;
      else a += q;
      if (m.voucher_no) vouchers.add(`${m.voucher_type}|${m.voucher_no}`);
    }
    return { i, o, a, vouchers: vouchers.size };
  }, [view]);

  const canWrite = auth.can("write");
  const type = params.get("type");
  let initialFilters: Record<string, { set: string[] }> | undefined;
  if (type) initialFilters = { type: { set: [type] } };
  else if (params.get("unlinked")) initialFilters = { linked: { set: ["Not linked"] } };

  const columns: GridColumn<Movement>[] = [
    { key: "date", label: "Date", type: "date", editable: true, width: 110 },
    {
      key: "type", label: "Type", options: ["IN", "OUT", "ADJUST"], editable: true,
      render: (m) => <Badge tone={m.type === "IN" ? "green" : m.type === "OUT" ? "red" : "amber"}>{m.type === "IN" ? "In" : m.type === "OUT" ? "Out" : "Adjust"}</Badge>,
      format: (v) => String(v),
    },
    { key: "raw_name", label: "Item (as in the file)", editable: true, width: 260 },
    { key: "linked", label: "Stock item", get: (m) => (m.product_id ? "Linked" : "Not linked"), render: (m) => (m.product_id ? <span className="text-ink-700">{nameById.get(m.product_id)}</span> : <Badge tone="amber">Not linked</Badge>), format: (v, m) => (m.product_id ? (nameById.get(m.product_id) ?? "") : "Not linked") },
    { key: "qty", label: "Qty", type: "number", editable: true, digits: 0 },
    { key: "party", label: "Party", editable: true, width: 200 },
    { key: "voucher_no", label: "Invoice no", editable: true },
    { key: "voucher_type", label: "Voucher type", editable: true },
    { key: "channel", label: "Channel", editable: true },
    { key: "city", label: "City", editable: true },
    { key: "state", label: "State", editable: true },
    { key: "pincode", label: "Pincode", editable: true, hidden: true },
    { key: "gstin", label: "GSTIN", editable: true, hidden: true },
    { key: "address", label: "Address", editable: true, hidden: true },
    { key: "location", label: "Godown", editable: true, hidden: true },
    { key: "source", label: "Source", hidden: true },
    { key: "notes", label: "Notes", editable: true, hidden: true },
    { key: "created_at", label: "Saved at", type: "datetime", hidden: true, get: (m) => m.created_at.slice(0, 16).replace("T", " ") },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock in and out"
        subtitle="Every purchase (in), sale or dispatch (out) and stock count adjustment. Search any invoice, party, city or item, filter by date, and edit lines directly."
        actions={
          canWrite && (
            <>
              <Button onClick={() => setAdding("IN")}>
                <Plus className="h-4 w-4" /> Stock in
              </Button>
              <Button variant="primary" onClick={() => setAdding("OUT")}>
                <Plus className="h-4 w-4" /> Stock out
              </Button>
            </>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="In (filtered)" value={totals.i} tone="green" />
        <Summary label="Out (filtered)" value={totals.o} tone="red" />
        <Summary label="Net" value={totals.i - totals.o + totals.a} />
        <Summary label="Invoices (filtered)" value={totals.vouchers} />
      </div>
      <DataGrid
        id="movements"
        title="stock lines"
        rows={movements.rows}
        rowId={(m) => m.id}
        columns={columns}
        loading={!movements.loaded}
        canEdit={canWrite}
        canDelete={auth.can("manage")}
        defaultSort={{ key: "date", dir: "desc" }}
        initialFilters={initialFilters}
        initialSearch={params.get("q") ?? undefined}
        onViewChange={onView}
        onEdit={async (m, key, value) => {
          if (key === "raw_name") {
            const name = cleanText(value);
            if (!name) throw new Error("Item name cannot be empty.");
            const pid = resolver.resolve(name);
            await db.update("stock_movements", m.id, { raw_name: name, product_id: pid ?? null });
            return;
          }
          if (key === "qty" && (value == null || Number(value) === 0)) throw new Error("Quantity must not be zero.");
          if (key === "qty" && m.type !== "ADJUST" && Number(value) < 0) throw new Error("Quantity must be above zero.");
          if (key === "date" && !value) throw new Error("Date is required.");
          const patch: Partial<Movement> = { [key]: value } as Partial<Movement>;
          if (key === "gstin" && value && !m.state) patch.state = stateFromGstin(String(value));
          await db.update("stock_movements", m.id, patch);
        }}
        onDelete={async (ids) => {
          await db.remove("stock_movements", ids);
          await db.audit("delete stock lines", "stock_movements", `${ids.length} lines`);
        }}
        emptyText="No stock lines yet. Import your Tally register or purchase book, or add a line."
      />
      {adding && <AddMovementModal type={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: "green" | "red" }) {
  return (
    <div className="card px-4 py-2.5">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone === "green" ? "text-green-700" : tone === "red" ? "text-red-600" : ""}`}>{formatNumber(value)}</p>
    </div>
  );
}

interface Line {
  item: string;
  qty: string;
}

function AddMovementModal({ type, onClose }: { type: MovementType; onClose: () => void }) {
  const { toast } = useUi();
  const products = useTable("products").rows;
  const aliases = useTable("product_aliases").rows;
  const resolver = useMemo(() => new NameResolver(products, aliases), [products, aliases]);
  const [f, setF] = useState({ date: todayYmd(), voucher_no: "", party: "", address: "", gstin: "", voucher_type: type === "IN" ? "PURCHASE" : "INVOICE", notes: "" });
  const [lines, setLines] = useState<Line[]>([{ item: "", qty: "" }]);
  const [busy, setBusy] = useState(false);
  const setField = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const valid = lines.filter((l) => l.item.trim() || l.qty.trim());
    if (!valid.length) return toast("error", "Add at least one item.");
    for (const l of valid) {
      const q = Number(l.qty);
      if (!l.item.trim()) return toast("error", "Every line needs an item.");
      if (!Number.isFinite(q) || q <= 0) return toast("error", `Quantity for "${l.item}" must be above zero.`);
    }
    setBusy(true);
    try {
      const { city, pincode } = parseAddress(f.address);
      const rows: Partial<Movement>[] = valid.map((l) => {
        const name = cleanText(l.item);
        return {
          date: f.date,
          type,
          product_id: resolver.resolve(name) ?? null,
          raw_name: name,
          qty: Number(l.qty),
          party: f.party.trim() || null,
          address: f.address.trim() || null,
          city,
          pincode,
          state: stateFromGstin(f.gstin),
          gstin: f.gstin.trim().toUpperCase() || null,
          voucher_type: f.voucher_type.trim() || null,
          voucher_no: f.voucher_no.trim() || null,
          source: "manual",
          notes: f.notes.trim() || null,
        };
      });
      await db.insert("stock_movements", rows);
      toast("success", `${rows.length} line${rows.length > 1 ? "s" : ""} saved.`);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={type === "IN" ? "Add stock in (purchase)" : "Add stock out (sale or dispatch)"}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={setField("date")} /></Field>
        <Field label={type === "IN" ? "Bill / challan no" : "Invoice no"}><input className="input" value={f.voucher_no} onChange={setField("voucher_no")} /></Field>
        <Field label="Voucher type"><input className="input" value={f.voucher_type} onChange={setField("voucher_type")} /></Field>
        <Field label={type === "IN" ? "Supplier" : "Customer or party"} className="sm:col-span-2"><input className="input" value={f.party} onChange={setField("party")} /></Field>
        <Field label="GSTIN"><input className="input" value={f.gstin} onChange={setField("gstin")} /></Field>
        <Field label="Address (city and pincode are picked up automatically)" className="sm:col-span-3"><input className="input" value={f.address} onChange={setField("address")} /></Field>
      </div>
      <div className="mt-4">
        <p className="label">Items</p>
        <datalist id="item-names">
          {products.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <div className="space-y-2">
          {lines.map((l, i) => {
            const known = l.item.trim() ? resolver.resolve(l.item) : undefined;
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <input className="input" list="item-names" placeholder="Start typing an item name" value={l.item} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
                  {l.item.trim() && known === undefined && <p className="mt-0.5 text-xs text-amber-700">Not linked to a stock item yet. It will be saved, and you can link it in Name matching.</p>}
                </div>
                <input className="input w-28" type="number" min="0" placeholder="Qty" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <Button variant="ghost" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)} aria-label="Remove line">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
        <Button className="mt-2" size="sm" onClick={() => setLines([...lines, { item: "", qty: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Add another item
        </Button>
      </div>
      <Field label="Notes" className="mt-4"><input className="input" value={f.notes} onChange={setField("notes")} /></Field>
    </Modal>
  );
}
