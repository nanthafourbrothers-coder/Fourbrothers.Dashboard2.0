// Demo / offline mode. Everything is stored in this browser only (IndexedDB).
// It mimics the database rules (unique keys, cascade deletes, defaults) so screens behave the same.

import type { TableMap, TableName } from "../types";
import { pkOf, type Repo } from "./repo";

const DB_NAME = "fb-manager-local";
const TABLES: TableName[] = [
  "profiles", "products", "product_aliases", "stock_movements", "import_batches", "datasets",
  "dataset_rows", "shipments", "shipment_files", "audit_log", "settings",
];

const UNIQUE: Partial<Record<TableName, string[]>> = {
  products: ["ext_key"],
  product_aliases: ["alias_key"],
  stock_movements: ["dedupe_key"],
  datasets: ["slug"],
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: pkOf(t) });
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "path" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Could not open the browser database"));
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

async function getAll<T>(name: string): Promise<T[]> {
  return wrap((await store(name, "readonly")).getAll()) as Promise<T[]>;
}

async function putMany(name: string, rows: unknown[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    const s = tx.objectStore(name);
    for (const r of rows) s.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function deleteMany(name: string, keys: string[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    const s = tx.objectStore(name);
    for (const k of keys) s.delete(k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const nowIso = () => new Date().toISOString();
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function withDefaults(t: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = { ...row };
  if (t === "settings") {
    base.updated_at = nowIso();
    return base;
  }
  base.id = base.id ?? uuid();
  const created = nowIso();
  base.created_at = base.created_at ?? created;
  const nullables: Record<string, string[]> = {
    products: ["ext_key", "sku", "category", "unit", "location", "price", "cost", "shopify_qty", "shopify_handle", "vendor", "image_url", "notes"],
    product_aliases: ["product_id"],
    stock_movements: ["product_id", "party", "address", "city", "state", "pincode", "gstin", "voucher_type", "voucher_no", "channel", "location", "batch_id", "dedupe_key", "notes", "created_by"],
    import_batches: ["summary", "created_by"],
    datasets: ["description", "source_file", "created_by"],
    dataset_rows: ["batch_id"],
    shipments: ["phone", "city", "state", "address", "invoice_no", "courier", "tracking_no", "notes", "created_by"],
    shipment_files: ["mime", "size"],
    audit_log: ["user_id", "user_email", "entity", "entity_id", "detail"],
  };
  for (const k of nullables[t] ?? []) if (base[k] === undefined) base[k] = null;
  switch (t) {
    case "products":
      base.opening_qty = base.opening_qty ?? 0;
      base.reorder_level = base.reorder_level ?? 0;
      base.status = base.status ?? "active";
      base.updated_at = base.updated_at ?? created;
      break;
    case "stock_movements":
      base.source = base.source ?? "manual";
      break;
    case "shipments":
      base.ship_date = base.ship_date ?? today();
      base.status = base.status ?? "Pending";
      base.updated_at = base.updated_at ?? created;
      break;
    case "datasets":
    case "dataset_rows":
      base.updated_at = base.updated_at ?? created;
      break;
    case "audit_log":
      base.at = base.at ?? created;
      break;
    case "import_batches":
      base.row_count = base.row_count ?? 0;
      base.inserted = base.inserted ?? 0;
      base.skipped = base.skipped ?? 0;
      break;
    default:
  }
  return base;
}

export function createLocalRepo(): Repo {
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fb-manager-local") : null;
  const listeners = new Map<TableName, Set<() => void>>();
  const emit = (t: TableName) => {
    listeners.get(t)?.forEach((cb) => cb());
    channel?.postMessage({ table: t });
  };
  channel?.addEventListener("message", (e: MessageEvent<{ table: TableName }>) => listeners.get(e.data.table)?.forEach((cb) => cb()));

  async function uniqueCheck(t: TableName, rows: Record<string, unknown>[], ignore?: string): Promise<{ keep: Record<string, unknown>[]; skipped: number }> {
    const cols = UNIQUE[t];
    if (!cols) return { keep: rows, skipped: 0 };
    const existing = await getAll<Record<string, unknown>>(t);
    const seen = new Map<string, Set<unknown>>();
    for (const c of cols) seen.set(c, new Set(existing.map((r) => r[c]).filter((v) => v != null)));
    const keep: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const r of rows) {
      let dup: string | null = null;
      for (const c of cols) {
        const v = r[c];
        if (v != null && seen.get(c)!.has(v)) dup = c;
      }
      if (dup) {
        if (ignore === dup) {
          skipped++;
          continue;
        }
        throw new Error(`That record already exists (${dup} = ${String(r[dup])}).`);
      }
      for (const c of cols) if (r[c] != null) seen.get(c)!.add(r[c]);
      keep.push(r);
    }
    return { keep, skipped };
  }

  async function cascadeDelete(t: TableName, ids: string[]) {
    const idSet = new Set(ids);
    if (t === "products") {
      const mv = (await getAll<TableMap["stock_movements"]>("stock_movements")).filter((m) => m.product_id && idSet.has(m.product_id));
      if (mv.length) await putMany("stock_movements", mv.map((m) => ({ ...m, product_id: null })));
      const al = (await getAll<TableMap["product_aliases"]>("product_aliases")).filter((a) => a.product_id && idSet.has(a.product_id));
      await deleteMany("product_aliases", al.map((a) => a.id));
      emit("stock_movements");
      emit("product_aliases");
    } else if (t === "datasets") {
      const rows = (await getAll<TableMap["dataset_rows"]>("dataset_rows")).filter((r) => idSet.has(r.dataset_id));
      await deleteMany("dataset_rows", rows.map((r) => r.id));
      emit("dataset_rows");
    } else if (t === "shipments") {
      const files = (await getAll<TableMap["shipment_files"]>("shipment_files")).filter((f) => idSet.has(f.shipment_id));
      await deleteMany("shipment_files", files.map((f) => f.id));
      await deleteMany("files", files.map((f) => f.path));
      emit("shipment_files");
    } else if (t === "import_batches") {
      for (const child of ["stock_movements", "dataset_rows"] as const) {
        const rows = (await getAll<{ id: string; batch_id: string | null }>(child)).filter((r) => r.batch_id && idSet.has(r.batch_id));
        await deleteMany(child, rows.map((r) => r.id));
        emit(child);
      }
    }
  }

  const repo: Repo = {
    mode: "local",

    async list<K extends TableName>(t: K) {
      const rows = await getAll<TableMap[K]>(t);
      return rows.sort((a, b) => String((a as never as Record<string, unknown>)[pkOf(t)]).localeCompare(String((b as never as Record<string, unknown>)[pkOf(t)])));
    },

    async insert<K extends TableName>(t: K, rows: Partial<TableMap[K]>[], opts?: { ignoreDuplicatesOn?: string }) {
      const prepared = rows.map((r) => withDefaults(t, r as Record<string, unknown>));
      const { keep } = await uniqueCheck(t, prepared, opts?.ignoreDuplicatesOn);
      await putMany(t, keep);
      emit(t);
      return keep as unknown as TableMap[K][];
    },

    async upsert<K extends TableName>(t: K, rows: Partial<TableMap[K]>[], onConflict: string) {
      const existing = await getAll<Record<string, unknown>>(t);
      const byKey = new Map(existing.filter((r) => r[onConflict] != null).map((r) => [r[onConflict], r]));
      const out: Record<string, unknown>[] = [];
      for (const r of rows as Record<string, unknown>[]) {
        const hit = r[onConflict] != null ? byKey.get(r[onConflict]) : undefined;
        if (hit) out.push({ ...hit, ...r, [pkOf(t)]: hit[pkOf(t)], created_at: hit.created_at, updated_at: nowIso() });
        else out.push(withDefaults(t, r));
      }
      await putMany(t, out);
      emit(t);
      return out as unknown as TableMap[K][];
    },

    async update<K extends TableName>(t: K, id: string, patch: Partial<TableMap[K]>) {
      const s = await store(t, "readonly");
      const cur = (await wrap(s.get(id))) as Record<string, unknown> | undefined;
      if (!cur) throw new Error("This record no longer exists.");
      const next: Record<string, unknown> = { ...cur, ...(patch as Record<string, unknown>) };
      if ("updated_at" in cur) next.updated_at = nowIso();
      const cols = UNIQUE[t];
      if (cols) {
        const all = await getAll<Record<string, unknown>>(t);
        for (const c of cols) {
          if (next[c] != null && all.some((r) => r[pkOf(t)] !== id && r[c] === next[c])) throw new Error(`That record already exists (${c} = ${String(next[c])}).`);
        }
      }
      await putMany(t, [next]);
      emit(t);
      return next as unknown as TableMap[K];
    },

    async updateMany<K extends TableName>(t: K, ids: string[], patch: Partial<TableMap[K]>) {
      const idSet = new Set(ids);
      const all = await getAll<Record<string, unknown>>(t);
      const changed = all.filter((r) => idSet.has(r[pkOf(t)] as string)).map((r) => ({ ...r, ...(patch as Record<string, unknown>) }));
      await putMany(t, changed);
      emit(t);
    },

    async remove<K extends TableName>(t: K, ids: string[]) {
      await cascadeDelete(t, ids);
      await deleteMany(t, ids);
      emit(t);
    },

    async removeWhere<K extends TableName>(t: K, column: string, value: string) {
      const all = await getAll<Record<string, unknown>>(t);
      const ids = all.filter((r) => r[column] === value).map((r) => r[pkOf(t)] as string);
      await cascadeDelete(t, ids);
      await deleteMany(t, ids);
      emit(t);
    },

    async uploadFile(path, blob, contentType) {
      await putMany("files", [{ path, blob, type: contentType || blob.type }]);
    },

    async fileUrl(path) {
      const rec = (await wrap((await store("files", "readonly")).get(path))) as { blob: Blob } | undefined;
      if (!rec) throw new Error("File not found in this browser.");
      return URL.createObjectURL(rec.blob);
    },

    async removeFiles(paths) {
      await deleteMany("files", paths);
    },

    subscribe(t, cb) {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(cb);
      return () => listeners.get(t)?.delete(cb);
    },
  };
  return repo;
}
