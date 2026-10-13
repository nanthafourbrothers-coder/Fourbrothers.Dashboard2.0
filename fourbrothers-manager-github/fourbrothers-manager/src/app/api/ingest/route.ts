// Webhook for any platform (Tally exports, a courier, Zapier, Make, a script).
// POST JSON with header  x-api-key: <INGEST_API_KEY>
//
//   { "type": "OUT", "date": "2026-10-13", "voucher_no": "1650", "voucher_type": "INVOICE", "party": "STAR AGENCIES",
//     "city": "Kochi", "state": "Kerala", "channel": "B2B", "items": [ { "name": "4B MINT FRESH - 1", "qty": 36 } ] }
//
//   { "movements": [ ...several of the above... ] }
//   { "shipment": { "customer_name": "...", "phone": "...", "city": "...", "invoice_no": "...", "status": "Dispatched" } }
//
// Sending the same invoice twice is safe: identical lines are skipped.

import { timingSafeEqual } from "node:crypto";
import { adminClient, json } from "@/lib/server/admin";
import { aliasKey, cleanText, parseAddress, parseDateLoose, parseNumberLoose, stateFromGstin, todayYmd } from "@/lib/parse/normalize";
import { NameResolver } from "@/lib/stock";
import { STATUS_OPTIONS, type Movement, type Product, type ProductAlias } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface InMovement {
  type?: string;
  date?: string;
  voucher_no?: string | number;
  voucher_type?: string;
  party?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  channel?: string;
  location?: string;
  notes?: string;
  items?: { name?: string; qty?: number | string }[];
}

function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const s = (v: unknown): string | null => {
  const t = cleanText(v);
  return t ? t : null;
};

async function fetchAll<T>(sb: NonNullable<ReturnType<typeof adminClient>>, table: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function POST(req: Request) {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return json({ error: "INGEST_API_KEY is not set on the server." }, 503);
  const given = req.headers.get("x-api-key") ?? "";
  if (!sameKey(given, expected)) return json({ error: "Wrong or missing x-api-key." }, 401);
  const sb = adminClient();
  if (!sb) return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." }, 503);

  const body = (await req.json().catch(() => null)) as (InMovement & { movements?: InMovement[]; shipment?: Record<string, unknown> }) | InMovement[] | null;
  if (!body) return json({ error: "Send a JSON body." }, 400);

  try {
    const result: Record<string, unknown> = {};

    const shipment = !Array.isArray(body) ? body.shipment : undefined;
    if (shipment) {
      const name = s(shipment.customer_name);
      if (!name) return json({ error: "shipment.customer_name is required." }, 400);
      const st = STATUS_OPTIONS.find((x) => x.toLowerCase() === String(shipment.status ?? "").toLowerCase());
      const row = {
        ship_date: parseDateLoose(shipment.ship_date) ?? todayYmd(),
        customer_name: name,
        phone: s(shipment.phone),
        city: s(shipment.city),
        state: s(shipment.state),
        address: s(shipment.address),
        invoice_no: s(shipment.invoice_no),
        courier: s(shipment.courier),
        tracking_no: s(shipment.tracking_no),
        status: st ?? "Pending",
        notes: s(shipment.notes),
      };
      if (row.invoice_no) {
        const { data } = await sb.from("shipments").select("id").eq("invoice_no", row.invoice_no).limit(1);
        if (data?.length) {
          const { error } = await sb.from("shipments").update(row).eq("id", data[0].id);
          if (error) throw new Error(error.message);
          result.shipment = { id: data[0].id, updated: true };
        }
      }
      if (!result.shipment) {
        const { data, error } = await sb.from("shipments").insert(row).select("id").single();
        if (error) throw new Error(error.message);
        result.shipment = { id: data.id, created: true };
      }
    }

    const list: InMovement[] = Array.isArray(body) ? body : (body.movements ?? (body.items ? [body] : []));
    if (list.length) {
      const [products, aliases] = await Promise.all([fetchAll<Product>(sb, "products"), fetchAll<ProductAlias>(sb, "product_aliases")]);
      const resolver = new NameResolver(products, aliases);
      const rows: Partial<Movement>[] = [];
      const errors: string[] = [];
      const seen = new Map<string, number>();
      list.forEach((m, mi) => {
        const type = String(m.type ?? "").toUpperCase();
        if (type !== "IN" && type !== "OUT") return errors.push(`Entry ${mi + 1}: type must be IN or OUT.`), undefined;
        const date = parseDateLoose(m.date);
        if (!date) return errors.push(`Entry ${mi + 1}: date is missing or not readable.`), undefined;
        const address = s(m.address);
        const parsed = parseAddress(address);
        for (const it of m.items ?? []) {
          const name = cleanText(it.name);
          const qty = parseNumberLoose(it.qty, true);
          if (!name || qty == null || qty <= 0) {
            errors.push(`Entry ${mi + 1}: each item needs a name and a quantity above zero.`);
            continue;
          }
          const gstin = s(m.gstin)?.toUpperCase() ?? null;
          const voucher_no = s(m.voucher_no);
          const voucher_type = s(m.voucher_type);
          const notes = s(m.notes);
          const base = [type, date, voucher_type ?? "", voucher_no ?? "", aliasKey(name), qty, notes ?? ""].join("|");
          const occ = seen.get(base) ?? 0;
          seen.set(base, occ + 1);
          rows.push({
            date,
            type: type as "IN" | "OUT",
            product_id: resolver.resolve(name) ?? null,
            raw_name: name,
            qty,
            party: s(m.party),
            address,
            city: s(m.city) ?? parsed.city,
            state: s(m.state) ?? stateFromGstin(gstin),
            pincode: s(m.pincode) ?? parsed.pincode,
            gstin,
            voucher_type,
            voucher_no,
            channel: s(m.channel),
            location: s(m.location),
            source: "api",
            notes,
            dedupe_key: `${base}|${occ}`,
          });
        }
      });
      if (rows.length > 3000) return json({ error: "Send at most 3000 lines per call." }, 413);
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await sb.from("stock_movements").upsert(rows.slice(i, i + 500), { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
        if (error) throw new Error(error.message);
        inserted += data?.length ?? 0;
      }
      result.movements = { received: rows.length, inserted, duplicates: rows.length - inserted, errors };
    }

    if (!Object.keys(result).length) return json({ error: "Nothing to save. Send items, movements or shipment." }, 400);
    await sb.from("audit_log").insert({ user_email: "api", action: "api ingest", entity: "stock_movements", detail: JSON.stringify(result).slice(0, 300) });
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Could not save." }, 500);
  }
}

export async function GET() {
  return json({ ok: true, usage: "POST JSON with header x-api-key. See the Integrations page for the format." });
}
