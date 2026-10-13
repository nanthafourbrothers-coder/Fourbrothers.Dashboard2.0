"use client";

// Connect Shopify, Tally and any other platform. Shopify can be pulled live; Tally works from its Excel exports;
// everything else can push through the API address shown here.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, FileUp, RefreshCw, ShoppingBag, Webhook } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { interpretSheet } from "@/lib/parse/detect";
import type { ParsedTable } from "@/lib/parse/table";
import type { Cell } from "@/lib/parse/rawFile";
import { addDaysYmd, todayYmd } from "@/lib/parse/normalize";
import { ImportCard } from "@/components/ImportCard";
import { Badge, Button, Field, PageHeader, useUi } from "@/components/ui";

interface Status {
  configured: boolean;
  shop: string | null;
  haveDomain: boolean;
  haveCredentials: boolean;
}

export default function IntegrationsPage() {
  const auth = useAuth();
  const { toast } = useUi();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusErr, setStatusErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [since, setSince] = useState(addDaysYmd(todayYmd(), -30));
  const [loaded, setLoaded] = useState<{ id: number; table: ParsedTable }[]>([]);
  const [origin, setOrigin] = useState("https://your-app.vercel.app");
  const canManage = auth.can("manage");
  const local = auth.mode === "local";

  useEffect(() => setOrigin(window.location.origin), []);

  const call = useCallback(
    async (init?: RequestInit) => {
      const token = await auth.accessToken();
      const r = await fetch("/api/shopify/sync", { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `The server answered ${r.status}.`);
      return j;
    },
    [auth],
  );

  useEffect(() => {
    if (local || !canManage) return;
    call()
      .then(setStatus)
      .catch((e) => setStatusErr(e instanceof Error ? e.message : "Could not check the connection."));
  }, [local, canManage, call]);

  const fetchShopify = async (what: "inventory" | "orders") => {
    setBusy(what);
    try {
      const j = await call({ method: "POST", body: JSON.stringify({ what, since }) });
      const rows: Cell[][] = [j.header, ...j.rows];
      const table = interpretSheet({ source: `${j.name} (${todayYmd()})`, name: what, format: "csv", rows, notes: j.truncated ? ["Shopify returned more than the limit of one sync. Narrow the date range or sync again."] : [] });
      if (!table.rows.length) toast("info", "Shopify returned nothing for that choice.");
      else {
        setLoaded((l) => [{ id: Date.now(), table }, ...l]);
        toast("success", `${table.rows.length} rows fetched from Shopify. Check the preview below, then save.`);
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Shopify sync failed.");
    } finally {
      setBusy(null);
    }
  };

  const sample = `curl -X POST ${origin}/api/ingest \\
  -H "x-api-key: YOUR_INGEST_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "type": "OUT",
    "date": "2026-10-13",
    "voucher_type": "INVOICE",
    "voucher_no": "1650",
    "party": "STAR AGENCIES",
    "city": "Kochi",
    "state": "Kerala",
    "channel": "B2B",
    "items": [ { "name": "4B MINT FRESH - 1", "qty": 36 } ]
  }'`;

  return (
    <div className="space-y-5">
      <PageHeader title="Shopify, Tally and other platforms" subtitle="Bring data in from the systems you already use. Everything fetched goes through the same preview, duplicate check and undo as a file import." />

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-brand-600" />
          <h2 className="font-semibold text-ink-900">Shopify (fourbrothers.in)</h2>
          {status?.configured && <Badge tone="green">Connected to {status.shop}</Badge>}
          {status && !status.configured && <Badge tone="amber">Not connected</Badge>}
        </div>
        {local ? (
          <p className="mt-2 text-sm text-ink-600">Live sync needs the online version with Supabase connected. Meanwhile, upload your Shopify CSV exports on the <Link className="text-brand-700 underline" href="/import">Import files</Link> page. They work the same way.</p>
        ) : !canManage ? (
          <p className="mt-2 text-sm text-ink-600">A manager or admin can run the Shopify sync.</p>
        ) : statusErr ? (
          <p className="mt-2 text-sm text-red-700">{statusErr}</p>
        ) : status && !status.configured ? (
          <div className="mt-2 space-y-2 text-sm text-ink-700">
            <p>To switch on live sync, add these in Vercel (Project, Settings, Environment Variables) and redeploy:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li className={status.haveDomain ? "text-green-700" : ""}><code>SHOPIFY_STORE_DOMAIN</code> = your store address, for example <code>fourbrothers.myshopify.com</code></li>
              <li className={status.haveCredentials ? "text-green-700" : ""}><code>SHOPIFY_ADMIN_TOKEN</code> = the Admin API access token of a custom app with read access to products, inventory, locations and orders. Or <code>SHOPIFY_CLIENT_ID</code> and <code>SHOPIFY_CLIENT_SECRET</code> if you made the app in the Dev Dashboard.</li>
            </ul>
            <p className="text-ink-500">Step by step instructions are in the README. Until then, Shopify CSV exports work on the Import files page.</p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Button busy={busy === "inventory"} onClick={() => fetchShopify("inventory")}>
                <RefreshCw className="h-4 w-4" /> Fetch inventory
              </Button>
              <div className="flex items-end gap-2">
                <Field label="Orders since">
                  <input className="input" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
                </Field>
                <Button busy={busy === "orders"} onClick={() => fetchShopify("orders")}>
                  <RefreshCw className="h-4 w-4" /> Fetch orders
                </Button>
              </div>
            </div>
            <p className="text-xs text-ink-500">Inventory updates the Shopify quantity on each stock item so you can see where the app and Shopify disagree. Orders become shipments or a section. Orders are never counted as stock out, because your Tally invoices already include them.</p>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-600">
          <CheckCircle2 className="h-4 w-4 text-green-600" /> No connection yet? Shopify CSV exports (inventory, products, orders, sales reports, discounts) are recognised on the{" "}
          <Link className="text-brand-700 underline" href="/import">Import files</Link> page.
        </div>
      </section>

      {loaded.map((l) => (
        <ImportCard key={l.id} initial={l.table} onRemove={() => setLoaded((x) => x.filter((y) => y.id !== l.id))} />
      ))}

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <FileUp className="h-5 w-5 text-brand-600" />
          <h2 className="font-semibold text-ink-900">Tally</h2>
        </div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-700">
          <li>In Tally, open the sales (invoice) register or purchase register for the dates you need and export it to Excel.</li>
          <li>Upload the file on <Link className="text-brand-700 underline" href="/import">Import files</Link>. The layout is recognised, the totals are checked against the report&apos;s own total, and you see a preview first.</li>
          <li>Upload again later with new dates. Lines that are already saved are skipped, so overlapping exports are safe.</li>
        </ol>
        <p className="mt-2 text-xs text-ink-500">Tally Prime has no public cloud connection, so this is a file based link. If you use a Tally add-on or a script that can call a web address, use the API below to push vouchers automatically.</p>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Webhook className="h-5 w-5 text-brand-600" />
          <h2 className="font-semibold text-ink-900">API address for any other platform</h2>
        </div>
        <p className="mt-2 text-sm text-ink-700">Zapier, Make, a courier, a billing tool or your own script can add stock lines and shipments by sending a POST request. Send the same invoice twice and the repeat is ignored.</p>
        <p className="mt-2 text-sm text-ink-700">
          Address: <code className="rounded bg-ink-100 px-1.5 py-0.5">{origin}/api/ingest</code> | Header: <code className="rounded bg-ink-100 px-1.5 py-0.5">x-api-key</code> = the <code>INGEST_API_KEY</code> you set in Vercel.
        </p>
        <div className="relative mt-3">
          <pre className="scroll-thin overflow-x-auto rounded-lg bg-ink-900 p-3 text-xs leading-relaxed text-ink-100">{sample}</pre>
          <Button size="sm" className="absolute right-2 top-2" onClick={() => navigator.clipboard?.writeText(sample).then(() => toast("success", "Copied."))}>
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Use <code>type</code> IN for purchases and OUT for sales. Send several invoices at once as <code>{"{ \"movements\": [ ... ] }"}</code>. Add a shipment with <code>{"{ \"shipment\": { \"customer_name\": \"...\", \"phone\": \"...\", \"invoice_no\": \"...\", \"status\": \"Dispatched\" } }"}</code>.
        </p>
      </section>
    </div>
  );
}
