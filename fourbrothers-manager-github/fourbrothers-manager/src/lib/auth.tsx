"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Profile, Role } from "./types";
import { roleCan, type Level } from "./permissions";
import { resetStore, setCurrentUser } from "./data/store";
import { getSupabase, supabaseConfigured } from "./data/supabase";

type Status = "loading" | "signed_out" | "pending" | "ready";

interface AuthState {
  status: Status;
  mode: "supabase" | "local";
  profile: Profile | null;
  role: Role | null;
  needsSetup: boolean;
  can: (level: Level) => boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  createFirstAdmin: (name: string, email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  accessToken: () => Promise<string | null>;
}

const LOCAL_PROFILE: Profile = {
  id: "local",
  email: "demo@this-browser",
  full_name: "Demo admin",
  role: "admin",
  active: true,
  created_at: new Date(0).toISOString(),
};

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = supabaseConfigured ? "supabase" : "local";
  const [status, setStatus] = useState<Status>(mode === "local" ? "ready" : "loading");
  const [profile, setProfile] = useState<Profile | null>(mode === "local" ? LOCAL_PROFILE : null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const loadProfile = useCallback(async (userId: string, email: string | undefined) => {
    const sb = getSupabase();
    const { data, error } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error || !data) {
      setProfile(null);
      setStatus("pending");
      return;
    }
    const p = data as Profile;
    setProfile(p);
    setCurrentUser({ id: p.id, email: p.email ?? email ?? null });
    setStatus(p.active ? "ready" : "pending");
  }, []);

  useEffect(() => {
    if (mode === "local") {
      setCurrentUser({ id: "local", email: LOCAL_PROFILE.email });
      return;
    }
    const sb = getSupabase();
    let cancelled = false;
    const checkSetup = async () => {
      const { data } = await sb.rpc("needs_setup");
      if (!cancelled) setNeedsSetup(Boolean(data));
    };
    sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const s = data.session;
      if (s?.user) void loadProfile(s.user.id, s.user.email);
      else {
        setStatus("signed_out");
        void checkSetup();
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user) void loadProfile(session.user.id, session.user.email);
      else {
        setProfile(null);
        setCurrentUser({ id: null, email: null });
        resetStore();
        setStatus("signed_out");
        void checkSetup();
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [mode, loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return error.message === "Invalid login credentials" ? "Email or password is not correct." : error.message;
    return null;
  }, []);

  const createFirstAdmin = useCallback(async (name: string, email: string, password: string) => {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() } } });
    if (error) return error.message;
    if (!data.session) return "Account created. Supabase is asking for email confirmation: open the email and confirm, or turn off Confirm email in Supabase (Authentication, Providers, Email), then sign in.";
    return null;
  }, []);

  const signOut = useCallback(async () => {
    if (mode === "supabase") await getSupabase().auth.signOut();
  }, [mode]);

  const accessToken = useCallback(async () => {
    if (mode !== "supabase") return null;
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  }, [mode]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      mode,
      profile,
      role: profile?.active ? profile.role : null,
      needsSetup,
      can: (level) => roleCan(profile?.active ? profile.role : null, level),
      signIn,
      createFirstAdmin,
      signOut,
      accessToken,
    }),
    [status, mode, profile, needsSetup, signIn, createFirstAdmin, signOut, accessToken],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
