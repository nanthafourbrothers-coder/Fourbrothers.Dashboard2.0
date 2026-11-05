"use client";

// The product popup: opening, in, out and on hand for any period and location, charts,
// the history of every customer / party for this product, and what else sold in the same place.

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FilterX } from "lucide-react";
import { db, useTable } from "@/lib/data/store";
import { useAuth } from "@/lib/auth";
import { useStockSince } from "@/lib/data/useStock";
import { analyseProduct, filterOptions, hasAnyFilter, hasSalesFilter, NO_FILTERS, otherProductsAt, resolvePeriod, type Filters, type PeriodState } from "@/lib/analysis";
import { exportTable } from "@/lib/export";
import { explainProduct, productFlow } from "@/lib/overview";
import { formatDateDisplay, formatNumber, todayYmd } from "@/lib/parse/normalize";
import type { StockRow } from "@/lib/stock";
import type { Movement } from "@/lib/types";
import { Badge, Button, Field, Modal, Popover, useUi } from "./ui";
import { Donut, HBars, InOutChart } from "./charts";
import { MeaningCard, SoldLeftBar, StockEquation, SupplyFlow } from "./ProductDiagrams";
import { PeriodPicker } from "./PeriodPicker";

type Tab = "overview" | "parties" | "places" | "lines" | "count";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "parties", label: "Customers / parties" },
  { id: "places", label: "Locations" },
  { id: "lines", label: "All lines" },
  { id: "count", label: "Count and names" },
];

export function StockItemModal({ item, onClose, onOpenProduct }: { item: StockRow; onClose: () => void; onOpenProduct?: (productId: string) => void }) {
  const { toast } = useUi();
  const auth = useAuth();
  const allMovements = useTable("stock_movements").rows;
  const products = useTable("products").rows;
  const aliases = useTable("product_aliases").rows;
  const since = useStockSince();

  const [tab, setTab] = useState<Tab>("overview");
  const [periodState, setPeriodState] = useState<PeriodState>({ id: "all", from: "", to: todayYmd() });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // on a phone the filters start folded so the numbers and charts are on the first screen
  const [showFilters, setShowFilters] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches);
  const [partySearch, setPartySearch] = useState("");
  const [openParty, setOpenParty] = useState<string | null>(null);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = useMemo(() => allMovements.filter((m) => m.product_id === item.id), [allMovements, item.id]);
  const period = useMemo(() => resolvePeriod(periodState), [periodState]);
  const options = useMemo(() => filterOptions(mine), [mine]);
  const a = useMemo(() => analyseProduct(item, mine, { period, filters, since }), [item, mine, period, filters, since]);
  const salesOn = hasSalesFilter(filters);
  const names = aliases.filter((x) => x.product_id === item.id);
  const nameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const others = useMemo(
    () => (salesOn ? otherProductsAt(allMovements, item.id, filters, period, (m) => (m.product_id ? (nameById.get(m.product_id) ?? m.raw_name) : m.raw_name), since) : []),
    [salesOn, allMovements, item.id, filters, period, nameById, since],
  );

  const set = (k: keyof Filters, values: string[]) => setFilters((f) => ({ ...f, [k]: values }));
  const toggle = (k: keyof Filters) => (value: string) => setFilters((f) => ({ ...f, [k]: f[k].includes(value) ? f[k].filter((x) => x !== value) : [...f[k], value] }));

  const partiesShown = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    return q ? a.parties.filter((p) => `${p.party} ${p.city} ${p.state}`.toLowerCase().includes(q)) : a.parties;
  }, [a.parties, partySearch]);

  const exportLines = async (format: "csv" | "xlsx") => {
    try {
      await exportTable(format, {
        filename: `${item.name}-${period.id === "all" ? "all-time" : `${period.from ?? ""}_${period.to ?? ""}`}`,
        title: item.name,
        columns: [
          { key: "date", label: "Date", type: "date" },
          { key: "type", label: "Type", type: "text" },
          { key: "qty", label: "Qty", type: "number" },
          { key: "party", label: "Party", type: "text" },
          { key: "voucher_no", label: "Voucher no", type: "text" },
          { key: "voucher_type", label: "Voucher type", type: "text" },
          { key: "city", label: "City", type: "text" },
          { key: "state", label: "State", type: "text" },
          { key: "channel", label: "Channel", type: "text" },
          { key: "raw_name", label: "Name in file", type: "text" },
        ],
        rows: a.lines as unknown as Record<string, unknown>[],
      });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Export failed.");
    }
  };

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

  const meaning = useMemo(() => explainProduct(item, a, period.label), [item, a, period.label]);
  const flow = useMemo(() => productFlow(a, { salesFiltered: salesOn }), [a, salesOn]);
  const shareText = salesOn && a.periodOut ? `${((a.lines.filter((m) => m.type === "OUT").reduce((s, m) => s + Number(m.qty), 0) / a.periodOut) * 100).toFixed(0)}% of all sales in this period` : "";
  const selectedOut = a.lines.filter((m) => m.type === "OUT").reduce((s, m) => s + (Number(m.qty) || 0), 0);

  return (
    <Modal title={item.name} onClose={onClose} size="xl" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
          {item.sku && <Badge>SKU {item.sku}</Badge>}
          {item.category && <Badge>{item.category}</Badge>}
          {item.location && <Badge>{item.location}</Badge>}
          {item.shopify_qty != null && <Badge tone={item.variance ? "amber" : "green"}>Shopify {formatNumber(item.shopify_qty)}{item.variance ? ` (app is ${item.variance > 0 ? "+" : ""}${formatNumber(item.variance)})` : ""}</Badge>}
          {a.firstDate && <span className="text-xs text-ink-500">Lines from {formatDateDisplay(a.firstDate)} to {formatDateDisplay(a.lastDate)}</span>}
        </div>

        {/* period and filters */}
        <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium sm:hidden" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
            <span>Period and filters: {period.label}{hasAnyFilter(filters) ? " (filtered)" : ""}</span>
            <span className="text-xs text-brand-700">{showFilters ? "Hide" : "Change"}</span>
          </button>
          <div className={`${showFilters ? "mt-3 flex sm:mt-0" : "hidden sm:flex"} flex-wrap items-end gap-3`}>
            <PeriodPicker value={periodState} onChange={setPeriodState} />
            <MultiPick label="State" options={options.states} value={filters.states} onChange={(v) => set("states", v)} />
            <MultiPick label="City" options={options.cities} value={filters.cities} onChange={(v) => set("cities", v)} />
            <MultiPick label="Channel" options={options.channels} value={filters.channels} onChange={(v) => set("channels", v)} />
            <MultiPick label="Customer / party" options={options.parties} value={filters.parties} onChange={(v) => set("parties", v)} />
            {options.godowns.length > 0 && <MultiPick label="Godown" options={options.godowns} value={filters.godowns} onChange={(v) => set("godowns", v)} />}
            {hasAnyFilter(filters) && (
              <Button size="sm" onClick={() => setFilters(NO_FILTERS)}>
                <FilterX className="h-3.5 w-3.5" /> Clear filters
              </Button>
            )}
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" onClick={() => exportLines("csv")}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button size="sm" onClick={() => exportLines("xlsx")}>
                <Download className="h-3.5 w-3.5" /> Excel
              </Button>
            </div>
          </div>
          <p className="mt-2 hidden text-xs text-ink-500 sm:block">Showing {period.label}.</p>
        </div>

        <StockEquation kpis={a.kpis} />
        {salesOn && (
          <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
            Looking only at the sales you filtered: <b>{formatNumber(selectedOut)}</b> sold{shareText ? ` (${shareText})` : ""}. Opening, in and on hand above are for the whole item, because stock is held in the godown, not in a customer&apos;s city.
          </p>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-ink-200">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-ink-600 hover:text-ink-900"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="space-y-6">
            <MeaningCard meaning={meaning} />

            <Block title="How much is sold, how much is left" hint="Everything that was available in this view, split into sold and left.">
              <SoldLeftBar kpis={a.kpis} />
            </Block>

            <Block title="Where it came from and where it went" hint={salesOn ? "Sales are narrowed by your filters. The rest of the sales shows as other places." : "Left side: what filled the stock. Right side: where it was sold and what is left. Thicker lines mean more pieces."}>
              <SupplyFlow flow={flow} name={item.name} />
            </Block>

            <Block title={`Stock in, out and on hand ${a.grain === "day" ? "per day" : a.grain === "week" ? "per week" : "per month"}`} hint="Green and red bars are pieces bought and sold. The blue line is the stock left after each date.">
              <InOutChart data={a.series} />
            </Block>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Block title="Sold by state" hint="Click a name to filter this item to that state.">
                <Donut rows={a.byState} centerBottom="sold" onPick={toggle("states")} picked={filters.states} empty="No sales in this selection." />
              </Block>
              <Block title="Sold by channel" hint="Click a name to filter.">
                <Donut rows={a.byChannel} centerBottom="sold" onPick={toggle("channels")} picked={filters.channels} empty="No sales in this selection." />
              </Block>
              <Block title="Top customers" hint="Click a name to filter.">
                <HBars rows={a.parties.slice(0, 8).map((p) => ({ label: p.party, qty: p.qty, sub: `${p.invoices} invoice${p.invoices === 1 ? "" : "s"}${p.city ? ` | ${p.city}` : ""}` }))} onPick={toggle("parties")} picked={filters.parties} empty="No sales in this selection." />
              </Block>
            </div>
          </div>
        )}

        {tab === "parties" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input className="input max-w-xs" placeholder="Search customer, city or state" value={partySearch} onChange={(e) => setPartySearch(e.target.value)} aria-label="Search customers" />
              <span className="text-sm text-ink-500">
                {formatNumber(partiesShown.length)} customer{partiesShown.length === 1 ? "" : "s"} bought this item. Click a row to see every invoice.
              </span>
            </div>
            <div className="scroll-thin max-h-[26rem] overflow-auto rounded-lg border border-ink-200">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="th w-8" />
                    <th className="th">Customer / party</th>
                    <th className="th">City</th>
                    <th className="th">State</th>
                    <th className="th text-right">Qty bought</th>
                    <th className="th text-right">Invoices</th>
                    <th className="th">First</th>
                    <th className="th">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {partiesShown.map((p) => {
                    const open = openParty === p.party;
                    return (
                      <Fragment key={p.party}>
                        <tr className="cursor-pointer hover:bg-ink-50" onClick={() => setOpenParty(open ? null : p.party)}>
                          <td className="td">{open ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}</td>
                          <td className="td font-medium">{p.party}</td>
                          <td className="td">{p.city}</td>
                          <td className="td">{p.state}</td>
                          <td className="td text-right font-semibold tabular-nums">{formatNumber(p.qty)}</td>
                          <td className="td text-right tabular-nums">{p.invoices}</td>
                          <td className="td whitespace-nowrap">{formatDateDisplay(p.first)}</td>
                          <td className="td whitespace-nowrap">{formatDateDisplay(p.last)}</td>
                        </tr>
                        {open && (
                          <tr>
                            <td />
                            <td colSpan={7} className="border-b border-ink-100 bg-ink-50/60 px-3 py-2">
                              <table className="w-full max-w-lg text-sm">
                                <tbody>
                                  {p.history.map((h) => (
                                    <tr key={h.id}>
                                      <td className="py-0.5 pr-4 whitespace-nowrap">{formatDateDisplay(h.date)}</td>
                                      <td className="py-0.5 pr-4 text-ink-600">{[h.voucher_type, h.voucher_no].filter(Boolean).join(" ")}</td>
                                      <td className="py-0.5 text-right tabular-nums">{formatNumber(h.qty)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!partiesShown.length && (
                    <tr>
                      <td colSpan={8} className="td py-8 text-center text-ink-500">
                        No sales to show for this selection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {a.suppliers.length > 0 && (
              <Block title="Bought from (suppliers)">
                <HBars rows={a.suppliers.slice(0, 8).map((p) => ({ label: p.party, qty: p.qty, sub: `${p.invoices} bill${p.invoices === 1 ? "" : "s"}` }))} />
              </Block>
            )}
          </div>
        )}

        {tab === "places" && (
          <div className="space-y-5">
            <p className="text-sm text-ink-600">Click any bar to filter this item to that place. The list at the bottom then shows what else was sold there.</p>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <Block title="By state">
                <HBars rows={a.byState} onPick={toggle("states")} picked={filters.states} empty="No sales in this selection." />
              </Block>
              <Block title="By city">
                <HBars rows={a.byCity} onPick={toggle("cities")} picked={filters.cities} empty="No sales in this selection." />
              </Block>
              <Block title="By channel">
                <HBars rows={a.byChannel} onPick={toggle("channels")} picked={filters.channels} empty="No sales in this selection." />
              </Block>
            </div>
            <Block title="Other products sold in the same place">
              {!salesOn ? (
                <p className="py-4 text-sm text-ink-500">Choose a state, city, channel or customer above (or click a bar) to see what else sold there.</p>
              ) : !others.length ? (
                <p className="py-4 text-sm text-ink-500">No other product was sold there in this period.</p>
              ) : (
                <div className="scroll-thin max-h-72 overflow-auto rounded-lg border border-ink-200">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0">
                      <tr>
                        <th className="th">Product</th>
                        <th className="th text-right">Qty out</th>
                        <th className="th text-right">Invoices</th>
                        <th className="th text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {others.slice(0, 100).map((o) => (
                        <tr key={o.productId ?? o.name} className={onOpenProduct && o.productId ? "cursor-pointer hover:bg-ink-50" : ""} onClick={() => o.productId && onOpenProduct?.(o.productId)}>
                          <td className="td">{o.name}</td>
                          <td className="td text-right tabular-nums">{formatNumber(o.qty)}</td>
                          <td className="td text-right tabular-nums">{o.invoices}</td>
                          <td className="td text-right tabular-nums text-ink-500">{o.share.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Block>
          </div>
        )}

        {tab === "lines" && (
          <div>
            <p className="mb-1 text-sm font-semibold">Stock lines ({formatNumber(a.lines.length)})</p>
            <div className="scroll-thin max-h-[26rem] overflow-auto rounded-lg border border-ink-200">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0">
                  <tr>
                    <th className="th">Date</th>
                    <th className="th">Type</th>
                    <th className="th text-right">Qty</th>
                    <th className="th">Party</th>
                    <th className="th">City</th>
                    <th className="th">State</th>
                    <th className="th">Voucher</th>
                  </tr>
                </thead>
                <tbody>
                  {a.lines.slice(0, 500).map((m) => (
                    <tr key={m.id}>
                      <td className="td whitespace-nowrap">{formatDateDisplay(m.date)}</td>
                      <td className="td">
                        <Badge tone={m.type === "IN" ? "green" : m.type === "OUT" ? "red" : "amber"}>{m.type}</Badge>
                      </td>
                      <td className="td text-right tabular-nums">{formatNumber(m.qty)}</td>
                      <td className="td max-w-[220px] truncate">{m.party}</td>
                      <td className="td">{m.city}</td>
                      <td className="td">{m.state}</td>
                      <td className="td">{m.voucher_no}</td>
                    </tr>
                  ))}
                  {!a.lines.length && (
                    <tr>
                      <td colSpan={7} className="td py-6 text-center text-ink-500">
                        No lines for this selection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {a.lines.length > 500 && <p className="mt-1 text-xs text-ink-500">Showing the latest 500. Use CSV or Excel above for all {formatNumber(a.lines.length)}.</p>}
          </div>
        )}

        {tab === "count" && (
          <div className="space-y-5">
            {auth.can("write") ? (
              <div className="rounded-lg border border-ink-200 p-3">
                <p className="mb-2 text-sm font-semibold">Physical count</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
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
                <p className="mt-1 text-xs text-ink-500">This adds an adjustment line, so the history stays complete. Imported lines are never changed.</p>
              </div>
            ) : (
              <p className="text-sm text-ink-500">You have view only access, so counts cannot be entered.</p>
            )}
            <div>
              <p className="mb-1 text-sm font-semibold">Names from files linked to this item</p>
              {names.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {names.map((n) => (
                    <Badge key={n.id}>{n.alias}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-500">No other names linked yet. Link the purchase book name and the Tally name of this item in Name matching, and later uploads join up on their own.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {hint && <p className="mb-2 text-xs text-ink-500">{hint}</p>}
      {!hint && <div className="mb-1.5" />}
      {children}
    </section>
  );
}

function MultiPick({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div>
      <span className="label">{label}</span>
      <Popover
        width={260}
        trigger={(open, toggle) => (
          <button type="button" onClick={toggle} className={`input flex w-40 items-center justify-between gap-2 text-left ${open ? "ring-2 ring-brand-200" : ""}`} aria-label={`${label} filter`}>
            <span className="truncate">{value.length === 0 ? "All" : value.length === 1 ? value[0] : `${value.length} chosen`}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
          </button>
        )}
      >
        {() => (
          <div>
            {options.length > 8 && <input className="input mb-1.5" placeholder={`Find ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
            <div className="max-h-60 overflow-y-auto">
              {shown.map((o) => (
                <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-ink-50">
                  <input type="checkbox" checked={value.includes(o)} onChange={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])} />
                  <span className="truncate">{o}</span>
                </label>
              ))}
              {!shown.length && <p className="px-2 py-3 text-center text-xs text-ink-500">{options.length ? "No match." : "Nothing recorded for this item yet."}</p>}
            </div>
            {value.length > 0 && (
              <button type="button" className="mt-1.5 w-full rounded px-2 py-1 text-left text-xs text-brand-700 hover:bg-ink-50" onClick={() => onChange([])}>
                Clear {label.toLowerCase()}
              </button>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}
