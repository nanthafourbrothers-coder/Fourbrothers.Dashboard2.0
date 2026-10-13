// Admin-only user management: create a user with a password, reset a password, remove a user.
// Everything else about users (role, active) is edited from the browser under row level security.

import { authorize, json } from "@/lib/server/admin";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["admin", "manager", "staff", "viewer"];

export async function POST(req: Request) {
  const a = await authorize(req, "admin");
  if (!a.ok) return a.res;
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string; full_name?: string; role?: Role } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const role = body?.role && ROLES.includes(body.role) ? body.role : "staff";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
  if (password.length < 8) return json({ error: "The password needs at least 8 characters." }, 400);
  const { data, error } = await a.sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: body?.full_name?.trim() ?? "" } });
  if (error || !data.user) return json({ error: error?.message ?? "Could not create the user." }, 400);
  const { error: upErr } = await a.sb.from("profiles").upsert({ id: data.user.id, email, full_name: body?.full_name?.trim() ?? "", role, active: true }, { onConflict: "id" });
  if (upErr) return json({ error: upErr.message }, 500);
  return json({ id: data.user.id });
}

export async function PATCH(req: Request) {
  const a = await authorize(req, "admin");
  if (!a.ok) return a.res;
  const body = (await req.json().catch(() => null)) as { id?: string; password?: string } | null;
  if (!body?.id) return json({ error: "Missing user." }, 400);
  if ((body.password ?? "").length < 8) return json({ error: "The password needs at least 8 characters." }, 400);
  const { error } = await a.sb.auth.admin.updateUserById(body.id, { password: body.password });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const a = await authorize(req, "admin");
  if (!a.ok) return a.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "Missing user." }, 400);
  if (id === a.userId) return json({ error: "You cannot remove your own account." }, 400);
  const { error } = await a.sb.auth.admin.deleteUser(id);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}
