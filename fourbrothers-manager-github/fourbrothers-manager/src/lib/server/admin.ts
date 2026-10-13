// Server-only helpers for the /api routes. They use the Supabase service role key, which must never reach the browser.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { roleCan, type Level } from "../permissions";
import type { Role } from "../types";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Authz = { ok: true; userId: string; role: Role; sb: SupabaseClient } | { ok: false; res: Response };

/** Checks the signed-in user's Bearer token and that their role reaches `level`. */
export async function authorize(req: Request, level: Level): Promise<Authz> {
  const sb = adminClient();
  if (!sb) return { ok: false, res: json({ error: "The server is missing SUPABASE_SERVICE_ROLE_KEY. Add it in Vercel, Settings, Environment Variables, then redeploy." }, 503) };
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, res: json({ error: "Sign in first." }, 401) };
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u.user) return { ok: false, res: json({ error: "Your session has expired. Sign in again." }, 401) };
  const { data: p } = await sb.from("profiles").select("role,active").eq("id", u.user.id).maybeSingle();
  const role = (p?.active ? p.role : null) as Role | null;
  if (!roleCan(role, level)) return { ok: false, res: json({ error: "Your role does not allow this." }, 403) };
  return { ok: true, userId: u.user.id, role: role!, sb };
}
