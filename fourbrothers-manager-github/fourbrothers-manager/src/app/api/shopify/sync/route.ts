// Pulls inventory or orders from Shopify and hands them back in the same layout as Shopify's own CSV exports,
// so the normal Import screen (preview, duplicates check, undo) handles them.
//
// Env: SHOPIFY_STORE_DOMAIN (yourstore.myshopify.com) and either
//   SHOPIFY_ADMIN_TOKEN (custom app token, shpat_...) or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard app).
// Optional: SHOPIFY_API_VERSION.

import { authorize, json } from "@/lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

function shopDomain(): string | null {
  const d = (process.env.SHOPIFY_STORE_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return d || null;
}

async function accessToken(shop: string): Promise<string> {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  const id = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Add SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, in Vercel environment variables.");
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`Shopify did not give an access token (${r.status}). ${j.error_description ?? "Check the client id, secret and that the app is installed on this store."}`);
  return j.access_token;
}

async function gql<T>(shop: string, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://${shop}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
      continue;
    }
    if (r.status === 401 || r.status === 403) throw new Error("Shopify refused the token. Check the app is installed and has the read_products, read_inventory, read_locations and read_orders scopes.");
    if (!r.ok) throw new Error(`Shopify answered ${r.status}.`);
    const j = (await r.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (j.errors?.length) {
      if (j.errors.some((e) => e.extensions?.code === "THROTTLED")) {
        await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
        continue;
      }
      throw new Error(j.errors.map((e) => e.message).join("; "));
    }
    return j.data as T;
  }
  throw new Error("Shopify is rate limiting this store. Try again in a minute.");
}

type Cell = string | number | null;

const INVENTORY_QUERY = `query($cursor:String){
  productVariants(first:50, after:$cursor){
    pageInfo{ hasNextPage endCursor }
    nodes{
      sku
      selectedOptions{ name value }
      product{ title handle vendor productType }
      inventoryItem{ inventoryLevels(first:10){ nodes{ location{ name } quantities(names:["on_hand","available","committed"]){ name quantity } } } }
    }
  }
}`;

interface InvData {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      sku: string | null;
      selectedOptions: { name: string; value: string }[];
      product: { title: string; handle: string; vendor: string | null; productType: string | null };
      inventoryItem: { inventoryLevels: { nodes: { location: { name: string }; quantities: { name: string; quantity: number }[] }[] } } | null;
    }[];
  };
}

async function fetchInventory(shop: string, token: string) {
  const header = ["Title", "Handle", "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value", "SKU", "Location", "Available (not editable)", "Committed (not editable)", "On hand (current)", "Vendor", "Product Type"];
  const rows: Cell[][] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 60; page++) {
    const data: InvData = await gql<InvData>(shop, token, INVENTORY_QUERY, { cursor });
    for (const v of data.productVariants.nodes) {
      const opts = v.selectedOptions;
      const levels = v.inventoryItem?.inventoryLevels.nodes ?? [];
      const base: Cell[] = [v.product.title, v.product.handle, opts[0]?.name ?? null, opts[0]?.value ?? null, opts[1]?.name ?? null, opts[1]?.value ?? null, opts[2]?.name ?? null, opts[2]?.value ?? null, v.sku ?? null];
      const tail = [v.product.vendor, v.product.productType];
      if (!levels.length) rows.push([...base, null, null, null, null, ...tail]);
      for (const l of levels) {
        const q = (n: string) => l.quantities.find((x) => x.name === n)?.quantity ?? null;
        rows.push([...base, l.location.name, q("available"), q("committed"), q("on_hand"), ...tail]);
      }
    }
    if (!data.productVariants.pageInfo.hasNextPage) return { header, rows, truncated: false };
    cursor = data.productVariants.pageInfo.endCursor;
  }
  return { header, rows, truncated: true };
}

const ORDERS_QUERY = `query($cursor:String,$q:String){
  orders(first:40, after:$cursor, query:$q, sortKey:CREATED_AT){
    pageInfo{ hasNextPage endCursor }
    nodes{
      name email createdAt displayFinancialStatus displayFulfillmentStatus note tags
      currencyCode paymentGatewayNames discountCodes
      subtotalPriceSet{ shopMoney{ amount } } totalShippingPriceSet{ shopMoney{ amount } } totalTaxSet{ shopMoney{ amount } } totalPriceSet{ shopMoney{ amount } } totalDiscountsSet{ shopMoney{ amount } }
      shippingLine{ title }
      fulfillments(first:1){ createdAt }
      billingAddress{ name phone }
      shippingAddress{ name phone address1 address2 city zip province country }
      phone
      lineItems(first:40){ nodes{ name quantity sku originalUnitPriceSet{ shopMoney{ amount } } } }
    }
  }
}`;

interface Money { shopMoney: { amount: string } }
interface OrdersData {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      name: string; email: string | null; createdAt: string; displayFinancialStatus: string | null; displayFulfillmentStatus: string | null; note: string | null; tags: string[];
      currencyCode: string; paymentGatewayNames: string[]; discountCodes: string[];
      subtotalPriceSet: Money; totalShippingPriceSet: Money; totalTaxSet: Money; totalPriceSet: Money; totalDiscountsSet: Money;
      shippingLine: { title: string } | null;
      fulfillments: { createdAt: string }[];
      billingAddress: { name: string | null; phone: string | null } | null;
      shippingAddress: { name: string | null; phone: string | null; address1: string | null; address2: string | null; city: string | null; zip: string | null; province: string | null; country: string | null } | null;
      phone: string | null;
      lineItems: { nodes: { name: string; quantity: number; sku: string | null; originalUnitPriceSet: Money }[] };
    }[];
  };
}

async function fetchOrders(shop: string, token: string, since: string) {
  const header = [
    "Name", "Email", "Financial Status", "Fulfillment Status", "Created at", "Fulfilled at", "Currency", "Subtotal", "Shipping", "Taxes", "Total", "Discount Code", "Discount Amount", "Shipping Method",
    "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem sku", "Billing Name", "Billing Phone", "Shipping Name", "Shipping Street", "Shipping City", "Shipping Zip", "Shipping Province Name", "Shipping Country", "Shipping Phone", "Phone", "Notes", "Payment Method", "Tags",
  ];
  const rows: Cell[][] = [];
  let cursor: string | null = null;
  const amt = (m: Money | undefined) => (m ? Number(m.shopMoney.amount) : null);
  // store time in India, so an order placed at 11pm is dated that day
  const day = (s: string | undefined) => (s ? new Date(s).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }) + " +0530" : null);
  for (let page = 0; page < 50; page++) {
    const data: OrdersData = await gql<OrdersData>(shop, token, ORDERS_QUERY, { cursor, q: `created_at:>=${since}` });
    for (const o of data.orders.nodes) {
      const s = o.shippingAddress;
      const items = o.lineItems.nodes;
      const first: Cell[] = [
        o.name, o.email, (o.displayFinancialStatus ?? "").toLowerCase(), (o.displayFulfillmentStatus ?? "").toLowerCase(), day(o.createdAt), day(o.fulfillments[0]?.createdAt), o.currencyCode,
        amt(o.subtotalPriceSet), amt(o.totalShippingPriceSet), amt(o.totalTaxSet), amt(o.totalPriceSet), o.discountCodes.join(", ") || null, amt(o.totalDiscountsSet), o.shippingLine?.title ?? null,
      ];
      const addr: Cell[] = [
        o.billingAddress?.name ?? null, o.billingAddress?.phone ?? null, s?.name ?? null, [s?.address1, s?.address2].filter(Boolean).join(", ") || null, s?.city ?? null, s?.zip ?? null, s?.province ?? null, s?.country ?? null, s?.phone ?? null, o.phone ?? null, o.note ?? null, o.paymentGatewayNames.join(", ") || null, o.tags.join(", ") || null,
      ];
      const blankFirst = first.map(() => null) as Cell[];
      const blankAddr = addr.map(() => null) as Cell[];
      items.forEach((li, i) => {
        const line: Cell[] = [li.quantity, li.name, amt(li.originalUnitPriceSet), li.sku ?? null];
        rows.push(i === 0 ? [...first, ...line, ...addr] : [o.name, ...blankFirst.slice(1), ...line, ...blankAddr]);
      });
      if (!items.length) rows.push([...first, null, null, null, null, ...addr]);
    }
    if (!data.orders.pageInfo.hasNextPage) return { header, rows, truncated: false };
    cursor = data.orders.pageInfo.endCursor;
  }
  return { header, rows, truncated: true };
}

export async function GET(req: Request) {
  const a = await authorize(req, "manage");
  if (!a.ok) return a.res;
  const shop = shopDomain();
  const hasCreds = Boolean(process.env.SHOPIFY_ADMIN_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET));
  return json({ configured: Boolean(shop && hasCreds), shop, haveDomain: Boolean(shop), haveCredentials: hasCreds });
}

export async function POST(req: Request) {
  const a = await authorize(req, "manage");
  if (!a.ok) return a.res;
  const shop = shopDomain();
  if (!shop) return json({ error: "Add SHOPIFY_STORE_DOMAIN (for example fourbrothers.myshopify.com) in Vercel environment variables, then redeploy." }, 503);
  const body = (await req.json().catch(() => null)) as { what?: string; since?: string } | null;
  try {
    const token = await accessToken(shop);
    if (body?.what === "inventory") return json({ ...(await fetchInventory(shop, token)), name: "Shopify inventory" });
    if (body?.what === "orders") {
      const since = /^\d{4}-\d{2}-\d{2}$/.test(body.since ?? "") ? body.since! : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      return json({ ...(await fetchOrders(shop, token, since)), name: `Shopify orders since ${since}` });
    }
    return json({ error: "Choose inventory or orders." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Shopify sync failed." }, 502);
  }
}
