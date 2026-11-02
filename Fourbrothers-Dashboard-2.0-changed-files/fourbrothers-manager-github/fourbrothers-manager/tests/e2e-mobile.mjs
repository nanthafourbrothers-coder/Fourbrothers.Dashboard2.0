// Browser test: import the two real Excel files in demo mode, then check every page at phone width.
// Run: SAMPLE_DIR=./samples SHOTS=/tmp/shots node tests/e2e-mobile.mjs   (dev server on :3100)
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const SAMPLES = process.env.SAMPLE_DIR ?? "./samples";
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
const W = Number(process.env.W ?? 390);
mkdirSync(SHOTS, { recursive: true });

const exe = ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => m.type() === "error" && logs.push(m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));

// Which elements stick out past the right edge of the screen (ignoring ones inside a scroller).
const overflow = () =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      let p = el.parentElement;
      let scrolled = false;
      while (p && p !== document.body) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden") { scrolled = true; break; }
        p = p.parentElement;
      }
      if (scrolled) continue;
      bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} right=${Math.round(r.right)}`);
      if (bad.length > 6) break;
    }
    return { vw, scrollW: document.documentElement.scrollWidth, bad };
  });

const report = [];
const check = async (name) => {
  await page.waitForTimeout(500);
  const o = await overflow();
  await page.screenshot({ path: `${SHOTS}/m-${name}.png`, fullPage: false });
  const flag = o.scrollW > o.vw + 1 || o.bad.length ? "OVERFLOW" : "ok";
  report.push(`${flag.padEnd(9)} ${name}  (page ${o.scrollW}px / screen ${o.vw}px) ${o.bad.join(" | ")}`);
};

// 1. import the real files
await page.goto(BASE + "/import", { waitUntil: "networkidle" });
await check("import-empty");
await page.setInputFiles("input[type=file]", [`${SAMPLES}/OUTSTOCK_REPORT.xlsx`, `${SAMPLES}/PURCHASE_ENTRY.xlsx`]);
await page.waitForSelector("text=Tally invoice register", { timeout: 60000 });
await page.waitForSelector("text=Purchase entry book", { timeout: 60000 });
await check("import-preview");
// save every file (the page may re-render after each save)
for (let guard = 0; guard < 4; guard++) {
  const btn = page.getByRole("button", { name: /^Save \d/ }).first();
  if (!(await btn.count())) break;
  await btn.click();
  await page.waitForTimeout(2500);
}
await check("import-saved");

// 1b. build the stock list: link names to stock items on the Name matching page
await page.goto(BASE + "/mapping", { waitUntil: "networkidle" });
await check("mapping-todo");
await page.getByRole("button", { name: /Create an item for each/ }).click();
await page.getByRole("button", { name: "Create items" }).click();
const t0 = Date.now();
await page.waitForSelector("text=stock items created and linked", { timeout: 240000 });
report.push(`info      creating ${"stock items"} took ${Math.round((Date.now() - t0) / 1000)}s`);

// 2. sweep every page at phone width
const pages = [
  ["dashboard", "/"],
  ["stock", "/stock"],
  ["sales", "/movements?type=OUT"],
  ["receipts", "/movements?type=IN"],
  ["all-lines", "/movements"],
  ["shipments", "/shipments"],
  ["sections", "/sections"],
  ["mapping", "/mapping"],
  ["users", "/users"],
  ["activity", "/activity"],
  ["settings", "/settings"],
  ["integrations", "/integrations"],
];
for (const [name, url] of pages) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await check(name);
}

// 3. the menu
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /menu/i }).first().click().catch(() => {});
await check("menu-open");
await page.keyboard.press("Escape");

// 4. the product popup
await page.goto(BASE + "/stock", { waitUntil: "networkidle" });
const row = page.locator("tbody tr").first();
if (!(await row.count().catch(() => 0))) { await page.waitForTimeout(1500); }
await row.click({ timeout: 8000 }).catch(async () => { console.log(report.join("\n")); await browser.close(); process.exit(1); });
await page.waitForSelector("[role=dialog]", { timeout: 10000 });
await check("popup-top");
for (const tab of ["Charts", "Customers", "Locations", "All lines", "Count"]) {
  const t = page.getByRole("tab", { name: new RegExp(tab, "i") }).or(page.getByRole("button", { name: new RegExp("^" + tab, "i") })).first();
  if (await t.count()) {
    await t.click();
    await check("popup-" + tab.toLowerCase().replace(/\W/g, ""));
  } else report.push("MISSING   tab " + tab);
}

console.log(report.join("\n"));
console.log("console errors:", logs.slice(0, 8));
await browser.close();
