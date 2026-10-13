"use client";

// Name matching: the same product is written differently in Tally, the purchase book and Shopify.
// This screen links every unlinked name to one stock item, once. After that every import links itself.

import { useMemo, useState } from "react";
import { Ban, Link2, Plus, Sparkles, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db, useTable } from "@/lib/data/store";
import { Suggester, isConfident, type Suggestion } from "@/lib/match";
import { unmappedNames, type UnmappedName } from "@/lib/stock";
import { aliasKey, formatNumber, stripNameNoise, formatDateDisplay } from "@/lib/parse/normalize";
import type { Product, ProductAlias } from "@/lib/types";
import { Badge, Button, EmptyState, PageHeader, Spinner, useDebounced, useUi } from "@/components/ui";

type Tab = "todo" | "linked" | "ignored";
interface Link {
  key: string;
  name: string;
  productId: string | null; // null = ignore
}

export default function MappingPage() {
  const auth = useAuth();
  const { toast, confirm } = useUi();
  const movements = useTable("stock_movements");
  const products = useTable("products");
  const aliases = useTable("product_aliases");
  const [tab, setTab] = useState<Tab>("todo");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 150).trim().toLowerCase();
  const [limit, setLimit] = useState(40);
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = auth.can("manage");

  const active = useMemo(() => products.rows.filter((p) => p.status === "active"), [products.rows]);
  const byId = useMemo(() => new Map(products.rows.map((p) => [p.id, p])), [products.rows]);
  const byName = useMemo(() => new Map(active.map((p) => [p.name.trim().toLowerCase(), p])), [active]);
  const suggester = useMemo(() => new Suggester(active), [active]);
  const unmapped = useMemo(() => unmappedNames(movements.rows, aliases.rows), [movements.rows, aliases.rows]);
  const suggestions = useMemo(() => new Map(unmapped.map((u) => [u.key, suggester.suggest(u.names[0], 3)])), [unmapped, suggester]);
  const confident = useMemo(() => unmapped.filter((u) => isConfident(suggestions.get(u.key) ?? [])), [unmapped, suggestions]);

  const shown = useMemo(() => (q ? unmapped.filter((u) => u.names.some((n) => n.toLowerCase().includes(q))) : unmapped), [unmapped, q]);
  const linkedAliases = aliases.rows.filter((a) => a.product_id != null && (!q || a.alias.toLowerCase().includes(q) || byId.get(a.product_id!)?.name.toLowerCase().includes(q)));
  const ignoredAliases = aliases.rows.filter((a) => a.product_id == null && (!q || a.alias.toLowerCase().includes(q)));

  /** Saves the names as aliases and points every matching unlinked stock line at the item. */
  async function applyLinks(links: Link[]) {
    if (!links.length) return;
    await db.upsert(
      "product_aliases",
      links.map((l) => ({ alias: l.name, alias_key: l.key, product_id: l.productId })),
      "alias_key",
    );
    const byKey = new Map(links.map((l) => [l.key, l.productId]));
    const groups = new Map<string, string[]>();
    for (const m of movements.rows) {
      if (m.product_id) continue;
      const pid = byKey.get(aliasKey(m.raw_name));
      if (pid) {
        const list = groups.get(pid) ?? [];
        list.push(m.id);
        groups.set(pid, list);
      }
    }
    for (const [pid, ids] of groups) await db.updateMany("stock_movements", ids, { product_id: pid });
  }

  async function guarded(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const link = (u: UnmappedName, p: Product) =>
    guarded(u.key, async () => {
      await applyLinks([{ key: u.key, name: u.names[0], productId: p.id }]);
      toast("success", `Linked to ${p.name}.`);
    });

  const ignore = (u: UnmappedName) =>
    guarded(u.key, async () => {
      await applyLinks([{ key: u.key, name: u.names[0], productId: null }]);
      toast("info", "Ignored. It will not be asked about again.");
    });

  async function createItems(list: UnmappedName[]): Promise<number> {
    const rows = list.map((u) => ({
      name: stripNameNoise(u.names.slice().sort((a, b) => a.length - b.length)[0]),
      ext_key: `manual::${u.key.toLowerCase()}`,
      sku: null,
      opening_qty: 0,
      reorder_level: 0,
    }));
    const saved = await db.upsert("products", rows, "ext_key");
    const idByExt = new Map(saved.map((p) => [p.ext_key, p.id]));
    const links: Link[] = [];
    for (const u of list) {
      const id = idByExt.get(`manual::${u.key.toLowerCase()}`);
      if (id) links.push({ key: u.key, name: u.names[0], productId: id });
    }
    await applyLinks(links);
    return links.length;
  }

  const createOne = (u: UnmappedName) =>
    guarded(u.key, async () => {
      const n = await createItems([u]);
      if (n) toast("success", "New stock item created and linked.");
    });

  const acceptConfident = async () => {
    if (!(await confirm(`Link ${confident.length} name(s) to the item the app is sure about (a clear best match with the same sizes and numbers)?\n\nYou can undo any of them later from the Linked names tab.`, { confirmLabel: "Link them" }))) return;
    await guarded("bulk", async () => {
      const links: Link[] = confident.map((u) => ({ key: u.key, name: u.names[0], productId: suggestions.get(u.key)![0].product.id }));
      await applyLinks(links);
      await db.audit("link names", "product_aliases", `${links.length} names linked by confident match`);
      toast("success", `${links.length} names linked.`);
    });
  };

  const createAll = async () => {
    if (!(await confirm(`Create ${unmapped.length} new stock items, one for each name that is still unlinked?\n\nOnly do this if these really are products you stock. Names that are not products (freight, discount, rounding) should be ignored instead.`, { confirmLabel: "Create items" }))) return;
    await guarded("bulk", async () => {
      const n = await createItems(unmapped);
      await db.audit("create items", "products", `${n} items created from unlinked names`);
      toast("success", `${n} stock items created and linked.`);
    });
  };

  const unlink = (a: ProductAlias) =>
    guarded(a.id, async () => {
      const ids = movements.rows.filter((m) => m.product_id === a.product_id && aliasKey(m.raw_name) === a.alias_key && aliasKey(m.raw_name) !== aliasKey(byId.get(a.product_id ?? "")?.name ?? "")).map((m) => m.id);
      await db.remove("product_aliases", [a.id]);
      if (ids.length) await db.updateMany("stock_movements", ids, { product_id: null });
      toast("info", ids.length ? `Unlinked. ${ids.length} stock line(s) are waiting to be matched again.` : "Removed.");
    });

  const loading = !movements.loaded || !products.loaded || !aliases.loaded;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Name matching"
        subtitle="Tally, the purchase book and Shopify spell the same product differently. Link each name to one stock item here, once. Every later import then links itself."
      />

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <TabBtn on={tab === "todo"} onClick={() => setTab("todo")}>
              To match ({unmapped.length})
            </TabBtn>
            <TabBtn on={tab === "linked"} onClick={() => setTab("linked")}>
              Linked names ({aliases.rows.filter((a) => a.product_id).length})
            </TabBtn>
            <TabBtn on={tab === "ignored"} onClick={() => setTab("ignored")}>
              Ignored ({aliases.rows.filter((a) => !a.product_id).length})
            </TabBtn>
            <input className="input ml-auto max-w-xs" placeholder="Search names" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search names" />
          </div>

          {tab === "todo" && (
            <>
              {canManage && unmapped.length > 0 && (
                <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
                  <Sparkles className="h-4 w-4 text-brand-600" />
                  <span className="text-ink-700">
                    {confident.length > 0 ? `${confident.length} of ${unmapped.length} names have one clear match.` : "No name has a single clear match yet."}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button disabled={!confident.length} busy={busy === "bulk"} onClick={acceptConfident}>
                      Link {confident.length} clear matches
                    </Button>
                    <Button busy={busy === "bulk"} onClick={createAll}>
                      Create an item for each of the {unmapped.length}
                    </Button>
                  </div>
                </div>
              )}
              {!canManage && unmapped.length > 0 && <p className="text-sm text-ink-500">You can look at this list. A manager or admin links the names.</p>}
              <div className="card divide-y divide-ink-100">
                {shown.length === 0 ? (
                  <EmptyState
                    title={unmapped.length ? "No names match your search" : "Every name is linked"}
                    text={unmapped.length ? undefined : "New names from future imports will show up here when they cannot be matched."}
                  />
                ) : (
                  shown.slice(0, limit).map((u) => (
                    <TodoRow key={u.key} u={u} sugg={suggestions.get(u.key) ?? []} canManage={canManage} busy={busy === u.key || busy === "bulk"} byName={byName} names={active.map((p) => p.name)} onLink={link} onIgnore={ignore} onCreate={createOne} />
                  ))
                )}
              </div>
              {shown.length > limit && (
                <div className="text-center">
                  <Button onClick={() => setLimit(limit + 60)}>Show more ({shown.length - limit} left)</Button>
                </div>
              )}
            </>
          )}

          {tab === "linked" && (
            <AliasTable rows={linkedAliases} byId={byId} canManage={canManage} onUndo={unlink} empty="No names have been linked by hand yet." label="Unlink" />
          )}
          {tab === "ignored" && (
            <AliasTable
              rows={ignoredAliases}
              byId={byId}
              canManage={canManage}
              onUndo={(a) =>
                guarded(a.id, async () => {
                  await db.remove("product_aliases", [a.id]);
                  toast("info", "This name will be asked about again if it is still in your stock lines.");
                })
              }
              empty="Nothing is ignored. Use Ignore for lines that are not products, like freight or rounding."
              label="Stop ignoring"
            />
          )}
        </>
      )}
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
      {children}
    </button>
  );
}

function TodoRow({ u, sugg, canManage, busy, byName, names, onLink, onIgnore, onCreate }: { u: UnmappedName; sugg: Suggestion[]; canManage: boolean; busy: boolean; byName: Map<string, Product>; names: string[]; onLink: (u: UnmappedName, p: Product) => void; onIgnore: (u: UnmappedName) => void; onCreate: (u: UnmappedName) => void }) {
  const [pick, setPick] = useState("");
  const listId = `names-${u.key.replace(/[^A-Z0-9]/gi, "")}`;
  const chosen = byName.get(pick.trim().toLowerCase());
  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)]">
      <div className="min-w-0">
        <p className="break-words font-medium text-ink-900">{u.names[0]}</p>
        {u.names.length > 1 && <p className="mt-0.5 text-xs text-ink-500">Also written as: {u.names.slice(1, 4).join(" | ")}{u.names.length > 4 ? " ..." : ""}</p>}
        <p className="mt-1 text-xs text-ink-500">
          {u.lines} line{u.lines > 1 ? "s" : ""}
          {u.qtyOut ? ` | out ${formatNumber(u.qtyOut)}` : ""}
          {u.qtyIn ? ` | in ${formatNumber(u.qtyIn)}` : ""} | {formatDateDisplay(u.first)} to {formatDateDisplay(u.last)}
        </p>
      </div>
      <div className="space-y-2">
        {sugg.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {sugg.map((s) => (
              <button
                key={s.product.id}
                disabled={!canManage || busy}
                onClick={() => onLink(u, s.product)}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-left text-xs hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
                title={`Link to ${s.product.name}`}
              >
                <Link2 className="h-3 w-3 shrink-0 text-brand-600" />
                <span className="truncate">{s.product.name}</span>
                <Badge tone={s.score >= 0.85 ? "green" : s.score >= 0.6 ? "amber" : "gray"}>{Math.round(s.score * 100)}%</Badge>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-500">No similar stock item found.</p>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <datalist id={listId}>
              {names.slice(0, 3000).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <input className="input max-w-[16rem] flex-1" list={listId} placeholder="Or type a stock item" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Stock item for ${u.names[0]}`} />
            <Button size="sm" disabled={!chosen || busy} onClick={() => chosen && onLink(u, chosen)}>
              Link
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onCreate(u)}>
              <Plus className="h-3.5 w-3.5" /> New item
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onIgnore(u)} title="Not a product (freight, discount, rounding)">
              <Ban className="h-3.5 w-3.5" /> Ignore
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AliasTable({ rows, byId, canManage, onUndo, empty, label }: { rows: ProductAlias[]; byId: Map<string, Product>; canManage: boolean; onUndo: (a: ProductAlias) => void; empty: string; label: string }) {
  const [limit, setLimit] = useState(100);
  return (
    <div className="card overflow-hidden">
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="th">Name in the files</th>
              <th className="th">Stock item</th>
              <th className="th w-28" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((a) => (
              <tr key={a.id}>
                <td className="td">{a.alias}</td>
                <td className="td">{a.product_id ? (byId.get(a.product_id)?.name ?? <span className="text-ink-400">(removed item)</span>) : <Badge>Not a product</Badge>}</td>
                <td className="td text-right">
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => onUndo(a)}>
                      <Undo2 className="h-3.5 w-3.5" /> {label}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > limit && (
        <div className="border-t border-ink-100 p-2 text-center">
          <Button size="sm" onClick={() => setLimit(limit + 200)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
