"use client";

// Search across everything at once: stock items, stock lines, shipments, files and every section.

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTable } from "@/lib/data/store";
import { formatDateDisplay, formatNumber } from "@/lib/parse/normalize";
import { Badge, EmptyState, PageHeader, Spinner } from "@/components/ui";

const LIMIT = 8;

export default function SearchPage() {
  const q = (useSearchParams().get("q") ?? "").trim();
  const products = useTable("products");
  const movements = useTable("stock_movements");
  const shipments = useTable("shipments");
  const files = useTable("shipment_files");
  const datasets = useTable("datasets");
  const dsRows = useTable("dataset_rows");
  const ready = products.loaded && movements.loaded && shipments.loaded && files.loaded && datasets.loaded && dsRows.loaded;

  const res = useMemo(() => {
    const t = q.toLowerCase();
    if (!t || !ready) return null;
    const has = (...v: (string | number | null | undefined)[]) => v.some((x) => x != null && String(x).toLowerCase().includes(t));
    const prod = products.rows.filter((p) => has(p.name, p.sku, p.category, p.vendor));
    const mov = movements.rows.filter((m) => has(m.raw_name, m.party, m.voucher_no, m.city, m.state, m.gstin, m.notes));
    const shp = shipments.rows.filter((s) => has(s.customer_name, s.phone, s.city, s.state, s.invoice_no, s.tracking_no, s.courier, s.address));
    const fil = files.rows.filter((f) => has(f.name));
    const dsById = new Map(datasets.rows.map((d) => [d.id, d]));
    const sections = new Map<string, { name: string; slug: string; hits: number }>();
    for (const r of dsRows.rows) {
      const hit = Object.values(r.data).some((v) => v != null && String(v).toLowerCase().includes(t));
      if (!hit) continue;
      const d = dsById.get(r.dataset_id);
      if (!d) continue;
      const e = sections.get(d.id) ?? { name: d.name, slug: d.slug, hits: 0 };
      e.hits++;
      sections.set(d.id, e);
    }
    return { prod, mov, shp, fil, sections: [...sections.values()].sort((a, b) => b.hits - a.hits) };
  }, [q, ready, products.rows, movements.rows, shipments.rows, files.rows, datasets.rows, dsRows.rows]);

  const enc = encodeURIComponent(q);
  const total = res ? res.prod.length + res.mov.length + res.shp.length + res.fil.length + res.sections.reduce((s, x) => s + x.hits, 0) : 0;

  return (
    <div className="space-y-4">
      <PageHeader title={q ? `Search: ${q}` : "Search"} subtitle="Looks through stock items, stock in and out, shipments, file names and every section." />
      {!q ? (
        <div className="card"><EmptyState title="Type in the box at the top" text="Search an item, invoice number, customer, phone number, city or file name." /></div>
      ) : !res ? (
        <Spinner />
      ) : total === 0 ? (
        <div className="card"><EmptyState title={`Nothing found for "${q}"`} text="Check the spelling, or try a shorter part of the word." /></div>
      ) : (
        <>
          {res.prod.length > 0 && (
            <Group title="Stock items" count={res.prod.length} href={`/stock?q=${enc}`}>
              {res.prod.slice(0, LIMIT).map((p) => (
                <Row key={p.id} main={p.name} sub={[p.sku, p.category].filter(Boolean).join(" | ")} />
              ))}
            </Group>
          )}
          {res.mov.length > 0 && (
            <Group title="Stock in and out" count={res.mov.length} href={`/movements?q=${enc}`}>
              {res.mov.slice(0, LIMIT).map((m) => (
                <Row key={m.id} main={m.raw_name} sub={[m.party, m.voucher_no && `Invoice ${m.voucher_no}`, m.city].filter(Boolean).join(" | ")} right={<><Badge tone={m.type === "IN" ? "green" : m.type === "OUT" ? "red" : "amber"}>{m.type}</Badge> <b className="tabular-nums">{formatNumber(m.qty)}</b> <span className="text-xs text-ink-500">{formatDateDisplay(m.date)}</span></>} />
              ))}
            </Group>
          )}
          {res.shp.length > 0 && (
            <Group title="Shipments" count={res.shp.length} href={`/shipments?q=${enc}`}>
              {res.shp.slice(0, LIMIT).map((s) => (
                <Row key={s.id} main={s.customer_name} sub={[s.phone, s.city, s.invoice_no && `Invoice ${s.invoice_no}`].filter(Boolean).join(" | ")} right={<><Badge>{s.status}</Badge> <span className="text-xs text-ink-500">{formatDateDisplay(s.ship_date)}</span></>} />
              ))}
            </Group>
          )}
          {res.fil.length > 0 && (
            <Group title="Photos and files" count={res.fil.length} href={`/shipments?q=${enc}`}>
              {res.fil.slice(0, LIMIT).map((f) => (
                <Row key={f.id} main={f.name} sub={shipments.rows.find((s) => s.id === f.shipment_id)?.customer_name ?? ""} />
              ))}
            </Group>
          )}
          {res.sections.map((s) => (
            <Group key={s.slug} title={`Section: ${s.name}`} count={s.hits} href={`/sections/${s.slug}?q=${enc}`}>
              <Row main={`${s.hits} matching row${s.hits > 1 ? "s" : ""}`} />
            </Group>
          ))}
        </>
      )}
    </div>
  );
}

function Group({ title, count, href, children }: { title: string; count: number; href: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title} <span className="font-normal text-ink-500">({formatNumber(count)})</span></h2>
        <Link href={href} className="text-xs text-brand-700 hover:underline">Open all</Link>
      </div>
      <ul className="divide-y divide-ink-100">{children}</ul>
    </section>
  );
}

function Row({ main, sub, right }: { main: string; sub?: string; right?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate">{main}</p>
        {sub && <p className="truncate text-xs text-ink-500">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </li>
  );
}
