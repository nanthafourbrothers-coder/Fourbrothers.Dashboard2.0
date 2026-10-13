// Full browser test in demo mode (data kept in IndexedDB). Run: BASE=http://localhost:3100 SAMPLE_DIR=./samples node tests/e2e-full.mjs
import { chromium } from "playwright-core";
import { existsSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const S = process.env.SAMPLE_DIR ?? "./samples";
const SHOTS = process.env.SHOTS ?? "/tmp/shots";

const exe = ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => m.type() === "error" && logs.push(m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${extra ? " | " + extra : ""}`);
  if (!ok) failed++;
};
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ""));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

// ---------- 1. import Tally + purchase
await page.goto(BASE + "/import", { waitUntil: "networkidle" });
await page.setInputFiles("input[type=file]", [`${S}/OUTSTOCK_REPORT_1.xlsx`, `${S}/PURCHASE_ENTRY_3.xlsx`]);
await page.waitForSelector("text=Tally invoice register", { timeout: 60000 });
await page.waitForSelector("text=Purchase entry book", { timeout: 60000 });
const cards = page.locator("section.card");
const tallyCard = cards.filter({ hasText: "Tally invoice register" }).first();
const purCard = cards.filter({ hasText: "Purchase entry book" }).first();
const statOf = async (card, label) => num((await card.locator(`span:has-text("${label}:") b`).first().innerText()));
const outQty = await statOf(tallyCard, "Total qty");
const inQty = await statOf(purCard, "Total qty");
console.log("file totals: out", outQty, "in", inQty);

await tallyCard.getByRole("button", { name: /^Save .* stock lines$/ }).click();
await tallyCard.getByText("Saved", { exact: true }).first().waitFor({ timeout: 60000 });
await purCard.getByRole("button", { name: /^Save .* stock lines$/ }).click();
await purCard.getByText("Saved", { exact: true }).first().waitFor({ timeout: 60000 });
check("both imports saved", true);

// ---------- 2. movements totals equal file totals
await page.goto(BASE + "/movements", { waitUntil: "networkidle" });
await page.waitForSelector("text=In (filtered)");
await page.waitForTimeout(800);
const tiles = await page.locator(".card.px-4.py-2\\.5 p.text-xl").allInnerTexts();
check("movements In equals purchase file", num(tiles[0]) === inQty, `${tiles[0]} vs ${inQty}`);
check("movements Out equals Tally file", num(tiles[1]) === outQty, `${tiles[1]} vs ${outQty}`);
await shot("movements");

// ---------- 3. re-import same files => nothing new to save
await page.goto(BASE + "/import", { waitUntil: "networkidle" });
await page.setInputFiles("input[type=file]", [`${S}/OUTSTOCK_REPORT_1.xlsx`]);
await page.waitForSelector("text=Tally invoice register", { timeout: 60000 });
await page.waitForTimeout(1200);
const again = page.locator("section.card").filter({ hasText: "Tally invoice register" }).first();
const saveBtn = again.getByRole("button", { name: /^Save .* stock lines$/ });
check("re-import has nothing to save (duplicates)", (await saveBtn.count()) === 0 || (await saveBtn.isDisabled()), (await saveBtn.count()) ? await saveBtn.innerText() : "no button");
await shot("reimport");

// ---------- 4. name matching
await page.goto(BASE + "/mapping", { waitUntil: "networkidle" });
await page.waitForSelector("text=To match");
const toMatch = num(await page.getByRole("button", { name: /^To match/ }).innerText());
check("there are names to match", toMatch > 0, String(toMatch));
await shot("mapping-before");
await page.getByRole("button", { name: /^Create an item for each/ }).click();
await page.getByRole("button", { name: "Create items" }).click();
await page.waitForSelector("text=Every name is linked", { timeout: 60000 });
check("all names linked after bulk create", true);

// ---------- 5. stock page
await page.goto(BASE + "/stock", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const onHandSum = await page.locator("tfoot td").allInnerTexts();
console.log("stock footer:", onHandSum.join(" | "));
await shot("stock");

// ---------- 6. Shopify inventory file
await page.goto(BASE + "/import", { waitUntil: "networkidle" });
await page.setInputFiles("input[type=file]", [`${S}/inventory-shopify-2026-10-13.csv`]);
await page.waitForSelector("text=Shopify inventory", { timeout: 60000 });
const inv = page.locator("section.card").filter({ hasText: "Shopify inventory" }).first();
const invTotal = await statOf(inv, "On hand").catch(() => NaN);
await inv.locator('select:has(option[value="opening"])').selectOption("opening");
await inv.getByRole("button", { name: /^Save .* stock items$/ }).click();
await page.getByRole("button", { name: "Set opening stock" }).click();
await inv.getByText("Saved", { exact: true }).first().waitFor({ timeout: 60000 });
check("shopify inventory saved as opening stock", true);
await shot("inventory-saved");

// count stock from the inventory date, so earlier Tally lines are not counted twice
await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
await page.getByLabel("Count stock from").fill("2026-10-13");
await page.getByRole("button", { name: "Save", exact: true }).first().click();
await page.getByText("counted from that day").waitFor({ timeout: 10000 });
await page.goto(BASE + "/stock", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const foot = await page.locator("tfoot td").allInnerTexts();
console.log("stock footer after opening:", foot.join(" | "), "| inventory file on hand:", invTotal);
check("stock on hand equals Shopify inventory file", foot.some((t) => num(t) === 15438), foot.join(","));
check("counting-from note is shown", (await page.locator("main").innerText()).includes("Counting stock from"));
await shot("stock-after-opening");
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const dashText = await page.locator("main").innerText();
check("dashboard no longer shouts about hundreds of negatives", !/\d{3} item\(s\) show stock below zero/.test(dashText), dashText.match(/.*below zero.*/)?.[0] ?? "no banner");
await shot("dashboard-after");

// ---------- 7. shipment with a photo
writeFileSync("/tmp/claude-0/photo.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
await page.goto(BASE + "/shipments", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /New shipment/ }).first().click();
await page.getByLabel("Customer name *").fill("Test Customer");
await page.getByText("Phone", { exact: true }).locator("..").locator("input").fill("9876543210");
await page.getByText("City", { exact: true }).locator("..").locator("input").fill("Chennai");
await page.getByText("Invoice no", { exact: true }).locator("..").locator("input").first().fill("1650");
await page.getByRole("button", { name: "Fill" }).click();
await page.waitForTimeout(500);
await page.locator('input[type=file]:not([capture])').last().setInputFiles("/tmp/claude-0/photo.png");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForSelector("text=Shipment added", { timeout: 30000 });
await page.waitForTimeout(600);
check("shipment row appears", (await page.locator("tbody tr", { hasText: "Test Customer" }).count()) === 1);
check("shipment has 1 file", /Pending\s+1\s*$/.test((await page.locator("tbody tr", { hasText: "Test Customer" }).first().innerText()).trim()), (await page.locator("tbody tr", { hasText: "Test Customer" }).first().innerText()).replace(/\s+/g, " "));
await shot("shipments");

// search by phone via global search
await page.goto(BASE + "/search?q=9876543210", { waitUntil: "networkidle" });
await page.waitForSelector("text=Shipments", { timeout: 20000 });
check("global search finds shipment by phone", (await page.locator("body").innerText()).includes("Test Customer"));

// ---------- 8. new section from a CSV
await page.goto(BASE + "/import", { waitUntil: "networkidle" });
await page.setInputFiles("input[type=file]", [`${S}/discounts_export.csv`]);
await page.waitForSelector("section.card", { timeout: 60000 });
const dcard = page.locator("section.card").first();
await dcard.getByRole("button", { name: /A section/ }).click();
await dcard.getByRole("button", { name: /^Save .* rows$/ }).click();
await dcard.getByText("Saved", { exact: true }).first().waitFor({ timeout: 60000 });
check("section created from csv", true);
await page.goto(BASE + "/sections", { waitUntil: "networkidle" });
check("section listed", (await page.locator("a.card").count()) >= 1);
await page.locator("a.card").first().click();
await page.waitForSelector("table", { timeout: 20000 });
await shot("section");

// ---------- 9. dashboard + others render
for (const p of ["/", "/integrations", "/activity", "/settings", "/users"]) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  check(`page ${p} renders`, (await page.locator("main").innerText()).length > 40);
  if (p === "/") await shot("dashboard");
}

// ---------- 10. undo the purchase import from the history
await page.goto(BASE + "/import", { waitUntil: "networkidle" });
const row = page.locator("tbody tr", { hasText: "PURCHASE_ENTRY_3.xlsx" }).first();
await row.getByRole("button", { name: "Undo this import" }).click();
await page.getByRole("button", { name: "Undo import" }).click();
await page.getByText("Import undone").waitFor({ timeout: 20000 });
await page.goto(BASE + "/movements", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const tiles2 = await page.locator(".card.px-4.py-2\\.5 p.text-xl").allInnerTexts();
check("undo removed the purchase lines", num(tiles2[0]) === 0, tiles2[0]);
check("undo kept the Tally lines", num(tiles2[1]) === outQty, tiles2[1]);
await shot("after-undo");

console.log("console errors:", logs.length ? logs : "none");
console.log(failed ? `${failed} FAILED` : "ALL OK");
await browser.close();
process.exit(failed ? 1 : 0);
