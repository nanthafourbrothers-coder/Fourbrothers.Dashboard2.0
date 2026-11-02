"use client";

// "Needs attention": stock that is low, out or below zero, with a limit anyone with manage rights can change
// and an "Update stock" button at the bottom.

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/data/store";
import { useLowLimit, useStockRows } from "@/lib/data/useStock";
import { formatNumber } from "@/lib/parse/normalize";
import { StockItemModal } from "./StockItemModal";
import { StockExcelModal } from "./StockExcelModal";
import { Badge, Button, useUi } from "./ui";
import type { StockRow } from "@/lib/stock";

const label = (s: StockRow) => (s.flag === "low" ? "Low" : s.flag === "out" ? "Out" : "Below zero");

export function LowStockAlert({ showWhenEmpty = false, limitRows = 8 }: { showWhenEmpty?: boolean; limitRows?: number }) {
  const auth = useAuth();
  const { toast } = useUi();
  const { rows, loaded } = useStockRows();
  const limit = useLowLimit();
  const [draft, setDraft] = useState(String(limit));
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [excel, setExcel] = useState(false);
  const canManage = auth.can("manage");
  useEffect(() => setDraft(String(limit)), [limit]);

  const attention = rows.filter((s) => s.flag === "low" || s.flag === "out" || s.flag === "negative").sort((a, b) => a.on_hand - b.on_hand);
  if (!loaded || (!attention.length && !showWhenEmpty)) return null;
  const shown = all ? attention : attention.slice(0, limitRows);
  const openRow = rows.find((r) => r.id === open) ?? null;

  const saveLimit = async () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) {
      toast("error", "Enter a number, 0 or more.");
      return;
    }
    try {
      await db.upsert("settings", [{ key: "low_stock_limit", value: Math.round(n) }], "key");
      await db.audit("setting", "settings", `Low stock limit set to ${Math.round(n)}`);
      toast("success", `Items with less than ${formatNumber(Math.round(n))} in stock now show here.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save the limit.");
    }
  };

  return (
    <section className={`card min-w-0 overflow-hidden ${attention.length ? "border-amber-300" : "border-green-200"}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${attention.length ? "bg-amber-50" : "bg-green-50"}`}>
        <div className="flex min-w-0 items-center gap-2">
          {attention.length ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-900">{attention.length ? `Needs attention: ${attention.length} item${attention.length === 1 ? "" : "s"}` : "Nothing needs attention"}</h2>
            <p className="text-xs text-ink-600">{attention.length ? `Less than ${formatNumber(limit)} left, or out of stock.` : `Every counted item has ${formatNumber(limit)} or more.`}</p>
          </div>
        </div>
        {canManage && (
          <form
            className="flex items-center gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void saveLimit();
            }}
          >
            <label htmlFor="low-limit" className="text-xs text-ink-600">Alert when under</label>
            <input id="low-limit" className="input w-20 py-1 text-center" inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))} />
            <Button size="sm" type="submit" disabled={draft === String(limit) || draft === ""}>Set</Button>
          </form>
        )}
      </div>

      {attention.length > 0 && (
        <ul className="divide-y divide-ink-100 text-sm">
          {shown.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-ink-50">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <b className={`tabular-nums ${s.flag === "low" ? "text-amber-700" : "text-red-700"}`}>{formatNumber(s.on_hand)}</b>
                <Badge tone={s.flag === "low" ? "amber" : "red"}>{label(s)}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* last: what to do about it */}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-4 py-3">
        {attention.length > limitRows && (
          <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${attention.length}`}
          </Button>
        )}
        <Link href="/stock?flag=attention" className="btn btn-sm">See in stock list</Link>
        {canManage && (
          <Button size="sm" variant="primary" className="sm:ml-auto" onClick={() => setExcel(true)}>
            <FileSpreadsheet className="h-4 w-4" /> Update stock from Excel
          </Button>
        )}
      </div>

      {openRow && <StockItemModal item={openRow} onClose={() => setOpen(null)} />}
      {excel && <StockExcelModal stock={rows} onClose={() => setExcel(false)} />}
    </section>
  );
}
