"use client";

// Stock on hand for every item, from the three tables it depends on and the "count stock from" setting.

import { useMemo } from "react";
import { computeStock, type StockRow } from "../stock";
import { useTable } from "./store";

export function useStockSince(): string | null {
  const settings = useTable("settings").rows;
  const v = settings.find((r) => r.key === "stock_from")?.value;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export const DEFAULT_LOW_LIMIT = 100;

/** Stock under this many units shows in "Needs attention". Admin or manager can change it. Items with their own reorder level use that instead. */
export function useLowLimit(): number {
  const settings = useTable("settings").rows;
  const v = settings.find((r) => r.key === "low_stock_limit")?.value;
  return typeof v === "number" && v >= 0 ? v : DEFAULT_LOW_LIMIT;
}

/** Imported data (stock items, stock in/out, sections) is read only unless an admin switches the lock off in Settings. Manual adds are always allowed. */
export function useDataLocked(): boolean {
  const settings = useTable("settings").rows;
  const v = settings.find((r) => r.key === "lock_data")?.value;
  return v !== false;
}

export function useStockRows(includeArchived = false): { rows: StockRow[]; loaded: boolean; since: string | null } {
  const products = useTable("products");
  const movements = useTable("stock_movements");
  const settings = useTable("settings");
  const since = useStockSince();
  const lowLimit = useLowLimit();
  const rows = useMemo(() => computeStock(products.rows.filter((p) => includeArchived || p.status === "active"), movements.rows, { since, lowLimit }), [products.rows, movements.rows, includeArchived, since, lowLimit]);
  return { rows, loaded: products.loaded && movements.loaded && settings.loaded, since };
}
