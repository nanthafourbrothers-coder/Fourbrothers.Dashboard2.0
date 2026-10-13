// Small, dependency-free helpers shared by all parsers and screens.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function validYmd(y: number, m: number, d: number): string | null {
  if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function toYmdFromDateObject(d: Date): string | null {
  if (isNaN(d.getTime())) return null;
  // ExcelJS returns date cells as UTC midnight, so UTC parts are the calendar date shown in Excel.
  return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Parse many date spellings into YYYY-MM-DD. Day first for ambiguous numeric dates (India). */
export function parseDateLoose(v: unknown, dayFirst = true): string | null {
  if (v == null) return null;
  if (v instanceof Date) return toYmdFromDateObject(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;

  // 2026-10-01, 2026/10/01, 2026-10-01 14:51:23 +0530, 2026-10-01T00:00:00Z
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);

  // 1.10.2026, 01-10-2026, 1/10/26
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (dayFirst) return validYmd(y, b, a) ?? validYmd(y, a, b);
    return validYmd(y, a, b) ?? validYmd(y, b, a);
  }

  // 01-Oct-26, 1 October 2026, 1-Oct-2026, 01/Oct/2026
  m = s.match(/^(\d{1,2})[\s\-/.,]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2}|\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mo) return validYmd(y, mo, +m[1]);
  }

  // Oct 1, 2026 / October 1 2026
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return validYmd(+m[3], mo, +m[2]);
  }
  return null;
}

/** Keeps the date and time of strings like "2026-09-28 14:51:23 +0530". */
export function looksLikeDateTime(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(v.trim());
}

const NUM_RE = /^[-+]?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?$/;

/** Strict number parsing: "1,200.50", "Rs. 1,200", "(12)" and "24 Pcs" are accepted, plain text is not. */
export function parseNumberLoose(v: unknown, allowUnit = false): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v instanceof Date) return null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(?:₹|rs\.?|inr)\s*/i, "").replace(/%$/, "").trim();
  if (allowUnit) s = s.replace(/\s*[A-Za-z.]{1,8}$/, "").trim();
  if (!NUM_RE.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function cleanText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return toYmdFromDateObject(v) ?? "";
  return String(v).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Same as cleanText but keeps line breaks (for addresses and notes). */
export function cleanMultiline(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Key used to match the same product name across files (exact match semantics like Tally, ignoring case and spacing). */
export function nameKey(name: string): string {
  return cleanText(name).toUpperCase();
}

/** Removes weights, rates and LR numbers that some purchase books append to a product name, e.g. "OPTIMA 12 (142.000)". */
export function stripNameNoise(name: string): string {
  let s = cleanText(name);
  const before = s;
  s = s.replace(/\s*\((?:LR\.?\s*)?[\d.]+\)\s*$/i, "").replace(/\s+\d+\.\d{3}\s*$/, "").trim();
  return s || before;
}

/** Key used to match a name from any file against the alias table. */
export function aliasKey(name: string): string {
  return nameKey(stripNameNoise(name));
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

/** Makes "Net sales (previous_period)" style headers into safe unique keys. */
export function makeColumnKey(label: string, used: Set<string>): string {
  let base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "col";
  if (/^\d/.test(base)) base = "c_" + base;
  let key = base;
  let i = 2;
  while (used.has(key)) key = `${base}_${i++}`;
  used.add(key);
  return key;
}

export const STATE_BY_GST_CODE: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

export function stateFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const g = gstin.trim().toUpperCase();
  if (!/^\d{2}[A-Z0-9]{13}$/.test(g)) return null;
  return STATE_BY_GST_CODE[g.slice(0, 2)] ?? null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s(\-/])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .trim();
}

/** Pulls pincode and a best-guess city out of an Indian postal address. */
export function parseAddress(address: string | null | undefined): { city: string | null; pincode: string | null } {
  const a = cleanText(address);
  if (!a) return { city: null, pincode: null };
  const pins = a.match(/\b\d{6}\b/g);
  const pincode = pins ? pins[pins.length - 1] : null;
  let city: string | null = null;
  if (pincode) {
    const idx = a.lastIndexOf(pincode);
    const before = a.slice(0, idx).replace(/[\s\-–,.]+$/g, "");
    const seg = before.split(",").pop() ?? "";
    // "Malappuram Chappanagadi Road, MALAPPURAM" -> last comma segment is the city
    const cleaned = seg.replace(/^[\s\-–]+/, "").trim();
    if (cleaned && cleaned.length <= 40) city = titleCase(cleaned);
  } else {
    const seg = a.split(",").filter(Boolean).pop() ?? "";
    if (seg.trim() && seg.trim().length <= 40) city = titleCase(seg.trim());
  }
  return { city, pincode };
}

export function channelFromVoucher(voucherType: string | null, party: string | null): string | null {
  const p = (party ?? "").toUpperCase();
  const v = (voucherType ?? "").toUpperCase();
  if (p.includes("AMAZON")) return "Amazon";
  if (p.includes("SHOPIFY")) return "Shopify";
  if (p.includes("FLIPKART")) return "Flipkart";
  if (p.includes("MEESHO")) return "Meesho";
  if (v.startsWith("ONLINE SALES")) return "Online";
  if (v === "INVOICE" || v.includes("SALES")) return "B2B";
  return null;
}

/** Decide stock direction from a Tally voucher type. null means "ask the user". */
export function directionFromVoucher(voucherType: string | null): "IN" | "OUT" | null {
  const v = (voucherType ?? "").toLowerCase();
  if (!v) return null;
  if (/credit note|sales return|return inward|receipt note|purchase|grn|inward|stock in/.test(v)) return "IN";
  if (/debit note|purchase return|return outward|delivery|dispatch|sales|invoice|outward|stock out|online/.test(v)) return "OUT";
  return null;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(n);
}

export function formatDateDisplay(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(ymd);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1];
  return `${m[3]} ${mon} ${m[1]}`;
}

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
