// Run with: SAMPLE_DIR=./samples npx tsx tests/analysis.test.ts
// Checks the period roll-forward and breakdowns against the real purchase book and Tally register.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readAnyFile } from "../src/lib/parse/rawFile";
import { interpretSheet } from "../src/lib/parse/detect";
import { buildMovementDrafts, planMovements } from "../src/lib/importPlan";
import { NameResolver } from "../src/lib/stock";
import { aliasKey } from "../src/lib/parse/normalize";
import { analyseProduct, otherProductsAt, resolvePeriod, NO_FILTERS, type Filters } from "../src/lib/analysis";
import type { Movement, Product, ProductAlias } from "../src/lib/types";

const DIR = process.env.SAMPLE_DIR ?? join(process.cwd(), "samples");
const P = join(DIR, "PURCHASE_ENTRY.xlsx");
const O = join(DIR, "OUTSTOCK_REPORT.xlsx");
if (!existsSync(P) || !existsSync(O)) {
  console.log("skip (sample files not found in", DIR, ")");
  process.exit(0);
}

async function table(path: string, name: string) {
  const r = await readAnyFile(name, new Uint8Array(readFileSync(path)));
  return interpretSheet(r.sheets[0]);
}

async function main() {
  const pur = await table(P, "PURCHASE_ENTRY.xlsx");
  const out = await table(O, "OUTSTOCK_REPORT.xlsx");

  // two stock items; purchase names and sales names for the same item are linked as aliases
  const mk = (id: string, name: string, opening = 0): Product => ({ id, ext_key: id, sku: null, name, category: null, unit: null, location: null, opening_qty: opening, reorder_level: 0, price: null, cost: null, shopify_qty: null, shopify_handle: null, vendor: null, status: "active", image_url: null, notes: null, created_at: "", updated_at: "" });
  const products = [mk("p12", "4B OPTIMA IDLY MAKER- 12 IDLY", 100), mk("p15", "4B OPTIMA IDLY MAKER- 15 IDLY", 0)];
  const al = (alias: string, product_id: string): ProductAlias => ({ id: alias, alias, alias_key: aliasKey(alias), product_id, created_at: "" });
  const aliases = [al("OPTIMA 12", "p12"), al("4B OPTIMA IDLY MAKER- 12 IDLY", "p12"), al("OPTIMA 15", "p15"), al("4B OPTIMA IDLY MAKER- 15 IDLY", "p15")];
  const resolver = new NameResolver(products, aliases);

  const plan = (t: typeof pur) => planMovements(buildMovementDrafts(t.rows, t.direction as "IN" | "OUT" | "auto", null), [], resolver, { replaceChanged: false });
  const pp = plan(pur);
  const op = plan(out);
  // nothing may be lost by duplicate detection: the two identical "OPTIMA 15 / 100 / 3 Oct" lines are both real entries
  assert.equal(pp.duplicates, 0, "purchase lines must not be dropped as duplicates");
  assert.equal(op.duplicates, 0);
  assert.equal(pp.inserts.length, 53, "54 purchase lines minus the one without quantity");
  assert.equal(op.inserts.length, 646);
  const totalIn = pp.inserts.reduce((s, r) => s + Number(r.qty), 0);
  const totalOut = op.inserts.reduce((s, r) => s + Number(r.qty), 0);
  assert.equal(totalIn, 33352);
  assert.equal(totalOut, 26003);

  const all = [...pp.inserts, ...op.inserts].map((m, i) => ({ ...m, id: `m${i}`, created_at: `2026-10-13T00:00:${String(i % 60).padStart(2, "0")}` })) as Movement[];
  const of = (id: string) => all.filter((m) => m.product_id === id);
  const a12 = analyseProduct(products[0], of("p12"), { period: resolvePeriod({ id: "all", from: "", to: "" }), filters: NO_FILTERS });

  // independent expectations straight from the Excel files (computed with openpyxl)
  const in12 = of("p12").filter((m) => m.type === "IN").reduce((s, m) => s + Number(m.qty), 0);
  const out12 = of("p12").filter((m) => m.type === "OUT").reduce((s, m) => s + Number(m.qty), 0);
  console.log("OPTIMA 12: opening 100, in", in12, "out", out12, "on hand", a12.kpis.onHand);
  assert.equal(a12.kpis.in, in12);
  assert.equal(a12.kpis.out, out12);
  assert.equal(a12.kpis.onHand, 100 + in12 - out12);
  assert.ok(in12 > 0 && out12 > 0, "both files feed this item");

  // period roll-forward: opening of a later window = opening + everything before it
  const mid = "2026-10-06";
  const late = analyseProduct(products[0], of("p12"), { period: { id: "custom", from: mid, to: null, label: "" }, filters: NO_FILTERS });
  const earlyNet = of("p12").filter((m) => m.date < mid).reduce((s, m) => s + (m.type === "IN" ? Number(m.qty) : -Number(m.qty)), 0);
  assert.equal(late.kpis.opening, 100 + earlyNet);
  assert.equal(late.kpis.onHand, a12.kpis.onHand, "closing stock is the same however the period is cut");
  const first = analyseProduct(products[0], of("p12"), { period: { id: "custom", from: null, to: "2026-10-05", label: "" }, filters: NO_FILTERS });
  assert.equal(first.kpis.opening, 100);
  assert.equal(first.kpis.in + late.kpis.in, a12.kpis.in);
  assert.equal(first.kpis.out + late.kpis.out, a12.kpis.out);

  // location filter keeps only stock-out to that state, and shares add up
  const states = a12.byState.map((s) => s.label);
  console.log("states", a12.byState.map((s) => `${s.label}:${s.qty}`).join(", "));
  assert.equal(a12.byState.reduce((s, x) => s + x.qty, 0), a12.kpis.out);
  const f: Filters = { ...NO_FILTERS, states: [states[0]] };
  const only = analyseProduct(products[0], of("p12"), { period: resolvePeriod({ id: "all", from: "", to: "" }), filters: f });
  assert.equal(only.lines.every((m) => m.type === "OUT" && (m.state || "Not set") === states[0]), true);
  assert.equal(only.kpis.onHand, a12.kpis.onHand, "stock on hand does not change when you look at one state");
  assert.equal(only.parties.reduce((s, p) => s + p.qty, 0), a12.byState[0].qty);

  // other products sold in the same state
  const name = (m: Movement) => m.raw_name;
  const others = otherProductsAt(all, "p12", f, resolvePeriod({ id: "all", from: "", to: "" }), name);
  console.log("other products in", states[0], others.slice(0, 3).map((o) => `${o.name}:${o.qty}`).join(" | "));
  assert.ok(others.length > 0 && others.every((o) => o.productId !== "p12"));

  // running stock line ends at on hand
  assert.equal(a12.series[a12.series.length - 1].onHand, a12.kpis.onHand);

  // customer history
  const top = a12.parties[0];
  console.log("top party", top.party, top.qty, "invoices", top.invoices);
  assert.equal(top.history.reduce((s, h) => s + h.qty, 0), top.qty);
  console.log("all analysis checks passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
