// Browser test: upload real files in the Import Center (demo mode) and check results.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const SAMPLES = process.env.SAMPLE_DIR ?? "./samples";
const SHOTS = process.env.SHOTS ?? "/tmp/shots";

const exe = ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const logs = [];
page.on("console", (m) => m.type() === "error" && logs.push(m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));

await page.goto(BASE + "/import", { waitUntil: "networkidle" });
await page.setInputFiles('input[type=file]', [`${SAMPLES}/OUTSTOCK_REPORT_1.xlsx`, `${SAMPLES}/PURCHASE_ENTRY_3.xlsx`]);
await page.waitForSelector("text=Tally invoice register", { timeout: 60000 });
await page.waitForSelector("text=Purchase entry book", { timeout: 60000 });
await page.screenshot({ path: `${SHOTS}/import-1.png`, fullPage: true });
console.log("cards:", await page.locator("section.card").count());
const text = await page.locator("section.card").first().innerText();
console.log(text.slice(0, 1200));
console.log("logs:", logs);
await browser.close();
