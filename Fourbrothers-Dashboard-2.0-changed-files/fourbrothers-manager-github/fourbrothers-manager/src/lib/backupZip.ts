// Builds a ZIP with the whole website's data:
//   backup.json              the same file "Restore from backup" reads
//   csv/*.csv                one spreadsheet-ready file per table (stock items, sales register, receipts, shipments, linked names...)
//   sections/<name>.csv      every section with its own column names
//   files/...                shipment photos and documents (optional, they can be large)
//   README.txt               what is inside

import { zipSync, strToU8 } from "fflate";
import { toCsv } from "./export";
import type { Dataset, DatasetRow, Movement, Product, Shipment, ShipmentFile } from "./types";

export interface BackupInput {
  tables: Record<string, Record<string, unknown>[]>;
  settings: unknown[];
  datasets: Dataset[];
  datasetRows: DatasetRow[];
  products: Product[];
  movements: Movement[];
  shipments: Shipment[];
  shipmentFiles: ShipmentFile[];
  includeFiles: boolean;
  fetchFile: (path: string) => Promise<Uint8Array | null>;
  progress?: (message: string) => void;
}

const SKIP_KEYS = new Set(["data", "columns", "summary"]);

function csvFor(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !SKIP_KEYS.has(k)).map((k) => ({ key: k, label: k }));
  return toCsv({ filename: "x", columns: cols.map((c) => ({ ...c, type: "text" as const })), rows });
}

const safe = (s: string) => s.replace(/[^\w\- ]+/g, "_").trim().slice(0, 60) || "file";

export async function buildBackupZip(input: BackupInput, today: string): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, text: string) => {
    files[path] = strToU8(text);
  };

  const json: Record<string, unknown> = { app: "fourbrothers-manager", version: 1, exported_at: new Date().toISOString() };
  for (const [k, rows] of Object.entries(input.tables)) json[k] = rows;
  json.settings = input.settings;
  add("backup.json", JSON.stringify(json));

  input.progress?.("Writing spreadsheets");
  for (const [k, rows] of Object.entries(input.tables)) {
    if (k === "dataset_rows") continue; // better written per section below
    add(`csv/${k}.csv`, csvFor(rows));
  }

  // friendlier split of the stock lines
  const productName = new Map(input.products.map((p) => [p.id, p.name]));
  const lineCols = (out: boolean) => [
    { key: "date", label: "Date" },
    { key: out ? "party" : "party", label: out ? "Party name" : "Supplier" },
    { key: "voucher_no", label: out ? "Voucher no" : "Bill no" },
    ...(out ? [{ key: "city", label: "City" }, { key: "state", label: "State" }, { key: "channel", label: "Channel" }, { key: "voucher_type", label: "Voucher type" }] : []),
    { key: "raw_name", label: "Item (as in file)" },
    { key: "stock_item", label: "Stock item" },
    { key: "qty", label: "Qty" },
  ];
  const withItem = (m: Movement) => ({ ...(m as unknown as Record<string, unknown>), stock_item: m.product_id ? (productName.get(m.product_id) ?? "") : "" });
  add("csv/sales-register.csv", csvFor(input.movements.filter((m) => m.type === "OUT").sort((a, b) => a.date.localeCompare(b.date)).map(withItem), lineCols(true)));
  add("csv/receipts.csv", csvFor(input.movements.filter((m) => m.type === "IN").sort((a, b) => a.date.localeCompare(b.date)).map(withItem), lineCols(false)));

  // sections with their own column names
  const used = new Set<string>();
  for (const d of input.datasets) {
    let name = safe(d.name);
    while (used.has(name.toLowerCase())) name += "_2";
    used.add(name.toLowerCase());
    const rows = input.datasetRows.filter((r) => r.dataset_id === d.id).map((r) => r.data);
    add(`sections/${name}.csv`, csvFor(rows, d.columns.map((c) => ({ key: c.key, label: c.label }))));
  }

  let fileCount = 0;
  let missing = 0;
  if (input.includeFiles) {
    const byShipment = new Map(input.shipments.map((s) => [s.id, s]));
    let i = 0;
    for (const f of input.shipmentFiles) {
      i++;
      input.progress?.(`Downloading shipment files ${i} of ${input.shipmentFiles.length}`);
      const s = byShipment.get(f.shipment_id);
      const folder = s ? `${s.ship_date}_${safe(s.customer_name)}` : "unlinked";
      const bytes = await input.fetchFile(f.path).catch(() => null);
      if (!bytes) {
        missing++;
        continue;
      }
      let path = `files/${folder}/${safe(f.name.replace(/\.[^.]+$/, ""))}${/\.[^.]+$/.exec(f.name)?.[0] ?? ""}`;
      while (files[path]) path = path.replace(/(\.[^.]*)?$/, (m) => `_2${m}`);
      files[path] = bytes;
      fileCount++;
    }
  }

  add(
    "README.txt",
    [
      "FOURBROTHERS MANAGER backup",
      `Made on ${today}`,
      "",
      "backup.json    Everything in one file. Use Settings > Restore from backup to load it again.",
      "csv/           One spreadsheet per table. sales-register.csv and receipts.csv are the date wise registers.",
      "sections/      Every section as its own spreadsheet with its own column names.",
      input.includeFiles ? `files/         ${fileCount} shipment photo(s) and document(s)${missing ? `; ${missing} could not be downloaded` : ""}.` : "files/         Not included. Tick 'include shipment photos and files' when making the backup to add them.",
    ].join("\r\n"),
  );

  input.progress?.("Packing the ZIP");
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}
