"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Activity, ArrowLeftRight, Boxes, Database, FileUp, Layers, LayoutDashboard, Link2, Loader2, LogOut, Menu, PackageCheck, Search, Settings, Shuffle, Users, X, Truck,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTable } from "@/lib/data/store";
import { unmappedNames } from "@/lib/stock";
import { ROLE_LABELS } from "@/lib/permissions";
import { Badge, Button, Spinner } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  need?: "manage" | "admin";
}

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "signed_out") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status === "loading" || auth.status === "signed_out") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Opening FOURBROTHERS MANAGER" />
      </div>
    );
  }
  if (auth.status === "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center">
          <Loader2 className="mx-auto mb-3 h-6 w-6 text-brand-600" />
          <h1 className="text-lg font-semibold">Waiting for approval</h1>
          <p className="mt-2 text-sm text-ink-600">
            Your account ({auth.profile?.email ?? "new user"}) is created, but an admin has to switch it on and give it a role before you can see any data.
          </p>
          <Button className="mt-4" onClick={() => void auth.signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  return <ShellInner>{children}</ShellInner>;
}

function ShellInner({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const datasets = useTable("datasets");
  const movements = useTable("stock_movements");
  const aliases = useTable("product_aliases");
  useTable("products");

  useEffect(() => setOpen(false), [pathname]);

  const unmapped = useMemo(() => (movements.loaded && aliases.loaded ? unmappedNames(movements.rows, aliases.rows).length : 0), [movements, aliases]);
  const sections = useMemo(() => [...datasets.rows].sort((a, b) => a.name.localeCompare(b.name)), [datasets.rows]);

  const groups: { title: string; items: NavItem[] }[] = [
    { title: "Overview", items: [{ href: "/", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> }] },
    {
      title: "Inventory",
      items: [
        { href: "/stock", label: "Stock items", icon: <Boxes className="h-4 w-4" /> },
        { href: "/movements", label: "Stock in and out", icon: <ArrowLeftRight className="h-4 w-4" /> },
        { href: "/mapping", label: "Name matching", icon: <Shuffle className="h-4 w-4" />, badge: unmapped },
      ],
    },
    {
      title: "Files and data",
      items: [
        { href: "/import", label: "Import files", icon: <FileUp className="h-4 w-4" /> },
        { href: "/sections", label: "All sections", icon: <Layers className="h-4 w-4" /> },
      ],
    },
    { title: "Dispatch", items: [{ href: "/shipments", label: "Shipments and photos", icon: <Truck className="h-4 w-4" /> }] },
    { title: "Connect", items: [{ href: "/integrations", label: "Shopify, Tally, API", icon: <Link2 className="h-4 w-4" /> }] },
    {
      title: "Admin",
      items: [
        { href: "/users", label: "Users", icon: <Users className="h-4 w-4" />, need: "admin" },
        { href: "/activity", label: "Activity log", icon: <Activity className="h-4 w-4" />, need: "manage" },
        { href: "/settings", label: "Settings and backup", icon: <Settings className="h-4 w-4" />, need: "manage" },
      ],
    },
  ];

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));

  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 pb-6">
      {groups.map((g) => {
        const items = g.items.filter((i) => !i.need || auth.can(i.need));
        if (!items.length) return null;
        return (
          <div key={g.title} className="mt-4">
            <p className="px-2 pb-1 text-[11px] font-semibold text-ink-400">{g.title}</p>
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition",
                  active(i.href) ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-100",
                )}
              >
                {i.icon}
                <span className="flex-1 truncate">{i.label}</span>
                {i.badge ? <Badge tone="amber">{i.badge}</Badge> : null}
              </Link>
            ))}
            {g.title === "Files and data" && sections.length > 0 && (
              <div className="mt-1 border-l border-ink-200 pl-2.5 ml-4">
                {sections.map((d) => (
                  <Link
                    key={d.id}
                    href={`/sections/${d.slug}`}
                    className={clsx("flex items-center gap-2 truncate rounded-md px-2 py-1 text-[13px]", active(`/sections/${d.slug}`) ? "bg-brand-50 font-medium text-brand-700" : "text-ink-600 hover:bg-ink-100")}
                  >
                    <Database className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                    <span className="truncate">{d.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2.5 px-5 py-4">
      <PackageCheck className="h-6 w-6 text-brand-600" />
      <div className="leading-tight">
        <p className="text-sm font-bold tracking-wide text-ink-900">FOURBROTHERS</p>
        <p className="text-[11px] font-medium text-brand-600">MANAGER</p>
      </div>
    </Link>
  );

  return (
    <div className="min-h-screen">
      {/* desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-ink-200 bg-white lg:flex">
        {brand}
        {nav}
      </aside>
      {/* mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button className="rounded p-1 hover:bg-ink-100" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-ink-200 bg-white/90 px-4 py-2.5 backdrop-blur">
          <button className="rounded-lg p-1.5 hover:bg-ink-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <form
            className="relative max-w-md flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-400" />
            <input className="input pl-8" placeholder="Search everything: item, invoice, customer, phone, city…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search everything" />
          </form>
          <div className="ml-auto flex items-center gap-3">
            {auth.mode === "local" && (
              <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 sm:inline" title="Supabase keys are not set, so data stays in this browser only.">
                Demo mode: data stays in this browser
              </span>
            )}
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-ink-800">{auth.profile?.full_name || auth.profile?.email}</p>
              <p className="text-xs text-ink-500">{auth.role ? ROLE_LABELS[auth.role] : ""}</p>
            </div>
            {auth.mode === "supabase" && (
              <Button size="sm" onClick={() => void auth.signOut()} aria-label="Sign out">
                <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
              </Button>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6">
          <Suspense fallback={<Spinner />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
