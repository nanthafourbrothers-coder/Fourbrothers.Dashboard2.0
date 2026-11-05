// Run with: npx tsx tests/overview.test.ts
// Checks the numbers behind the overview pictures with small made-up data (no sample files needed).
import assert from "node:assert/strict";
import { analyseProduct, NO_FILTERS, resolvePeriod } from "../src/lib/analysis";
import { buildUploadOverview, explainProduct, overviewOfLines, pipeForBatch, productFlow, timeAgo } from "../src/lib/overview";
import { computeStock } from "../src/lib/stock";
import type { ImportBatch, Movement, Product } from "../src/lib/types";

let n = 0;
const mv = (o: Partial<Movement>): Movement => ({
  id: `m${++n}`, date: "2025-10-07", type: "OUT", product_id: "p1", raw_name: "4B Z PEELAR", qty: 1, party: null, address: null, city: null, state: null, pincode: null, gstin: null,
  voucher_type: null, voucher_no: null, channel: null, location: null, source: "import", batch_id: null, dedupe_key: null, notes: null, created_by: null, created_at: `2025-10-0${(n % 9) + 1}T00:00:00Z`, ...o,
});
const product = (o: Partial<Product> = {}): Product => ({ id: "p1", ext_key: "p1", sku: null, name: "4B Z PEELAR", category: null, unit: null, location: null, opening_qty: 0, reorder_level: 0, price: null, cost: null, shopify_qty: null, shopify_handle: null, vendor: null, status: "active", image_url: null, notes: null, created_at: "", updated_at: "", ...o });
const all = resolvePeriod({ id: "all", from: "", to: "" });
const analyse = (p: Product, lines: Movement[]) => analyseProduct(p, lines, { period: all, filters: NO_FILTERS });
const sum = (xs: { qty: number }[]) => xs.reduce((s, x) => s + x.qty, 0);

// ---- the case in the screenshot: 864 sold in two days, nothing ever recorded as received
{
  const lines = [
    mv({ date: "2025-10-07", qty: 576, state: "Tamil Nadu", party: "SRI RANGAM AGENCIES", city: "Tiruchirapalli", voucher_no: "1", channel: "B2B" }),
    mv({ date: "2025-10-12", qty: 288, state: "Andhra Pradesh", party: "A H DISTRIBUTORS", city: "Vijayawada", voucher_no: "2", channel: "B2B" }),
  ];
  const a = analyse(product(), lines);
  assert.equal(a.kpis.onHand, -864);
  const f = productFlow(a);
  assert.equal(f.shortfall, 864, "everything sold was never recorded as received");
  assert.equal(f.left, 0);
  assert.equal(sum(f.sources), sum(f.sinks), "both sides of the diagram add up to the same total");
  assert.equal(f.total, 864);
  assert.equal(f.sources[0].kind, "gap");
  const stock = computeStock([product()], lines)[0];
  const m = explainProduct(stock, a, "All time");
  assert.equal(m.tone, "red");
  assert.match(m.headline, /Below zero/);
  assert.ok(m.lines.some((l) => /Tamil Nadu/.test(l) && /67%/.test(l)), "names the biggest state");
  assert.ok(m.lines.some((l) => /opening stock/i.test(l)), "tells the user what to do");
}

// ---- a healthy item: opening 1000, purchases 500 from two suppliers, sold to five states, 200 counted off
{
  const states = ["Tamil Nadu", "Kerala", "Karnataka", "Telangana", "Goa", "Assam", "Bihar"];
  const lines = [
    mv({ type: "IN", qty: 300, party: "Supplier A", date: "2025-09-01" }),
    mv({ type: "IN", qty: 200, party: "Supplier B", date: "2025-09-02" }),
    ...states.map((s, i) => mv({ qty: 50 + i * 10, state: s, party: `Cust ${i}`, voucher_no: `V${i}`, date: `2025-09-${10 + i * 3}` })),
    mv({ type: "ADJUST", qty: -20, date: "2025-09-20" }),
  ];
  const a = analyse(product({ opening_qty: 1000 }), lines);
  const soldTotal = states.reduce((s, _, i) => s + 50 + i * 10, 0);
  assert.equal(a.kpis.onHand, 1000 + 500 - soldTotal - 20);
  const f = productFlow(a, { maxPerSide: 4 });
  assert.equal(f.shortfall, 0);
  assert.equal(f.left, a.kpis.onHand);
  assert.equal(sum(f.sources), sum(f.sinks), "balanced");
  assert.ok(f.sources.length <= 4 + 1 && f.sinks.length <= 4 + 3, "long lists are folded into 'others'");
  assert.ok(f.sinks.some((s) => s.label.endsWith("others")));
  assert.ok(f.sinks.some((s) => s.kind === "left"));
  assert.deepEqual(f.sources.map((s) => s.label).slice(0, 1), ["Opening stock"]);
  const stock = computeStock([product({ opening_qty: 1000 })], lines)[0];
  const m = explainProduct(stock, a, "All time");
  assert.equal(m.tone, "green");
  assert.ok(m.lines.some((l) => /lasts about/.test(l)), "says how long the stock lasts");
}

// ---- an empty selection draws nothing and does not crash
{
  const a = analyse(product(), []);
  const f = productFlow(a);
  assert.equal(f.sources.length + f.sinks.length, 0);
  assert.equal(f.total, 0);
  const m = explainProduct({ flag: "uncounted", on_hand: 0 }, a, "All time");
  assert.match(m.lines[0], /No stock moved/);
}

// ---- what is inside a file
{
  const o = overviewOfLines([
    { date: "2025-04-03", raw_name: "A", qty: 10, state: "Kerala", party: "X" },
    { date: "2025-04-20", raw_name: "A", qty: 5, state: "Kerala", party: "X" },
    { date: "2025-06-02", raw_name: "B", qty: 20, state: "Goa", party: "Y" },
  ]);
  assert.equal(o.lines, 3);
  assert.equal(o.units, 35);
  assert.equal(o.items, 2);
  assert.equal(o.first, "2025-04-03");
  assert.equal(o.last, "2025-06-02");
  assert.deepEqual(o.months.map((m) => [m.key, m.qty]), [["2025-04", 15], ["2025-05", 0], ["2025-06", 20]], "a month with no lines still shows, as zero");
  assert.deepEqual(o.topItems[0], { label: "B", qty: 20 });
  assert.equal(overviewOfLines([]).lines, 0);
}

// ---- every uploaded file as one flow
{
  const batch = (o: Partial<ImportBatch>): ImportBatch => ({ id: `b${++n}`, filename: "f.xlsx", kind: "generic", destination: "dataset", row_count: 10, inserted: 10, skipped: 0, summary: null, created_by: null, created_at: "2025-10-01T10:00:00Z", ...o });
  const batches = [
    batch({ filename: "OUTSTOCK_REPORT.xlsx", kind: "tally_register", destination: "movements", row_count: 1000, inserted: 900, skipped: 100, created_at: "2025-10-03T10:00:00Z" }),
    batch({ filename: "OUTSTOCK_2.xlsx", kind: "tally_register", destination: "movements", row_count: 50, inserted: 50, created_at: "2025-10-04T10:00:00Z" }),
    batch({ filename: "PURCHASE_ENTRY.xlsx", kind: "purchase_book", destination: "movements", row_count: 200, inserted: 200 }),
    batch({ filename: "products.csv", kind: "shopify_products", destination: "stock_items", row_count: 30, inserted: 30 }),
    batch({ filename: "orders.csv", kind: "shopify_orders", destination: "shipments", row_count: 12, inserted: 12 }),
  ];
  const lines = [
    mv({ date: "2025-04-10", type: "OUT" }),
    mv({ date: "2025-06-10", type: "IN" }),
    mv({ date: "2025-06-11", type: "OUT", product_id: null, raw_name: "Mystery item" }),
  ];
  const stock = computeStock([product({ opening_qty: 10 })], lines);
  const o = buildUploadOverview(batches, lines, [], stock);
  assert.equal(o.fileCount, 5);
  assert.equal(o.saved, 900 + 50 + 200 + 30 + 12);
  assert.equal(o.skipped, 100);
  assert.deepEqual(o.pipes.map((p) => p.key), ["items", "in", "out", "ship"], "stock items, purchases, sales, shipments");
  const out = o.pipes.find((p) => p.key === "out")!;
  assert.equal(out.files.length, 2);
  assert.equal(out.saved, 950);
  assert.equal(out.href, "/movements?type=OUT");
  assert.equal(o.lastUpload, "2025-10-04T10:00:00Z");
  assert.deepEqual(o.coverage.months.map((m) => m.key), ["2025-04", "2025-05", "2025-06"]);
  assert.deepEqual(o.coverage.months.map((m) => [m.out, m.in]), [[1, 0], [0, 0], [1, 1]]);
  assert.equal(o.health.unlinkedNames, 1);
  assert.equal(o.health.unlinkedLines, 1);
  assert.equal(pipeForBatch(batches[2]).key, "in");
  // an alias that says "ignore this name" takes it off the unlinked list
  const ign = buildUploadOverview(batches, lines, [{ id: "a", alias: "Mystery item", alias_key: "mystery item", product_id: null, created_at: "" }], stock);
  assert.equal(ign.health.unlinkedNames, 0);
}

// ---- time words
{
  const now = Date.parse("2025-10-10T12:00:00Z");
  assert.equal(timeAgo("2025-10-10T11:59:00Z", now), "just now");
  assert.equal(timeAgo("2025-10-10T11:30:00Z", now), "30 min ago");
  assert.equal(timeAgo("2025-10-10T09:00:00Z", now), "3 hours ago");
  assert.equal(timeAgo("2025-10-07T12:00:00Z", now), "3 days ago");
  assert.equal(timeAgo(null, now), "never");
}

console.log("overview tests passed");
