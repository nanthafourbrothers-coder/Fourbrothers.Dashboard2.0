"use client";

import { useMemo, useState } from "react";
import { db, useTable } from "@/lib/data/store";
import { useAuth } from "@/lib/auth";
import { formatDateDisplay, formatNumber, todayYmd } from "@/lib/parse/normalize";
import type { StockRow } from "@/lib/stock";
import type { Movement } from "@/lib/types";
import { Badge, Button, Field, Modal, useUi } from "./ui";

export function StockItemModal({ item, onClose }: { item: StockRow; onClose: () => void }) {
  const { toast } = useUi();
  const auth = useAuth();
  const movements = useTable("stock_movements").rows;
  const aliases = useTable("product_aliases").rows;
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const history = useMemo(() => movements.filter((m) => m.product_id === item.id).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)), [movements, item.id]);
  const names = aliases.filter((a) => a.product_id === item.id);

  const saveCount = async () => {
    const n = Number(counted);
    if (counted.trim() === "" || !Number.isFinite(n) || n < 0) return toast("error", "Enter the counted quantity (0 or more).");
    const diff = n - item.on_hand;
    if (diff === 0) return toast("info", "The count matches the stock on hand. Nothing to adjust.");
    setBusy(true);
    try {
      await db.insert("stock_movements", [{ date: todayYmd(), type: "ADJUST", product_id: item.id, raw_name: item.name, qty: diff, source: "manual", notes: note.trim() || "Stock count" } as Partial<Movement>]);
      await db.audit("stock count", "products", `${item.name}: ${item.on_hand} to ${n}`, item.id);
      toast("success", `Stock set to ${formatNumber(n)} (adjustment ${diff > 0 ? "+" : ""}${formatNumber(diff)}).`);
      setCounted("");
      setNote("");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save the count.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={item.name} onClose={onClose} size="lg" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["Opening", item.opening_qty],
            ["In", item.in_qty],
            ["Out", item.out_qty],
            ["Adjusted", item.adjust_qty],
            ["On hand", item.on_hand],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-lg border border-ink-200 px-3 py-2">
              <p className="text-xs text-ink-500">{l}</p>
              <p className="text-lg font-semibold tabular-nums">{formatNumber(v as number)}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
          {item.sku && <Badge>SKU {item.sku}</Badge>}
          {item.category && <Badge>{item.category}</Badge>}
          {item.shopify_qty != null && <Badge tone={item.variance ? "amber" : "green"}>Shopify {formatNumber(item.shopify_qty)}{item.variance ? ` (app is ${item.variance > 0 ? "+" : ""}${formatNumber(item.variance)})` : ""}</Badge>}
        </div>

        {auth.can("write") && (
          <div className="rounded-lg border border-ink-200 p-3">
            <p className="mb-2 text-sm font-semibold">Physical count</p>
            <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
              <Field label="Counted quantity">
                <input className="input" type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} />
              </Field>
              <Field label="Note (optional)">
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Godown count, damaged pieces…" />
              </Field>
              <Button variant="primary" onClick={saveCount} busy={busy}>
                Set stock
              </Button>
            </div>
            <p className="mt-1 text-xs text-ink-500">This adds an adjustment line so the history stays complete.</p>
          </div>
        )}

        {names.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-semibold">Names from files linked to this item</p>
            <div className="flex flex-wrap gap-1.5">
              {names.map((a) => (
                <Badge key={a.id}>{a.alias}</Badge>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-sm font-semibold">History ({history.length})</p>
          <div className="scroll-thin max-h-64 overflow-auto rounded-lg border border-ink-200">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Type</th>
                  <th className="th text-right">Qty</th>
                  <th className="th">Party</th>
                  <th className="th">Voucher</th>
                </tr>
              </thead>
              <tbody>
                {history.map((m) => (
                  <tr key={m.id}>
                    <td className="td whitespace-nowrap">{formatDateDisplay(m.date)}</td>
                    <td className="td">
                      <Badge tone={m.type === "IN" ? "green" : m.type === "OUT" ? "red" : "amber"}>{m.type}</Badge>
                    </td>
                    <td className="td text-right tabular-nums">{formatNumber(m.qty)}</td>
                    <td className="td max-w-[220px] truncate">{m.party}</td>
                    <td className="td">{m.voucher_no}</td>
                  </tr>
                ))}
                {!history.length && (
                  <tr>
                    <td colSpan={5} className="td py-6 text-center text-ink-500">
                      No movements yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
