"use client";

// The table used on every screen: search, per-column filters, sorting, column chooser, inline editing,
// selection, totals, pagination and export. Works on any rows through column accessors.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Filter, Plus, Search, Trash2, X } from "lucide-react";
import type { ColumnType } from "@/lib/types";
import { formatDateDisplay, formatNumber } from "@/lib/parse/normalize";
import { exportTable, type ExportFormat } from "@/lib/export";
import { Button, Popover, Spinner, useDebounced, useLocalPref, useUi } from "./ui";

export interface GridColumn<T> {
  key: string;
  label: string;
  type?: ColumnType;
  width?: number;
  editable?: boolean;
  options?: string[];
  get?: (row: T) => unknown;
  render?: (row: T) => ReactNode;
  format?: (value: unknown, row: T) => string;
  hidden?: boolean;
  align?: "left" | "right";
  sum?: boolean;
  filterable?: boolean;
  /** number of decimals to show for numbers (default up to 2) */
  digits?: number;
}

interface Filter {
  text?: string;
  set?: string[];
  min?: string;
  max?: string;
}

export interface BulkAction {
  label: string;
  onClick: (ids: string[]) => void | Promise<void>;
  danger?: boolean;
}

interface Props<T> {
  id: string;
  title: string;
  rows: T[];
  rowId: (row: T) => string;
  columns: GridColumn<T>[];
  loading?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: (row: T, key: string, value: unknown) => Promise<void>;
  onDelete?: (ids: string[]) => Promise<void>;
  onAdd?: () => void;
  addLabel?: string;
  onRowClick?: (row: T) => void;
  bulkActions?: BulkAction[];
  toolbarExtra?: ReactNode;
  rowActions?: (row: T) => ReactNode;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  initialSearch?: string;
  initialFilters?: Record<string, Filter>;
  pageSize?: number;
  emptyText?: ReactNode;
  rowClass?: (row: T) => string | undefined;
  maxHeightClass?: string;
  /** called with the rows left after search and filters, so a screen can show its own totals */
  onViewChange?: (rows: T[]) => void;
}

const val = <T,>(c: GridColumn<T>, row: T): unknown => (c.get ? c.get(row) : (row as Record<string, unknown>)[c.key]);

function displayText<T>(c: GridColumn<T>, row: T): string {
  const v = val(c, row);
  if (c.format) return c.format(v, row);
  if (v == null || v === "") return "";
  switch (c.type) {
    case "number":
      return typeof v === "number" ? formatNumber(v, c.digits ?? 2) : String(v);
    case "date":
      return formatDateDisplay(String(v));
    case "boolean":
      return v ? "Yes" : "No";
    default:
      return String(v);
  }
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function applyFilter<T>(c: GridColumn<T>, f: Filter, row: T): boolean {
  const v = val(c, row);
  const s = v == null ? "" : String(v);
  if (f.text) {
    const t = f.text.toLowerCase();
    if (!s.toLowerCase().includes(t) && !displayText(c, row).toLowerCase().includes(t)) return false;
  }
  if (f.set && f.set.length && !f.set.includes(s)) return false;
  if (f.min || f.max) {
    if (c.type === "number") {
      if (!isNum(v)) return false;
      if (f.min && v < Number(f.min)) return false;
      if (f.max && v > Number(f.max)) return false;
    } else {
      const d = s.slice(0, 10);
      if (!d) return false;
      if (f.min && d < f.min) return false;
      if (f.max && d > f.max) return false;
    }
  }
  return true;
}

function filterSummary<T>(c: GridColumn<T>, f: Filter): string {
  const parts: string[] = [];
  if (f.text) parts.push(`contains "${f.text}"`);
  if (f.set?.length) parts.push(f.set.length === 1 ? `= ${f.set[0] || "(blank)"}` : `${f.set.length} values`);
  if (f.min || f.max) parts.push(`${f.min || "…"} to ${f.max || "…"}`);
  return parts.join(", ");
}

export function DataGrid<T>(p: Props<T>) {
  const { toast, confirm } = useUi();
  const [search, setSearch] = useState(p.initialSearch ?? "");
  const q = useDebounced(search, 150).trim().toLowerCase();
  const [filters, setFilters] = useState<Record<string, Filter>>(p.initialFilters ?? {});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(p.defaultSort ?? null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useLocalPref<number>(`grid:${p.id}:size`, p.pageSize ?? 50);
  const [hiddenKeys, setHiddenKeys] = useLocalPref<string[] | null>(`grid:${p.id}:hidden`, null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const hidden = useMemo(() => new Set(hiddenKeys ?? p.columns.filter((c) => c.hidden).map((c) => c.key)), [hiddenKeys, p.columns]);
  const visible = useMemo(() => p.columns.filter((c) => !hidden.has(c.key)), [p.columns, hidden]);

  // search text for every row, built once per data change
  const blobs = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of p.rows) {
      const parts: string[] = [];
      for (const c of p.columns) {
        const v = val(c, r);
        if (v == null || v === "") continue;
        parts.push(String(v));
        const d = displayText(c, r);
        if (d && d !== String(v)) parts.push(d);
      }
      m.set(p.rowId(r), parts.join(" \u0001 ").toLowerCase());
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rows, p.columns]);

  const view = useMemo(() => {
    let out = p.rows;
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      out = out.filter((r) => {
        const b = blobs.get(p.rowId(r)) ?? "";
        return words.every((w) => b.includes(w));
      });
    }
    for (const [key, f] of Object.entries(filters)) {
      const c = p.columns.find((x) => x.key === key);
      if (c) out = out.filter((r) => applyFilter(c, f, r));
    }
    if (sort) {
      const c = p.columns.find((x) => x.key === sort.key);
      if (c) {
        const dir = sort.dir === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => {
          const va = val(c, a);
          const vb = val(c, b);
          if (va == null || va === "") return vb == null || vb === "" ? 0 : 1;
          if (vb == null || vb === "") return -1;
          if (isNum(va) && isNum(vb)) return (va - vb) * dir;
          return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * dir;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rows, p.columns, q, filters, sort, blobs]);

  useEffect(() => setPage(0), [q, filters, sort, pageSize]);
  const onViewChange = p.onViewChange;
  // Report the filtered rows to the screen, but only when they really changed. Without this guard a screen that
  // keeps the rows in state and rebuilds its columns on every render would loop forever and freeze page changes.
  const lastView = useRef<T[] | null>(null);
  useEffect(() => {
    const prev = lastView.current;
    if (prev && prev.length === view.length && prev.every((r, i) => r === view[i])) return;
    lastView.current = view;
    onViewChange?.(view);
  }, [view, onViewChange]);
  const pages = Math.max(1, Math.ceil(view.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const pageRows = view.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of visible) {
      if (!c.sum) continue;
      t[c.key] = view.reduce((s, r) => {
        const v = val(c, r);
        return s + (isNum(v) ? v : 0);
      }, 0);
    }
    return t;
  }, [view, visible]);

  const activeFilters = Object.entries(filters).filter(([, f]) => f.text || f.set?.length || f.min || f.max);
  const allSelected = view.length > 0 && view.every((r) => selected.has(p.rowId(r)));

  const startEdit = (row: T, c: GridColumn<T>) => {
    if (!p.canEdit || !c.editable || !p.onEdit) return;
    const v = val(c, row);
    setEditing({ id: p.rowId(row), key: c.key });
    setDraft(v == null ? "" : String(v));
  };

  const commitEdit = useCallback(
    async (row: T, c: GridColumn<T>, raw: string) => {
      setEditing(null);
      const cur = val(c, row);
      const before = cur == null ? "" : String(cur);
      if (raw === before) return;
      let value: unknown = raw;
      if (c.type === "number") {
        if (raw.trim() === "") value = null;
        else {
          const n = Number(raw.replace(/,/g, ""));
          if (!Number.isFinite(n)) return toast("error", `"${raw}" is not a number.`);
          value = n;
        }
      } else if (c.type === "date" && raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return toast("error", "Use a valid date.");
      else if (c.type === "boolean") value = raw === "true";
      else if (raw.trim() === "") value = null;
      setSaving(true);
      try {
        await p.onEdit!(row, c.key, value);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : "Could not save the change.");
      } finally {
        setSaving(false);
      }
    },
    [p, toast],
  );

  const doExport = async (format: ExportFormat) => {
    try {
      await exportTable(format, {
        filename: `${p.id}-${new Date().toISOString().slice(0, 10)}`,
        title: p.title,
        columns: visible.map((c) => ({ key: c.key, label: c.label, type: c.type ?? "text" })),
        rows: view.map((r) => {
          const o: Record<string, unknown> = {};
          for (const c of visible) o[c.key] = c.format ? c.format(val(c, r), r) : val(c, r);
          return o;
        }),
      });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Export failed.");
    }
  };

  const deleteSelected = async () => {
    if (!p.onDelete) return;
    const ids = [...selected];
    if (!(await confirm(`Delete ${ids.length} record${ids.length === 1 ? "" : "s"}? This cannot be undone.`, { danger: true, confirmLabel: "Delete", title: "Delete records" }))) return;
    try {
      await p.onDelete(ids);
      setSelected(new Set());
      toast("success", `${ids.length} deleted.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Delete failed.");
    }
  };

  const setFilter = (key: string, f: Filter | null) =>
    setFilters((cur) => {
      const next = { ...cur };
      if (!f || !(f.text || f.set?.length || f.min || f.max)) delete next[key];
      else next[key] = f;
      return next;
    });

  const hasActions = Boolean(p.rowActions);
  const selectable = Boolean(p.onDelete || p.bulkActions?.length);

  return (
    <div className="card overflow-hidden">
      {/* toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-400" />
          <input className="input pl-8" placeholder={`Search ${p.title.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          {search && (
            <button className="absolute right-2 top-2 text-ink-400 hover:text-ink-700" onClick={() => setSearch("")} aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Popover
          width={230}
          trigger={(open, toggle) => (
            <Button onClick={toggle} className={clsx(open && "bg-ink-100")}>
              <Columns3 className="h-4 w-4" /> Columns
            </Button>
          )}
        >
          {() => (
            <div className="max-h-72 overflow-y-auto">
              {p.columns.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-ink-50">
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={() => {
                      const next = new Set(hidden);
                      if (next.has(c.key)) next.delete(c.key);
                      else next.add(c.key);
                      setHiddenKeys([...next]);
                    }}
                  />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
              <div className="mt-1 flex gap-2 border-t border-ink-100 pt-2">
                <Button size="sm" onClick={() => setHiddenKeys([])}>
                  Show all
                </Button>
                <Button size="sm" onClick={() => setHiddenKeys(p.columns.filter((c) => c.hidden).map((c) => c.key))}>
                  Reset
                </Button>
              </div>
            </div>
          )}
        </Popover>
        <Popover
          align="right"
          width={140}
          trigger={(open, toggle) => (
            <Button onClick={toggle} className={clsx(open && "bg-ink-100")}>
              <Download className="h-4 w-4" /> Export
            </Button>
          )}
        >
          {(close) => (
            <div className="flex flex-col">
              {(
                [
                  ["xlsx", "Excel (.xlsx)"],
                  ["csv", "CSV"],
                  ["pdf", "PDF"],
                  ["json", "JSON"],
                ] as [ExportFormat, string][]
              ).map(([f, label]) => (
                <button
                  key={f}
                  className="rounded px-2 py-1.5 text-left text-sm hover:bg-ink-50"
                  onClick={() => {
                    close();
                    void doExport(f);
                  }}
                >
                  {label}
                </button>
              ))}
              <p className="px-2 pt-1 text-[11px] text-ink-400">{formatNumber(view.length)} rows as filtered</p>
            </div>
          )}
        </Popover>
        {p.toolbarExtra}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-ink-500 sm:inline">
            {view.length === p.rows.length ? `${formatNumber(p.rows.length)} rows` : `${formatNumber(view.length)} of ${formatNumber(p.rows.length)}`}
          </span>
          {p.onAdd && (
            <Button variant="primary" onClick={p.onAdd}>
              <Plus className="h-4 w-4" /> {p.addLabel ?? "Add"}
            </Button>
          )}
        </div>
      </div>

      {/* active filters */}
      {activeFilters.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2">
          <Filter className="h-3.5 w-3.5 text-ink-500" />
          {activeFilters.map(([key, f]) => {
            const c = p.columns.find((x) => x.key === key)!;
            return (
              <span key={key} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2 py-0.5 text-xs text-ink-700">
                <b className="font-medium">{c.label}</b> {filterSummary(c, f)}
                <button onClick={() => setFilter(key, null)} aria-label={`Remove filter ${c.label}`} className="text-ink-400 hover:text-ink-800">
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setFilters({})}>
            Clear all filters
          </button>
        </div>
      )}

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm">
          <b>{selected.size}</b> selected
          {p.bulkActions?.map((a) => (
            <Button key={a.label} size="sm" variant={a.danger ? "danger" : "default"} onClick={() => void a.onClick([...selected])}>
              {a.label}
            </Button>
          ))}
          {p.onDelete && (
            <Button size="sm" variant="danger" onClick={deleteSelected}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {/* table */}
      <div className={clsx("scroll-thin overflow-auto", p.maxHeightClass ?? "max-h-[calc(100vh-17rem)] min-h-[200px]")}>
        {p.loading ? (
          <Spinner />
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                {selectable && (
                  <th className="th w-9 px-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(view.map(p.rowId)))}
                    />
                  </th>
                )}
                {visible.map((c) => {
                  const f = filters[c.key];
                  const active = Boolean(f && (f.text || f.set?.length || f.min || f.max));
                  return (
                    <th key={c.key} className={clsx("th", c.align === "right" || c.type === "number" ? "text-right" : "")} style={{ minWidth: c.width }}>
                      <div className={clsx("flex items-center gap-1", (c.align === "right" || c.type === "number") && "justify-end")}>
                        <button
                          className="inline-flex items-center gap-1 hover:text-ink-900"
                          onClick={() => setSort((s) => (s?.key !== c.key ? { key: c.key, dir: "asc" } : s.dir === "asc" ? { key: c.key, dir: "desc" } : null))}
                          title="Sort"
                        >
                          {c.label}
                          {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                        </button>
                        {c.filterable !== false && (
                          <FilterPopover column={c} rows={p.rows} filter={f} onChange={(nf) => setFilter(c.key, nf)} active={active} />
                        )}
                      </div>
                    </th>
                  );
                })}
                {hasActions && <th className="th w-10" />}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const id = p.rowId(row);
                return (
                  <tr key={id} className={clsx("group hover:bg-ink-50/70", selected.has(id) && "bg-brand-50/60", p.onRowClick && "cursor-pointer", p.rowClass?.(row))} onClick={() => p.onRowClick?.(row)}>
                    {selectable && (
                      <td className="td w-9 px-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={selected.has(id)}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(id)) n.delete(id);
                              else n.add(id);
                              return n;
                            })
                          }
                        />
                      </td>
                    )}
                    {visible.map((c) => {
                      const isEditing = editing?.id === id && editing.key === c.key;
                      const align = c.align === "right" || c.type === "number" ? "text-right tabular-nums" : "";
                      const editable = p.canEdit && c.editable;
                      return (
                        <td
                          key={c.key}
                          className={clsx("td max-w-[360px]", align, editable && "cursor-text")}
                          onDoubleClick={() => startEdit(row, c)}
                          onClick={(e) => isEditing && e.stopPropagation()}
                          title={editable ? "Double click to edit" : undefined}
                        >
                          {isEditing ? (
                            <CellEditor
                              column={c}
                              value={draft}
                              onChange={setDraft}
                              onCommit={(v) => void commitEdit(row, c, v)}
                              onCancel={() => setEditing(null)}
                            />
                          ) : c.render ? (
                            c.render(row)
                          ) : (
                            <span className="block truncate">{displayText(c, row)}</span>
                          )}
                        </td>
                      );
                    })}
                    {hasActions && (
                      <td className="td w-10 px-2" onClick={(e) => e.stopPropagation()}>
                        {p.rowActions!(row)}
                      </td>
                    )}
                  </tr>
                );
              })}
              {!pageRows.length && (
                <tr>
                  <td className="td py-10 text-center text-ink-500" colSpan={visible.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0)}>
                    {p.rows.length === 0 ? (p.emptyText ?? "Nothing here yet.") : "No rows match the search or filters."}
                  </td>
                </tr>
              )}
            </tbody>
            {Object.keys(totals).length > 0 && view.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr>
                  {selectable && <td className="border-t border-ink-200 bg-ink-50" />}
                  {visible.map((c, i) => (
                    <td key={c.key} className={clsx("border-t border-ink-200 bg-ink-50 px-3 py-2 text-sm font-semibold", (c.type === "number" || c.align === "right") && "text-right tabular-nums")}>
                      {c.sum ? formatNumber(totals[c.key], c.digits ?? 2) : i === 0 ? "Total of filtered rows" : ""}
                    </td>
                  ))}
                  {hasActions && <td className="border-t border-ink-200 bg-ink-50" />}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* pagination */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-3 py-2 text-xs text-ink-600">
        <div className="flex items-center gap-2">
          Rows per page
          <select className="rounded border border-ink-200 bg-white px-1 py-0.5" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[25, 50, 100, 250].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {saving && <span className="text-ink-400">Saving…</span>}
        </div>
        <div className="flex items-center gap-1">
          <span>
            {view.length ? safePage * pageSize + 1 : 0}–{Math.min(view.length, (safePage + 1) * pageSize)} of {formatNumber(view.length)}
          </span>
          <Button size="sm" variant="ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CellEditor<T>({ column, value, onChange, onCommit, onCancel }: { column: GridColumn<T>; value: string; onChange: (v: string) => void; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select?.();
  }, []);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onCommit(v);
  };
  const common = {
    ref,
    value,
    className: "input !py-0.5",
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onBlur: () => finish(value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") finish(value);
      if (e.key === "Escape") {
        done.current = true;
        onCancel();
      }
    },
  };
  if (column.options) {
    return (
      <select {...common}>
        <option value="" />
        {column.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (column.type === "boolean") {
    return (
      <select {...common}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return <input {...common} type={column.type === "date" ? "date" : column.type === "number" ? "number" : "text"} step={column.type === "number" ? "any" : undefined} />;
}

function FilterPopover<T>({ column, rows, filter, onChange, active }: { column: GridColumn<T>; rows: T[]; filter?: Filter; onChange: (f: Filter | null) => void; active: boolean }) {
  const isNumber = column.type === "number";
  const isDate = column.type === "date" || column.type === "datetime";
  return (
    <Popover
      width={isNumber || isDate ? 240 : 270}
      trigger={(open, toggle) => (
        <button onClick={toggle} className={clsx("rounded p-0.5 hover:bg-ink-200", active ? "text-brand-600" : "text-ink-400", open && "bg-ink-200")} aria-label={`Filter ${column.label}`} title="Filter">
          <Filter className="h-3.5 w-3.5" />
        </button>
      )}
    >
      {(close) =>
        isNumber || isDate ? (
          <div className="space-y-2 p-1 font-normal">
            <p className="text-xs font-semibold text-ink-700">{column.label}</p>
            <div className="flex items-center gap-2">
              <input className="input" type={isDate ? "date" : "number"} placeholder="From" value={filter?.min ?? ""} onChange={(e) => onChange({ ...filter, min: e.target.value })} aria-label="From" />
              <span className="text-xs text-ink-400">to</span>
              <input className="input" type={isDate ? "date" : "number"} placeholder="To" value={filter?.max ?? ""} onChange={(e) => onChange({ ...filter, max: e.target.value })} aria-label="To" />
            </div>
            <div className="flex justify-between">
              <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
                Clear
              </Button>
              <Button size="sm" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <ValueFilter column={column} rows={rows} filter={filter} onChange={onChange} close={close} />
        )
      }
    </Popover>
  );
}

function ValueFilter<T>({ column, rows, filter, onChange, close }: { column: GridColumn<T>; rows: T[]; filter?: Filter; onChange: (f: Filter | null) => void; close: () => void }) {
  const [find, setFind] = useState("");
  const options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = val(column, r);
      const s = v == null ? "" : String(v);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows, column]);
  const shown = options.filter(([v]) => !find || v.toLowerCase().includes(find.toLowerCase())).slice(0, 150);
  const set = filter?.set ?? [];
  return (
    <div className="space-y-2 p-1 font-normal">
      <p className="text-xs font-semibold text-ink-700">{column.label}</p>
      <input className="input" placeholder="Contains…" value={filter?.text ?? ""} onChange={(e) => onChange({ ...filter, text: e.target.value })} aria-label="Contains" />
      {options.length > 1 && options.length <= 5000 && (
        <>
          <input className="input" placeholder="Find a value…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a value" />
          <div className="max-h-48 overflow-y-auto rounded border border-ink-100">
            {shown.map(([v, n]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-ink-50">
                <input
                  type="checkbox"
                  checked={set.includes(v)}
                  onChange={() => onChange({ ...filter, set: set.includes(v) ? set.filter((x) => x !== v) : [...set, v] })}
                />
                <span className="flex-1 truncate">{v === "" ? "(blank)" : v}</span>
                <span className="text-xs text-ink-400">{n}</span>
              </label>
            ))}
            {options.length > shown.length && <p className="px-2 py-1 text-xs text-ink-400">Showing the first {shown.length}. Type to narrow.</p>}
          </div>
        </>
      )}
      <div className="flex justify-between">
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Clear
        </Button>
        <Button size="sm" onClick={close}>
          Done
        </Button>
      </div>
    </div>
  );
}
