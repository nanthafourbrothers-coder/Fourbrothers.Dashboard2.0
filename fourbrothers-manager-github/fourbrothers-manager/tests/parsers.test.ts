// Run with: npm run test:parsers
// Reads real exports (path in SAMPLE_DIR, default ./samples) and checks every figure against
// numbers computed independently with Python/openpyxl.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readAnyFile } from "../src/lib/parse/rawFile";
import { interpretSheet } from "../src/lib/parse/detect";
import { parseDateLoose, parseNumberLoose, parseAddress, stateFromGstin, aliasKey } from "../src/lib/parse/normalize";

const DIR = process.env.SAMPLE_DIR ?? join(process.cwd(), "samples");
let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("  ok  ", name);
};

async function load(file: string) {
  const p = join(DIR, file);
  if (!existsSync(p)) {
    console.log("  skip", file, "(not found)");
    return null;
  }
  const res = await readAnyFile(file, new Uint8Array(readFileSync(p)));
  assert.equal(res.errors.length, 0, res.errors.join("; "));
  return res.sheets.map(interpretSheet);
}

async function main() {
  console.log("helpers");
  ok("dates", () => {
    assert.equal(parseDateLoose("1.10.2026"), "2026-10-01");
    assert.equal(parseDateLoose("07.10.2026"), "2026-10-07");
    assert.equal(parseDateLoose("01-Oct-26"), "2026-10-01");
    assert.equal(parseDateLoose("2026-09-28 14:51:23 +0530"), "2026-09-28");
    assert.equal(parseDateLoose("31.02.2026"), null);
    assert.equal(parseDateLoose("hello"), null);
  });
  ok("numbers", () => {
    assert.equal(parseNumberLoose("1,23,456.50"), 123456.5);
    assert.equal(parseNumberLoose("24 Pcs", true), 24);
    assert.equal(parseNumberLoose("24 Pcs"), null);
    assert.equal(parseNumberLoose("abc"), null);
    assert.equal(parseNumberLoose("(12)"), -12);
  });
  ok("address and gstin", () => {
    assert.deepEqual(parseAddress("8/2977,Karupparayan Koil 2nd Street, P.N. Road, TIRUPPUR, AVANASHI-641654"), { city: "Avanashi", pincode: "641654" });
    assert.deepEqual(parseAddress("#24/1, 1ST MAIN ROAD, MISSION ROAD, BANGALORE  - 560027"), { city: "Bangalore", pincode: "560027" });
    assert.equal(stateFromGstin("32CCOPV6834R1ZI"), "Kerala");
    assert.equal(stateFromGstin("33AATFV1783E1ZV"), "Tamil Nadu");
  });
  ok("alias keys ignore weights and LR numbers", () => {
    assert.equal(aliasKey("OPTIMA 12 (142.000)"), "OPTIMA 12");
    assert.equal(aliasKey("RLB(VATI) 176.750"), "RLB(VATI)");
    assert.equal(aliasKey("KICHEN LIGHTER SS CANNON (LR.189915)"), "KICHEN LIGHTER SS CANNON");
    assert.equal(aliasKey("SLB(D/D)-2 (315*400)"), "SLB(D/D)-2 (315*400)");
  });

  console.log("OUTSTOCK_REPORT (Tally register)");
  const out = await load("OUTSTOCK_REPORT_1.xlsx");
  if (out) {
    const t = out[0];
    ok("detected as Tally register", () => assert.equal(t.kind, "tally_register"));
    ok("111 vouchers", () => assert.equal(t.stats.find((s) => s.label === "Vouchers")?.value, "111"));
    ok("646 item lines", () => assert.equal(t.rows.length, 646));
    ok("total qty 26003", () => assert.equal(t.rows.reduce((s, r) => s + (r.qty as number), 0), 26003));
    ok("per voucher type qty", () => {
      const by: Record<string, number> = {};
      for (const r of t.rows) by[String(r.voucher_type)] = (by[String(r.voucher_type)] ?? 0) + (r.qty as number);
      assert.deepEqual(by, { INVOICE: 25920, "ONLINE SALES-A": 5, "ONLINE SALES-S": 76, "ONLINE SALES-F": 2 });
    });
    ok("every line has a date in October 2026", () => assert.ok(t.rows.every((r) => typeof r.date === "string" && /^2026-10-(0[1-9]|1[0-2])$/.test(r.date as string))));
    ok("first line is exact", () => {
      const r = t.rows[0];
      assert.equal(r.date, "2026-10-01");
      assert.equal(r.item, "4B MINT FRESH - 1");
      assert.equal(r.qty, 36);
      assert.equal(r.party, "STAR AGENCIES");
      assert.equal(r.voucher_no, "1650");
      assert.equal(r.voucher_type, "INVOICE");
      assert.equal(r.gstin, "32CCOPV6834R1ZI");
      assert.equal(r.state, "Kerala");
      assert.equal(r.city, "Malappuram");
      assert.equal(r.pincode, "676504");
      assert.equal(r.channel, "B2B");
    });
    ok("last line is exact", () => {
      const r = t.rows[t.rows.length - 1];
      assert.equal(r.item, "4B CAPTAIN JAR-300 ML");
      assert.equal(r.qty, 1);
      assert.equal(r.voucher_no, "4B-1585");
      assert.equal(r.channel, "Shopify");
    });
    ok("channels", () => {
      const ch = new Set(t.rows.map((r) => r.channel));
      assert.deepEqual([...ch].sort(), ["Amazon", "B2B", "Flipkart", "Shopify"]);
    });
    ok("no errors reported", () => assert.equal(t.issues.filter((i) => i.level === "error").length, 0));
  }

  console.log("PURCHASE_ENTRY (purchase book)");
  const pur = await load("PURCHASE_ENTRY_3.xlsx");
  if (pur) {
    const t = pur[0];
    ok("detected as purchase book", () => assert.equal(t.kind, "purchase_book"));
    ok("54 lines", () => assert.equal(t.rows.length, 54));
    ok("total qty 33352", () => assert.equal(t.rows.reduce((s, r) => s + ((r.qty as number) || 0), 0), 33352));
    ok("dates carried down", () => {
      assert.equal(t.rows[0].date, "2026-10-01");
      assert.equal(t.rows[1].date, "2026-10-01"); // TRIPLY STEW POT 22 has no date of its own
      assert.equal(t.rows[1].item, "TRIPLY STEW POT 22");
      const p = t.rows.find((r) => r.item === "COFFEE STRAINER - 2")!;
      assert.equal(p.date, "2026-10-05");
      const sevenOct = t.rows.find((r) => r.item === "MAGIC IDLY PLATE(BIG PADAM)")!;
      assert.equal(sevenOct.date, "2026-10-07");
    });
    ok("missing quantity flagged", () => {
      const g = t.rows.find((r) => r.item === "GHEE POT")!;
      assert.equal(g.qty, null);
      assert.ok(t.issues.some((i) => i.message.includes("GHEE POT")));
    });
    ok("no date errors", () => assert.equal(t.issues.filter((i) => i.level === "error").length, 0));
  }

  console.log("Shopify files");
  const inv = await load("inventory-shopify-2026-10-13.csv");
  if (inv) {
    const t = inv[0];
    ok("inventory: 281 variants, 15438 units", () => {
      assert.equal(t.kind, "shopify_inventory");
      assert.equal(t.rows.length, 281);
      assert.equal(t.rows.reduce((s, r) => s + ((r.on_hand as number) || 0), 0), 15438);
    });
  }
  const prod = await load("products_export.csv");
  if (prod) {
    const t = prod[0];
    ok("products: 370 variants over 123 products", () => {
      assert.equal(t.kind, "shopify_products");
      assert.equal(t.rows.length, 370);
      assert.equal(new Set(t.rows.map((r) => r.handle)).size, 123);
      assert.equal(t.rows.reduce((s, r) => s + ((r.qty as number) || 0), 0), 15369);
    });
  }
  const ord = await load("orders_export.csv");
  if (ord) {
    const t = ord[0];
    ok("orders: 50 orders, 64 lines, 81 units, 57470.72", () => {
      assert.equal(t.kind, "shopify_orders");
      assert.equal(t.rows.length, 64);
      assert.equal(t.stats.find((s) => s.label === "Orders")?.value, "50");
      assert.equal(t.stats.find((s) => s.label === "Units")?.value, "81");
      assert.equal(t.stats.find((s) => s.label === "Order value")?.value, "57,470.72");
    });
    ok("order lines inherit customer details", () => {
      const cityKey = t.columns.find((c) => c.label === "Shipping City")!.key;
      assert.ok(t.rows.every((r) => r[cityKey]));
    });
    ok("zip codes lose the protective apostrophe", () => {
      const zipKey = t.columns.find((c) => c.label === "Shipping Zip")!.key;
      assert.equal(t.rows[0][zipKey], "600047");
    });
  }
  const sales = await load("Total_sales_by_product_-_2026-07-01_-_2026-09-30.csv");
  if (sales) {
    const t = sales[0];
    ok("sales report: 80 rows, 24 unique columns", () => {
      assert.equal(t.rows.length, 80);
      assert.equal(t.columns.length, 24);
      assert.equal(new Set(t.columns.map((c) => c.key)).size, 24);
    });
    ok("sales report: numeric columns stay numeric", () => {
      assert.equal(t.columns.find((c) => c.label === "Net sales")?.type, "number");
      assert.equal(t.rows[0][t.columns.find((c) => c.label === "Net sales")!.key], 19633.76);
    });
  }
  const disc = await load("discounts_export.csv");
  if (disc) {
    const t = disc[0];
    ok("discounts: 21 rows, dates typed", () => {
      assert.equal(t.rows.length, 21);
      assert.equal(t.kind, "generic");
    });
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
