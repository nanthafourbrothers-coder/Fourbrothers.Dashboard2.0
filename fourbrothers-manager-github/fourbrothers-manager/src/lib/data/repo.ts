// One small interface for all data access. Two implementations exist:
//  - supabaseRepo: the real shared database (Postgres + Storage) used in production
//  - localRepo: a demo / offline mode that keeps everything in this browser (IndexedDB)

import type { TableMap, TableName } from "../types";

export interface Repo {
  mode: "supabase" | "local";
  list<K extends TableName>(t: K): Promise<TableMap[K][]>;
  insert<K extends TableName>(t: K, rows: Partial<TableMap[K]>[], opts?: { ignoreDuplicatesOn?: string }): Promise<TableMap[K][]>;
  upsert<K extends TableName>(t: K, rows: Partial<TableMap[K]>[], onConflict: string): Promise<TableMap[K][]>;
  update<K extends TableName>(t: K, id: string, patch: Partial<TableMap[K]>): Promise<TableMap[K]>;
  updateMany<K extends TableName>(t: K, ids: string[], patch: Partial<TableMap[K]>): Promise<void>;
  remove<K extends TableName>(t: K, ids: string[]): Promise<void>;
  removeWhere<K extends TableName>(t: K, column: string, value: string): Promise<void>;
  uploadFile(path: string, blob: Blob, contentType?: string): Promise<void>;
  fileUrl(path: string): Promise<string>;
  removeFiles(paths: string[]): Promise<void>;
  subscribe(t: TableName, cb: () => void): () => void;
}

export const pkOf = (t: TableName): "id" | "key" => (t === "settings" ? "key" : "id");

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

let repoPromise: Promise<Repo> | null = null;

export function getRepo(): Promise<Repo> {
  if (!repoPromise) {
    repoPromise = (async () => {
      const { supabaseConfigured } = await import("./supabase");
      if (supabaseConfigured) {
        const { createSupabaseRepo } = await import("./supabaseRepo");
        return createSupabaseRepo();
      }
      const { createLocalRepo } = await import("./localRepo");
      return createLocalRepo();
    })();
  }
  return repoPromise;
}

export function isSupabaseMode(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
