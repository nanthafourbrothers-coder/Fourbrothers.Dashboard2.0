"use client";

// Activity log: who did what and when. Imports, manual adds, edits, stock counts, deletes, backups, user and setting changes.

import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useTable } from "@/lib/data/store";
import { resolvePeriod, type PeriodState } from "@/lib/analysis";
import { addDaysYmd, formatNumber, todayYmd } from "@/lib/parse/normalize";
import type { AuditEntry } from "@/lib/types";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { PeriodPicker } from "@/components/PeriodPicker";
import { Badge, EmptyState, PageHeader, Stat, type Tone } from "@/components/ui";

type Kind = "Import" | "Added by hand" | "Edit" | "Stock count" | "Delete" | "Backup" | "Users and settings" | "Other";

function kindOf(action: string): Kind {
  const a = action.toLowerCase();
  if (a.includes("import") || a.includes("stock update from file") || a.includes("shopify") || a.includes("api")) return "Import";
  if (a.startsWith("delete") || a.startsWith("remove") || a.includes("merge")) return "Delete";
  if (a.startsWith("edit")) return "Edit";
  if (a.includes("stock count")) return "Stock count";
  if (a.includes("backup") || a.includes("restore")) return "Backup";
  if (a.includes("user") || a.includes("password") || a.includes("setting")) return "Users and settings";
  if (a.startsWith("add") || a.startsWith("create")) return "Added by hand";
  return "Other";
}

const TONE: Record<Kind, Tone> = { Import: "blue", "Added by hand": "green", Edit: "amber", "Stock count": "brand", Delete: "red", Backup: "gray", "Users and settings": "gray", Other: "gray" };
const KINDS: Kind[] = ["Import", "Added by hand", "Edit", "Stock count", "Delete", "Backup", "Users and settings", "Other"];

type Row = AuditEntry & { kind: Kind; day: string };

export default function ActivityPage() {
  const auth = useAuth();
  const log = useTable("audit_log");
  const [periodState, setPeriodState] = useState<PeriodState>({ id: "all", from: "", to: todayYmd() });
  const [kind, setKind] = useState<Kind | "all">("all");
  const period = useMemo(() => resolvePeriod(periodState), [periodState]);

  const all: Row[] = useMemo(() => log.rows.map((a) => ({ ...a, kind: kindOf(a.action), day: a.at.slice(0, 10) })), [log.rows]);
  const rows = useMemo(() => all.filter((r) => (kind === "all" || r.kind === kind) && (!period.from || r.day >= period.from) && (!period.to || r.day <= period.to)), [all, kind, period]);

  const today = todayYmd();
  const week = addDaysYmd(today, -6);
  const stats = useMemo(() => {
    const byUser = new Map<string, number>();
    for (const r of all) if (r.day >= week) byUser.set(r.user_email ?? "unknown", (byUser.get(r.user_email ?? "unknown") ?? 0) + 1);
    const top = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      today: all.filter((r) => r.day === today).length,
      week: all.filter((r) => r.day >= week).length,
      deletes: all.filter((r) => r.day >= week && r.kind === "Delete").length,
      top: top ? `${top[0]} (${top[1]})` : "No activity yet",
    };
  }, [all, today, week]);

  const counts = useMemo(() => {
    const c = new Map<Kind, number>();
    for (const r of all) c.set(r.kind, (c.get(r.kind) ?? 0) + 1);
    return c;
  }, [all]);

  if (!auth.can("manage")) {
    return (
      <div className="card">
        <EmptyState title="Managers and admins only" />
      </div>
    );
  }

  const columns: GridColumn<Row>[] = [
    { key: "at", label: "When", type: "datetime", get: (a) => a.at.slice(0, 19).replace("T", " "), width: 160 },
    { key: "user_email", label: "Who" },
    { key: "kind", label: "Kind", render: (a) => <Badge tone={TONE[a.kind]}>{a.kind}</Badge> },
    { key: "action", label: "What" },
    { key: "entity", label: "Where", hidden: true },
    { key: "detail", label: "Details", width: 420 },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Activity log" subtitle="Everything done on the website, with who did it and when: imports, entries added by hand, edits, stock counts, deletes, backups, user and setting changes." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Actions today" value={formatNumber(stats.today)} />
        <Stat label="Last 7 days" value={formatNumber(stats.week)} />
        <Stat label="Deletes (7 days)" value={formatNumber(stats.deletes)} tone={stats.deletes ? "amber" : undefined} />
        <Stat label="Most active (7 days)" value={<span className="text-base">{stats.top}</span>} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker value={periodState} onChange={setPeriodState} />
        <div className="flex flex-wrap gap-1.5 text-sm">
          <button onClick={() => setKind("all")} className={`rounded-full border px-3 py-1 ${kind === "all" ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
            All ({formatNumber(all.length)})
          </button>
          {KINDS.filter((k) => counts.get(k)).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 ${kind === k ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
              {k} ({counts.get(k)})
            </button>
          ))}
        </div>
      </div>
      <DataGrid key={kind} id="audit" title="activity" rows={rows} rowId={(a) => a.id} columns={columns} loading={!log.loaded} defaultSort={{ key: "at", dir: "desc" }} emptyText="Nothing has been logged for this selection." />
    </div>
  );
}
