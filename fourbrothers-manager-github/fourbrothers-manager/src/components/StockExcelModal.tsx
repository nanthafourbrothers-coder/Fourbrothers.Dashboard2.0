"use client";

// Update stock levels from an Excel / CSV sheet that lists product name (or SKU) and quantity.
//   "Counted today"  adds a stock count adjustment per item, so history is kept and the item shows that quantity now.
//   "Opening stock"  sets the opening figure of each item (the count the in/out lines are added to).
// Items are found by name, SKU or a name linked earlier in Name matching. Nothing is saved until the preview is confirmed.

import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { db, useTable } from "@/lib/data/store";
import { useAuth } from "@/lib/auth";
import { guessMapping, applyMapping, STOCK_ITEM_FIELDS, type Mapping } from "@/lib/importPlan";
import { NameResolver, type StockRow } from "@/lib/stock";
import { Suggester } from "@/lib/match";
import { buildGenericTable, type ParsedTable } from "@/lib/parse/table";
import { readAnyFile } from "@/lib/parse/rawFile";
import { aliasKey, cleanText, formatNumber, parseNumberLoose, stripNameNoise, todayYmd } from "@/lib/parse/normalize";
import type { Movement, Product } from "@/lib/types";
import { Badge, Button, Field, Modal, useUi } from "./ui";

type Mode = "count" | "opening";
type Choice = "skip" | "new" | string; // string = product id

interface Line {
  index: number;
  name: string;
  sku: string;
  qty: number | null;
  productId: string | null; // matched automatically
  suggestions: { id: string; name: string }[];
}

const FIELDS = STOCK_ITEM_FIELDS.filter((f) => ["name", "sku", "qty"].includes(f.key));

export function StockExcelModal({ stock, onClose }: { stock: StockRow[]; onClose: () => void }) {
  const { toast } = useUi();
  const auth = useAuth();
  const products = useTable("products").rows;
  const aliases = useTable("product_aliases").rows;
  const fileInput = useRef<HTMLInputElement>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [mode, setMode] = useState<Mode>("count");
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resolver = useMemo(() => new NameResolver(products, aliases), [products, aliases]);
  const suggester = useMemo(() => new Suggester(products.filter((p) => p.status === "active")), [products]);
  const onHand = useMemo(() => new Map(stock.map((s) => [s.id, s.on_hand])), [stock]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const lines: Line[] = useMemo(() => {
    if (!table) return [];
    const rows = applyMapping(table, mapping, FIELDS);
    const out: Line[] = [];
    rows.forEach((r, index) => {
      const name = cleanText(r.name);
      const sku = cleanText(r.sku);
      if (!name && !sku) return;
      const qtyRaw = r.qty;
      const qty = typeof qtyRaw === "number" ? qtyRaw : parseNumberLoose(qtyRaw, true);
      const hit = (sku ? resolver.resolve(sku) : undefined) ?? (name ? resolver.resolve(name) : undefined);
      const productId = typeof hit === "string" ? hit : null;
      out.push({
        index,
        name: name || sku,
        sku,
        qty,
        productId,
        suggestions: productId || !name ? [] : suggester.suggest(name, 3).map((s) => ({ id: s.product.id, name: s.product.name })),
      });
    });
    return out;
  }, [table, mapping, resolver, suggester]);

  const choiceOf = (l: Line): Choice => (l.productId ? l.productId : (choices[l.index] ?? "skip"));
  const valid = lines.filter((l) => l.qty != null && l.qty >= 0);
  const matched = valid.filter((l) => choiceOf(l) !== "skip" && choiceOf(l) !== "new");
  const toCreate = valid.filter((l) => choiceOf(l) === "new");
  const skipped = lines.length - matched.length - toCreate.length;

  async function pick(file: File) {
    setError("");
    try {
      const res = await readAnyFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!res.sheets.length) throw new Error(res.errors[0] ?? "No sheet could be read from this file.");
      const t = buildGenericTable(res.sheets[0]);
      if (!t.rows.length) throw new Error("The sheet has no rows.");
      setTable(t);
      setFileName(file.name);
      setMapping(guessMapping(t.columns, FIELDS));
      setChoices({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    }
  }

  async function apply() {
    if (!matched.length && !toCreate.length) return toast("error", "Nothing to update. Match at least one row to a stock item.");
    if (mode === "opening" && !auth.can("manage")) return toast("error", "Only managers and admins can change opening stock.");
    setBusy(true);
    try {
      const [batch] = await db.insert("import_batches", [{ filename: fileName, kind: "stock_update", destination: "movements", row_count: lines.length, inserted: 0, skipped: 0 }]);
      // new items first, so they can be counted too
      const created = new Map<number, Product>();
      if (toCreate.length) {
        const saved = await db.upsert(
          "products",
          toCreate.map((l) => ({ name: stripNameNoise(l.name), sku: l.sku || null, ext_key: l.sku || `manual::${aliasKey(l.name).toLowerCase()}`, opening_qty: mode === "opening" ? (l.qty ?? 0) : 0, reorder_level: 0 })),
          "ext_key",
        );
        toCreate.forEach((l) => {
          const p = saved.find((s) => s.ext_key === (l.sku || `manual::${aliasKey(l.name).toLowerCase()}`));
          if (p) created.set(l.index, p);
        });
      }
      const today = todayYmd();
      let changed = 0;
      const adjustments: Partial<Movement>[] = [];
      const aliasRows: { alias: string; alias_key: string; product_id: string }[] = [];
      for (const l of matched) {
        const p = byId.get(choiceOf(l))!;
        if (!l.productId && auth.can("manage")) aliasRows.push({ alias: l.name, alias_key: aliasKey(l.name), product_id: p.id });
        if (mode === "opening") {
          if (Number(p.opening_qty) !== l.qty) {
            await db.update("products", p.id, { opening_qty: l.qty! });
            changed++;
          }
        } else {
          const diff = l.qty! - (onHand.get(p.id) ?? 0);
          if (diff !== 0) {
            adjustments.push({ date: today, type: "ADJUST", product_id: p.id, raw_name: p.name, qty: diff, source: "import", batch_id: batch.id, notes: `Stock update from ${fileName}` });
            changed++;
          }
        }
      }
      for (const l of toCreate) {
        const p = created.get(l.index);
        if (p && mode === "count" && l.qty) {
          adjustments.push({ date: today, type: "ADJUST", product_id: p.id, raw_name: p.name, qty: l.qty, source: "import", batch_id: batch.id, notes: `Stock update from ${fileName}` });
        }
        if (p) changed++;
      }
      if (adjustments.length) await db.insert("stock_movements", adjustments);
      if (aliasRows.length) await db.upsert("product_aliases", aliasRows, "alias_key");
      await db.update("import_batches", batch.id, { inserted: changed, skipped: lines.length - changed, summary: { mode, matched: matched.length, created: toCreate.length } });
      await db.audit("stock update from file", "products", `${fileName}: ${changed} item(s) changed (${mode === "count" ? "counted today" : "opening stock"})`, batch.id);
      toast("success", `${changed} item${changed === 1 ? "" : "s"} updated${aliasRows.length ? `, ${aliasRows.length} name${aliasRows.length === 1 ? "" : "s"} linked for next time` : ""}.`);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not update stock.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Update stock from Excel"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {table && (
            <Button variant="primary" busy={busy} onClick={apply}>
              Update {formatNumber(matched.length + toCreate.length)} item{matched.length + toCreate.length === 1 ? "" : "s"}
            </Button>
          )}
        </>
      }
    >
      {!table ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-600">
            Use a sheet with one row per product: the <b>product name</b> (or SKU) and the <b>quantity</b>. A title line above the headings is fine. Nothing is saved until you check the preview.
          </p>
          <button type="button" onClick={() => fileInput.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink-200 px-6 py-10 text-sm text-ink-600 hover:border-brand-300 hover:bg-brand-50/40">
            <FileSpreadsheet className="h-8 w-8 text-brand-600" />
            Choose an Excel or CSV file
          </button>
          <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.key === "qty" ? "Quantity column" : f.key === "name" ? "Product name column" : "SKU column (optional)"}>
                <select className="input" value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}>
                  <option value="">{f.key === "sku" ? "None" : "Choose…"}</option>
                  {table.columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className={`cursor-pointer rounded-lg border p-3 text-sm ${mode === "count" ? "border-brand-500 bg-brand-50" : "border-ink-200"}`}>
              <input type="radio" className="mr-2" checked={mode === "count"} onChange={() => setMode("count")} />
              <b>Counted today</b>
              <p className="mt-1 text-xs text-ink-600">Each item will show the quantity in the sheet as its stock now. A stock count line is added, so history is kept.</p>
            </label>
            <label className={`rounded-lg border p-3 text-sm ${auth.can("manage") ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${mode === "opening" ? "border-brand-500 bg-brand-50" : "border-ink-200"}`}>
              <input type="radio" className="mr-2" disabled={!auth.can("manage")} checked={mode === "opening"} onChange={() => setMode("opening")} />
              <b>Opening stock</b>
              <p className="mt-1 text-xs text-ink-600">Sets the starting quantity. Purchases and sales are then added to it. Managers and admins only.</p>
            </label>
          </div>

          <p className="text-sm text-ink-600">
            <b>{formatNumber(matched.length)}</b> matched, <b>{formatNumber(toCreate.length)}</b> to create, <b>{formatNumber(skipped)}</b> skipped, from {fileName}. Rows without a readable quantity are skipped.
          </p>

          <div className="scroll-thin max-h-[22rem] overflow-auto rounded-lg border border-ink-200">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">In your file</th>
                  <th className="th text-right">Qty</th>
                  <th className="th">Stock item</th>
                  <th className="th text-right">Now</th>
                  <th className="th text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {lines.slice(0, 400).map((l) => {
                  const c = choiceOf(l);
                  const p = c !== "skip" && c !== "new" ? byId.get(c) : undefined;
                  const current = p ? (mode === "opening" ? Number(p.opening_qty) : (onHand.get(p.id) ?? 0)) : null;
                  const delta = l.qty != null && current != null ? l.qty - current : null;
                  return (
                    <tr key={l.index} className={l.qty == null ? "opacity-50" : ""}>
                      <td className="td max-w-[260px] truncate" title={l.name}>
                        {l.name}
                        {l.sku && <span className="ml-1 text-xs text-ink-400">{l.sku}</span>}
                      </td>
                      <td className="td text-right tabular-nums">{l.qty == null ? <Badge tone="amber">no qty</Badge> : formatNumber(l.qty)}</td>
                      <td className="td">
                        {l.productId ? (
                          <span>{byId.get(l.productId)?.name}</span>
                        ) : (
                          <select className="input py-1" value={c} onChange={(e) => setChoices({ ...choices, [l.index]: e.target.value })} aria-label={`Match for ${l.name}`}>
                            <option value="skip">Skip this row</option>
                            {l.suggestions.map((s) => (
                              <option key={s.id} value={s.id}>
                                Link to: {s.name}
                              </option>
                            ))}
                            <option value="new">Create as a new item</option>
                          </select>
                        )}
                      </td>
                      <td className="td text-right tabular-nums text-ink-500">{current == null ? "" : formatNumber(current)}</td>
                      <td className={`td text-right tabular-nums ${delta ? (delta > 0 ? "text-green-700" : "text-red-600") : "text-ink-400"}`}>{delta == null ? "" : delta > 0 ? `+${formatNumber(delta)}` : formatNumber(delta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {lines.length > 400 && <p className="text-xs text-ink-500">Showing the first 400 of {formatNumber(lines.length)} rows. All rows are applied.</p>}
          <Button size="sm" onClick={() => { setTable(null); setError(""); }}>
            Choose another file
          </Button>
        </div>
      )}
    </Modal>
  );
}
