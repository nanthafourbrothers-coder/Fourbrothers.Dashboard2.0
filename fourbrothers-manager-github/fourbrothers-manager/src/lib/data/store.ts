"use client";

// In-memory cache of every table + React hooks. All screens read from here and write through `db`.
// Writes go to the repo (Supabase or local), then the cache is patched so screens update at once.
// Changes made by other people arrive through Realtime and trigger a quiet reload.

import { useEffect, useSyncExternalStore } from "react";
import type { AuditEntry, TableMap, TableName } from "../types";
import { getRepo, pkOf } from "./repo";

interface Entry<K extends TableName = TableName> {
  rows: TableMap[K][];
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: never[] = [];
const entries = new Map<TableName, Entry>();
const listeners = new Set<() => void>();
const inflight = new Map<TableName, Promise<void>>();
const subscribed = new Set<TableName>();
const reloadTimers = new Map<TableName, ReturnType<typeof setTimeout>>();

let currentUser: { id: string | null; email: string | null } = { id: null, email: null };
export function setCurrentUser(u: { id: string | null; email: string | null }) {
  currentUser = u;
}

function getEntry<K extends TableName>(t: K): Entry<K> {
  let e = entries.get(t);
  if (!e) {
    e = { rows: EMPTY, loaded: false, loading: false, error: null };
    entries.set(t, e);
  }
  return e as unknown as Entry<K>;
}

function setEntry<K extends TableName>(t: K, patch: Partial<Entry<K>>) {
  entries.set(t, { ...getEntry(t), ...patch } as unknown as Entry);
  listeners.forEach((l) => l());
}

function subscribeStore(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function loadTable(t: TableName, force = false): Promise<void> {
  const cur = getEntry(t);
  if (cur.loaded && !force) return;
  const running = inflight.get(t);
  if (running) return running;
  const p = (async () => {
    setEntry(t, { loading: true, error: null });
    try {
      const repo = await getRepo();
      const rows = await repo.list(t);
      setEntry(t, { rows: rows as never, loaded: true, loading: false });
      if (!subscribed.has(t)) {
        subscribed.add(t);
        repo.subscribe(t, () => {
          clearTimeout(reloadTimers.get(t));
          reloadTimers.set(t, setTimeout(() => void loadTable(t, true), 600));
        });
      }
    } catch (e) {
      setEntry(t, { loading: false, loaded: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      inflight.delete(t);
    }
  })();
  inflight.set(t, p);
  return p;
}

export function useTable<K extends TableName>(t: K): { rows: TableMap[K][]; loaded: boolean; error: string | null } {
  const e = useSyncExternalStore(
    subscribeStore,
    () => getEntry(t),
    () => getEntry(t),
  );
  useEffect(() => {
    void loadTable(t);
  }, [t]);
  return { rows: e.rows, loaded: e.loaded, error: e.error };
}

export function resetStore() {
  entries.clear();
  inflight.clear();
  listeners.forEach((l) => l());
}

type Row = Record<string, unknown>;

function patchRows<K extends TableName>(t: K, fn: (rows: TableMap[K][]) => TableMap[K][]) {
  const e = getEntry(t);
  setEntry(t, { rows: fn(e.rows), loaded: true });
}

function mergeRows<K extends TableName>(t: K, incoming: TableMap[K][]) {
  const pk = pkOf(t);
  patchRows(t, (rows) => {
    const map = new Map(rows.map((r) => [(r as unknown as Row)[pk] as string, r]));
    for (const r of incoming) map.set((r as unknown as Row)[pk] as string, r);
    return [...map.values()];
  });
}

/** Foreign key side effects on other tables, so cached screens do not show stale data. */
function refreshDependents(t: TableName) {
  const deps: Partial<Record<TableName, TableName[]>> = {
    products: ["stock_movements", "product_aliases"],
    datasets: ["dataset_rows"],
    shipments: ["shipment_files"],
    import_batches: ["stock_movements", "dataset_rows"],
  };
  for (const d of deps[t] ?? []) if (getEntry(d).loaded) void loadTable(d, true);
}

export const db = {
  async insert<K extends TableName>(t: K, rows: Partial<TableMap[K]>[], opts?: { ignoreDuplicatesOn?: string }): Promise<TableMap[K][]> {
    if (!rows.length) return [];
    const repo = await getRepo();
    const out = await repo.insert(t, rows, opts);
    mergeRows(t, out);
    return out;
  },
  async upsert<K extends TableName>(t: K, rows: Partial<TableMap[K]>[], onConflict: string): Promise<TableMap[K][]> {
    if (!rows.length) return [];
    const repo = await getRepo();
    const out = await repo.upsert(t, rows, onConflict);
    mergeRows(t, out);
    return out;
  },
  async update<K extends TableName>(t: K, id: string, patch: Partial<TableMap[K]>): Promise<TableMap[K]> {
    const repo = await getRepo();
    const out = await repo.update(t, id, patch);
    mergeRows(t, [out]);
    return out;
  },
  async updateMany<K extends TableName>(t: K, ids: string[], patch: Partial<TableMap[K]>): Promise<void> {
    if (!ids.length) return;
    const repo = await getRepo();
    await repo.updateMany(t, ids, patch);
    const pk = pkOf(t);
    const idSet = new Set(ids);
    patchRows(t, (rows) => rows.map((r) => (idSet.has((r as unknown as Row)[pk] as string) ? ({ ...r, ...patch } as TableMap[K]) : r)));
  },
  async remove<K extends TableName>(t: K, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const repo = await getRepo();
    await repo.remove(t, ids);
    const pk = pkOf(t);
    const idSet = new Set(ids);
    patchRows(t, (rows) => rows.filter((r) => !idSet.has((r as unknown as Row)[pk] as string)));
    refreshDependents(t);
  },
  async removeWhere<K extends TableName>(t: K, column: string, value: string): Promise<void> {
    const repo = await getRepo();
    await repo.removeWhere(t, column, value);
    await loadTable(t, true);
    refreshDependents(t);
  },
  async reload(t: TableName) {
    await loadTable(t, true);
  },
  async audit(action: string, entity?: string, detail?: string, entityId?: string) {
    try {
      const repo = await getRepo();
      const row: Partial<AuditEntry> = {
        user_id: currentUser.id && currentUser.id !== "local" ? currentUser.id : null,
        user_email: currentUser.email,
        action,
        entity: entity ?? null,
        entity_id: entityId ?? null,
        detail: detail ?? null,
      };
      const out = await repo.insert("audit_log", [row]);
      if (getEntry("audit_log").loaded) mergeRows("audit_log", out);
    } catch {
      // the audit trail must never block real work
    }
  },
};

export async function uploadFile(path: string, blob: Blob) {
  const repo = await getRepo();
  await repo.uploadFile(path, blob, blob.type);
}
export async function getFileUrl(path: string) {
  const repo = await getRepo();
  return repo.fileUrl(path);
}
export async function deleteFiles(paths: string[]) {
  const repo = await getRepo();
  await repo.removeFiles(paths);
}
