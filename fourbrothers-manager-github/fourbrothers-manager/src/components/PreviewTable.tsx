"use client";

// Editable preview shown before anything is saved. Click a cell to fix it, remove rows you do not want.

import { useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { formatDateDisplay, formatNumber } from "@/lib/parse/normalize";
import type { ColumnType } from "@/lib/types";
import type { RowStatus } from "@/lib/importPlan";
import { Badge, Button } from "./ui";

export interface PreviewColumn {
  key: string;
  label: string;
  type?: ColumnType;
  editable?: boolean;
  /** computed columns shown but not part of the file */
  computed?: boolean;
}

interface Props {
  columns: PreviewColumn[];
  rows: Record<string, unknown>[];
  statuses?: RowStatus[];
  onEdit?: (index: number, key: string, raw: string) => void;
  onDelete?: (index: number) => void;
  pageSize?: number;
}

function show(c: PreviewColumn, v: unknown): string {
  if (v == null || v === "") return "";
  if (c.type === "number" && typeof v === "number") return formatNumber(v, 3);
  if (c.type === "date") return formatDateDisplay(String(v));
  return String(v);
}

export function PreviewTable({ columns, rows, statuses, onEdit, onDelete, pageSize = 50 }: Props) {
  const [page, setPage] = useState(0);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [edit, setEdit] = useState<{ i: number; key: string; v: string } | null>(null);

  const indexes = rows.map((_, i) => i).filter((i) => !problemsOnly || (statuses?.[i] && statuses[i].status !== "ok"));
  const pages = Math.max(1, Math.ceil(indexes.length / pageSize));
  const p = Math.min(page, pages - 1);
  const slice = indexes.slice(p * pageSize, p * pageSize + pageSize);
  const problems = statuses ? statuses.filter((s) => s && s.status !== "ok").length : 0;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-ink-600">
        <span>
          Showing {slice.length ? p * pageSize + 1 : 0}–{p * pageSize + slice.length} of {formatNumber(indexes.length)} rows
        </span>
        {statuses && (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={problemsOnly}
              onChange={(e) => {
                setProblemsOnly(e.target.checked);
                setPage(0);
              }}
            />
            Only rows that need attention ({problems})
          </label>
        )}
        {onEdit && <span className="text-ink-400">Click a cell to correct it before saving.</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            {p + 1} / {pages}
          </span>
          <Button size="sm" variant="ghost" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="scroll-thin max-h-[420px] overflow-auto rounded-lg border border-ink-200">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="th w-10">#</th>
              {statuses && <th className="th">Status</th>}
              {columns.map((c) => (
                <th key={c.key} className={clsx("th", c.type === "number" && "text-right")}>
                  {c.label}
                </th>
              ))}
              {onDelete && <th className="th w-8" />}
            </tr>
          </thead>
          <tbody>
            {slice.map((i) => {
              const r = rows[i];
              const st = statuses?.[i];
              return (
                <tr key={i} className={clsx(st?.status === "invalid" && "bg-red-50/60", st?.status === "duplicate" && "bg-ink-50 text-ink-500", st?.status === "changed" && "bg-amber-50/70")}>
                  <td className="td text-xs text-ink-400">{i + 1}</td>
                  {statuses && (
                    <td className="td whitespace-nowrap" title={st?.message}>
                      {st?.status === "ok" && <Badge tone="green">{st.known === false ? "New name" : "Ready"}</Badge>}
                      {st?.status === "duplicate" && <Badge>Already saved</Badge>}
                      {st?.status === "invalid" && <Badge tone="red">Fix</Badge>}
                      {st?.status === "changed" && <Badge tone="amber">Changed</Badge>}
                      {st?.message && st.status === "invalid" && <span className="ml-2 text-xs text-red-700">{st.message}</span>}
                    </td>
                  )}
                  {columns.map((c) => {
                    const editing = edit?.i === i && edit.key === c.key;
                    const canEdit = onEdit && c.editable !== false && !c.computed;
                    return (
                      <td key={c.key} className={clsx("td max-w-[280px]", c.type === "number" && "text-right tabular-nums", canEdit && "cursor-text")} onClick={() => canEdit && !editing && setEdit({ i, key: c.key, v: r[c.key] == null ? "" : String(r[c.key]) })}>
                        {editing ? (
                          <input
                            className="input !py-0.5"
                            autoFocus
                            value={edit.v}
                            onChange={(e) => setEdit({ ...edit, v: e.target.value })}
                            onBlur={() => {
                              onEdit!(i, c.key, edit.v);
                              setEdit(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEdit(null);
                            }}
                          />
                        ) : (
                          <span className="block truncate">{show(c, r[c.key])}</span>
                        )}
                      </td>
                    );
                  })}
                  {onDelete && (
                    <td className="td">
                      <button className="text-ink-300 hover:text-red-600" onClick={() => onDelete(i)} aria-label="Remove this row" title="Remove this row from the import">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {!slice.length && (
              <tr>
                <td className="td py-8 text-center text-ink-500" colSpan={columns.length + 3}>
                  Nothing to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
