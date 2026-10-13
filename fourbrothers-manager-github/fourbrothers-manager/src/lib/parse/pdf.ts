// Reads selectable text from a PDF and arranges it into rows and columns.
// Scanned PDFs (pictures of paper) have no text and cannot be read here.

interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

type PdfJs = {
  getDocument: (src: unknown) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
};
interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
  destroy?: () => void;
}

async function loadPdfJs(): Promise<PdfJs> {
  if (typeof window === "undefined") {
    const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
    return mod;
  }
  const mod = (await import("pdfjs-dist")) as unknown as PdfJs;
  mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return mod;
}

export async function extractPdfRows(bytes: Uint8Array): Promise<(string | null)[][]> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const pageLines: TextItem[][][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, h: it.height ?? 8 });
    }
    pageLines.push(groupIntoLines(items));
  }
  doc.destroy?.();

  // Column bands are found across the whole document so that a table that continues on page 2 stays aligned.
  const allLines = pageLines.flat();
  const bands = findBands(allLines);
  const rows: (string | null)[][] = [];
  for (const lines of pageLines) {
    for (const line of lines) rows.push(lineToRow(line, bands));
  }
  return rows.filter((r) => r.some((c) => c));
}

function groupIntoLines(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, it.h * 0.5);
    if (last && Math.abs(last[0].y - it.y) <= tol) last.push(it);
    else lines.push([it]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  return lines;
}

interface Cluster {
  x0: number;
  x1: number;
  text: string;
}

/** Join neighbouring text pieces that are only a normal word space apart. */
function toCells(line: TextItem[]): Cluster[] {
  const cells: Cluster[] = [];
  for (const it of line) {
    const prev = cells[cells.length - 1];
    const charW = it.str.length ? it.w / it.str.length : 4;
    if (prev && it.x - prev.x1 <= Math.max(charW * 1.6, 3)) {
      prev.text += (it.x - prev.x1 > charW * 0.3 ? " " : "") + it.str;
      prev.x1 = it.x + it.w;
    } else {
      cells.push({ x0: it.x, x1: it.x + it.w, text: it.str });
    }
  }
  return cells;
}

function findBands(lines: TextItem[][]): [number, number][] {
  const multi = lines.map(toCells).filter((c) => c.length >= 2);
  if (!multi.length) return [];
  let max = 0;
  for (const cells of multi) for (const c of cells) max = Math.max(max, Math.ceil(c.x1));
  const cover = new Uint16Array(max + 3);
  for (const cells of multi) for (const c of cells) for (let x = Math.floor(c.x0); x <= Math.ceil(c.x1); x++) cover[x]++;
  const bands: [number, number][] = [];
  let start = -1;
  for (let x = 0; x < cover.length; x++) {
    if (cover[x] > 0 && start < 0) start = x;
    if ((cover[x] === 0 || x === cover.length - 1) && start >= 0) {
      bands.push([start, x - 1]);
      start = -1;
    }
  }
  // merge bands separated by tiny gaps (<3pt)
  const merged: [number, number][] = [];
  for (const b of bands) {
    const last = merged[merged.length - 1];
    if (last && b[0] - last[1] < 3) last[1] = b[1];
    else merged.push([...b] as [number, number]);
  }
  return merged;
}

function lineToRow(line: TextItem[], bands: [number, number][]): (string | null)[] {
  const cells = toCells(line);
  if (!bands.length) return [cells.map((c) => c.text).join(" ")];
  const row: (string | null)[] = new Array(bands.length).fill(null);
  if (cells.length === 1) {
    // single piece of text: a title or a note, keep it in the first column
    const c = cells[0];
    let idx = bands.findIndex((b) => (c.x0 + c.x1) / 2 >= b[0] && (c.x0 + c.x1) / 2 <= b[1]);
    if (idx < 0) idx = 0;
    row[idx] = c.text;
    return row;
  }
  for (const c of cells) {
    const mid = (c.x0 + c.x1) / 2;
    let idx = bands.findIndex((b) => mid >= b[0] && mid <= b[1]);
    if (idx < 0) {
      let best = 0;
      let bd = Infinity;
      bands.forEach((b, i) => {
        const d = Math.min(Math.abs(mid - b[0]), Math.abs(mid - b[1]));
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      idx = best;
    }
    row[idx] = row[idx] ? `${row[idx]} ${c.text}` : c.text;
  }
  return row;
}
