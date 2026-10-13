"use client";

import { useAuth } from "@/lib/auth";
import { useTable } from "@/lib/data/store";
import type { AuditEntry } from "@/lib/types";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { EmptyState, PageHeader } from "@/components/ui";

export default function ActivityPage() {
  const auth = useAuth();
  const log = useTable("audit_log");
  if (!auth.can("manage")) {
    return (
      <div className="card">
        <EmptyState title="Managers and admins only" />
      </div>
    );
  }
  const columns: GridColumn<AuditEntry>[] = [
    { key: "at", label: "When", type: "datetime", get: (a) => a.at.slice(0, 19).replace("T", " "), width: 160 },
    { key: "user_email", label: "Who" },
    { key: "action", label: "What" },
    { key: "entity", label: "Where" },
    { key: "detail", label: "Details", width: 420 },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Activity log" subtitle="Imports, undo, deletes, merges, user changes and API calls, with who did them and when." />
      <DataGrid id="audit" title="activity" rows={log.rows} rowId={(a) => a.id} columns={columns} loading={!log.loaded} defaultSort={{ key: "at", dir: "desc" }} emptyText="Nothing has been logged yet." />
    </div>
  );
}
