"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button, Field, Spinner } from "@/components/ui";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth.status === "ready" || auth.status === "pending") router.replace("/");
  }, [auth.status, router]);

  if (auth.status === "loading" || auth.mode === "local" || auth.status === "ready" || auth.status === "pending") {
    return <Spinner label="Opening" />;
  }

  const setup = auth.needsSetup;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password.length < 8) return setError("Use a password with at least 8 characters.");
    setBusy(true);
    const err = setup ? await auth.createFirstAdmin(name, email, password) : await auth.signIn(email, password);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-ink-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <PackageCheck className="h-8 w-8 text-brand-600" />
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-wide">FOURBROTHERS</p>
            <p className="text-xs font-medium text-brand-600">MANAGER</p>
          </div>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <h1 className="text-lg font-semibold">{setup ? "Create the admin account" : "Sign in"}</h1>
            <p className="mt-1 text-sm text-ink-500">
              {setup ? "This is the first time the app is opened. The account you create now becomes the admin who can add everyone else." : "Use the email and password your admin gave you."}
            </p>
          </div>
          {setup && (
            <Field label="Your name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password" hint={setup ? "At least 8 characters." : undefined}>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={setup ? "new-password" : "current-password"} />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" busy={busy} className="w-full">
            {setup ? "Create admin and continue" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-ink-500">fourbrothers.in stock and dispatch manager</p>
      </div>
    </div>
  );
}
