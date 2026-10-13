// Suggests which stock item a file name belongs to. Numbers (sizes, capacities, pack counts) must agree,
// so "OPTIMA 12" is never suggested for "OPTIMA 15".

import type { Product } from "./types";
import { stripNameNoise } from "./parse/normalize";

const STOP = new Set([
  "4B", "FOUR", "BROTHERS", "STAINLESS", "STEEL", "SS", "S", "SET", "PC", "PCS", "PIECE", "WITH", "THE", "AND", "OF", "FOR", "IN", "NO", "NOS",
  "ML", "L", "LTR", "CM", "MM", "G", "KG", "GM", "PACK", "SIZE", "DEFAULT", "TITLE",
]);

interface Tokens {
  words: string[];
  nums: string[];
}

export function tokenize(name: string): Tokens {
  const s = stripNameNoise(name)
    .toUpperCase()
    .replace(/(\d)([A-Z])/g, "$1 $2")
    .replace(/([A-Z])(\d)/g, "$1 $2")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const words: string[] = [];
  const nums: string[] = [];
  for (const t of s.split(" ")) {
    if (!t) continue;
    if (/^\d+$/.test(t)) nums.push(String(Number(t)));
    else if (!STOP.has(t) && t.length > 1) words.push(t.replace(/^(PEELAR|PEELER)$/, "PEELER").replace(/^SQUIZER$/, "SQUEEZER").replace(/^DABBA$/, "DABBI"));
  }
  return { words: [...new Set(words)], nums: [...new Set(nums)] };
}

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else {
        i++;
        j++;
      }
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function similarity(a: Tokens, b: Tokens): number {
  if (!a.words.length || !b.words.length) return 0;
  let inter = 0;
  for (const w of a.words) if (b.words.some((x) => x === w || lev1(w, x))) inter++;
  const cos = inter / Math.sqrt(a.words.length * b.words.length);
  const contain = (inter / Math.min(a.words.length, b.words.length)) * 0.85;
  const alpha = Math.max(cos, contain);
  let numSim: number;
  if (!a.nums.length && !b.nums.length) numSim = 1;
  else if (!a.nums.length || !b.nums.length) numSim = 0.5;
  else {
    const common = a.nums.filter((n) => b.nums.includes(n)).length;
    numSim = common / new Set([...a.nums, ...b.nums]).size;
  }
  return alpha * (0.4 + 0.6 * numSim);
}

export interface Suggestion {
  product: Product;
  score: number;
}

export class Suggester {
  private items: { p: Product; t: Tokens }[];

  constructor(products: Product[]) {
    this.items = products.map((p) => ({ p, t: tokenize(p.name) }));
  }

  suggest(name: string, top = 3, min = 0.35): Suggestion[] {
    const t = tokenize(name);
    return this.items
      .map(({ p, t: pt }) => ({ product: p, score: similarity(t, pt) }))
      .filter((s) => s.score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, top);
  }
}

/** A suggestion is "confident" when it is strong and clearly better than the runner up. */
export function isConfident(s: Suggestion[]): boolean {
  if (!s.length || s[0].score < 0.85) return false;
  return s.length === 1 || s[0].score - s[1].score >= 0.15;
}
