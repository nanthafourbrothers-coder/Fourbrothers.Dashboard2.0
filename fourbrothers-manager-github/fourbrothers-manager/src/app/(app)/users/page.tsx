"use client";

// Users and roles. Admin only.

import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { db, useTable } from "@/lib/data/store";
import { ROLE_HELP, ROLE_LABELS } from "@/lib/permissions";
import { formatDateDisplay } from "@/lib/parse/normalize";
import type { Profile, Role } from "@/lib/types";
import { Badge, Button, EmptyState, Field, Modal, PageHeader, Spinner, useUi } from "@/components/ui";

const ROLES: Role[] = ["admin", "manager", "staff", "viewer"];

export default function UsersPage() {
  const auth = useAuth();
  const { toast, confirm } = useUi();
  const profiles = useTable("profiles");
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<Profile | null>(null);

  if (!auth.can("admin")) {
    return (
      <div className="card">
        <EmptyState title="Admins only" text="Ask an admin to change roles or add people." />
      </div>
    );
  }

  const call = async (method: string, body?: unknown, query = "") => {
    const token = await auth.accessToken();
    const r = await fetch(`/api/admin/users${query}`, { method, headers: { authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `The server answered ${r.status}.`);
    return j;
  };

  const patch = async (p: Profile, change: Partial<Profile>) => {
    try {
      await db.update("profiles", p.id, change);
      await db.audit("change user", "profiles", `${p.email}: ${JSON.stringify(change)}`, p.id);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save.");
    }
  };

  const remove = async (p: Profile) => {
    if (!(await confirm(`Remove ${p.email}? They can no longer sign in. Records they created stay.`, { danger: true, confirmLabel: "Remove user" }))) return;
    try {
      await call("DELETE", undefined, `?id=${encodeURIComponent(p.id)}`);
      await db.reload("profiles");
      await db.audit("remove user", "profiles", p.email ?? p.id, p.id);
      toast("success", "User removed.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not remove the user.");
    }
  };

  const rows = [...profiles.rows].sort((a, b) => Number(a.active) - Number(b.active) || (a.email ?? "").localeCompare(b.email ?? ""));
  const waiting = rows.filter((r) => !r.active).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        subtitle="Add people and choose what each can do. Anyone who signs up on their own waits here until you switch them on."
        actions={
          auth.mode === "supabase" && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add a user
            </Button>
          )
        }
      />
      {auth.mode === "local" && <p className="card p-4 text-sm text-ink-600">Demo mode has one built-in admin and no sign-in. Connect Supabase to add real users.</p>}
      <div className="grid gap-2 sm:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="card p-3">
            <p className="text-sm font-semibold">{ROLE_LABELS[r]}</p>
            <p className="mt-0.5 text-xs text-ink-500">{ROLE_HELP[r]}</p>
          </div>
        ))}
      </div>
      {waiting > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{waiting} person(s) are waiting for approval. Choose a role and tick Active.</p>}
      {!profiles.loaded ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Email</th>
                <th className="th">Role</th>
                <th className="th">Active</th>
                <th className="th">Joined</th>
                <th className="th w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const me = p.id === auth.profile?.id;
                return (
                  <tr key={p.id} className={p.active ? "" : "bg-amber-50/50"}>
                    <td className="td">{p.full_name || <span className="text-ink-400">No name</span>} {me && <Badge tone="brand">You</Badge>}</td>
                    <td className="td">{p.email}</td>
                    <td className="td">
                      <select className="input w-32" value={p.role} disabled={me} onChange={(e) => patch(p, { role: e.target.value as Role })} aria-label={`Role of ${p.email}`}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td className="td">
                      <input type="checkbox" checked={p.active} disabled={me} onChange={(e) => patch(p, { active: e.target.checked })} aria-label={`${p.email} is active`} />
                    </td>
                    <td className="td text-ink-500">{formatDateDisplay(p.created_at.slice(0, 10))}</td>
                    <td className="td text-right">
                      {!me && auth.mode === "supabase" && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setResetFor(p)} title="Set a new password" aria-label="Set a new password"><KeyRound className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(p)} title="Remove user" aria-label="Remove user"><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddUserModal onClose={() => setAdding(false)} call={call} />}
      {resetFor && <ResetModal user={resetFor} onClose={() => setResetFor(null)} call={call} />}
    </div>
  );
}

type Call = (method: string, body?: unknown, query?: string) => Promise<unknown>;

function AddUserModal({ onClose, call }: { onClose: () => void; call: Call }) {
  const { toast } = useUi();
  const [f, setF] = useState({ full_name: "", email: "", password: "", role: "staff" as Role });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await call("POST", f);
      await db.reload("profiles");
      await db.audit("add user", "profiles", `${f.email} as ${f.role}`);
      toast("success", `${f.email} can sign in now.`);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not add the user.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Add a user" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Add user</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoFocus /></Field>
        <Field label="Role">
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <Field label="Email" className="sm:col-span-2"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password (at least 8 characters)" className="sm:col-span-2" hint="Tell them the password in person. They can sign in straight away."><input className="input" type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose, call }: { user: Profile; onClose: () => void; call: Call }) {
  const { toast } = useUi();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await call("PATCH", { id: user.id, password });
      await db.audit("reset password", "profiles", user.email ?? user.id, user.id);
      toast("success", "Password changed.");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not change the password.");
      setBusy(false);
    }
  };
  return (
    <Modal title={`New password for ${user.email}`} size="sm" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Change password</Button></>}>
      <Field label="New password (at least 8 characters)"><input className="input" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
