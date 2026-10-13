import type { TableMap, TableName } from "../types";
import { chunk, pkOf, type Repo } from "./repo";
import { getSupabase } from "./supabase";

const BUCKET = "shipment-files";
const PAGE = 1000;

function fail(action: string, error: { message: string; code?: string } | null): never {
  const msg = error?.message ?? "unknown error";
  if (error?.code === "42501" || /row-level security/i.test(msg)) throw new Error(`You do not have permission to ${action}.`);
  if (error?.code === "23505") throw new Error(`That record already exists (${msg}).`);
  throw new Error(`Could not ${action}: ${msg}`);
}

export function createSupabaseRepo(): Repo {
  const sb = getSupabase();
  const urlCache = new Map<string, { url: string; at: number }>();

  return {
    mode: "supabase",

    async list<K extends TableName>(t: K) {
      const all: TableMap[K][] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from(t).select("*").order(pkOf(t), { ascending: true }).range(from, from + PAGE - 1);
        if (error) fail(`load ${t}`, error);
        const rows = (data ?? []) as unknown as TableMap[K][];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return all;
    },

    async insert<K extends TableName>(t: K, rows: Partial<TableMap[K]>[], opts?: { ignoreDuplicatesOn?: string }) {
      const out: TableMap[K][] = [];
      for (const part of chunk(rows, t === "dataset_rows" ? 200 : 500)) {
        const q = opts?.ignoreDuplicatesOn
          ? sb.from(t).upsert(part as never, { onConflict: opts.ignoreDuplicatesOn, ignoreDuplicates: true }).select()
          : sb.from(t).insert(part as never).select();
        const { data, error } = await q;
        if (error) fail(`save to ${t}`, error);
        out.push(...((data ?? []) as unknown as TableMap[K][]));
      }
      return out;
    },

    async upsert<K extends TableName>(t: K, rows: Partial<TableMap[K]>[], onConflict: string) {
      const out: TableMap[K][] = [];
      for (const part of chunk(rows, 500)) {
        const { data, error } = await sb.from(t).upsert(part as never, { onConflict }).select();
        if (error) fail(`save to ${t}`, error);
        out.push(...((data ?? []) as unknown as TableMap[K][]));
      }
      return out;
    },

    async update<K extends TableName>(t: K, id: string, patch: Partial<TableMap[K]>) {
      const { data, error } = await sb.from(t).update(patch as never).eq(pkOf(t), id).select();
      if (error) fail(`update ${t}`, error);
      if (!data || !data.length) throw new Error(`You do not have permission to change this record, or it no longer exists.`);
      return data[0] as unknown as TableMap[K];
    },

    async updateMany<K extends TableName>(t: K, ids: string[], patch: Partial<TableMap[K]>) {
      for (const part of chunk(ids, 100)) {
        const { error } = await sb.from(t).update(patch as never).in(pkOf(t), part);
        if (error) fail(`update ${t}`, error);
      }
    },

    async remove<K extends TableName>(t: K, ids: string[]) {
      for (const part of chunk(ids, 100)) {
        const { data, error } = await sb.from(t).delete().in(pkOf(t), part).select(pkOf(t));
        if (error) fail(`delete from ${t}`, error);
        if (!data || data.length < part.length) throw new Error("Some records could not be deleted. Your role may not allow deleting.");
      }
    },

    async removeWhere<K extends TableName>(t: K, column: string, value: string) {
      const { error } = await sb.from(t).delete().eq(column, value);
      if (error) fail(`delete from ${t}`, error);
    },

    async uploadFile(path, blob, contentType) {
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: contentType || blob.type || "application/octet-stream", upsert: false });
      if (error) fail("upload the file", error);
    },

    async fileUrl(path) {
      const hit = urlCache.get(path);
      if (hit && Date.now() - hit.at < 50 * 60 * 1000) return hit.url;
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error || !data) fail("open the file", error);
      urlCache.set(path, { url: data.signedUrl, at: Date.now() });
      return data.signedUrl;
    },

    async removeFiles(paths) {
      if (!paths.length) return;
      const { error } = await sb.storage.from(BUCKET).remove(paths);
      if (error) fail("delete the file", error);
    },

    subscribe(t, cb) {
      const ch = sb
        .channel(`rt-${t}-${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: t }, () => cb())
        .subscribe();
      return () => {
        void sb.removeChannel(ch);
      };
    },
  };
}
