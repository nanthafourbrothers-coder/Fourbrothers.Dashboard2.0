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

export function useStockRows(includeArchived = false): { rows: StockRow[]; loaded: boolean; since: string | null } {
  const products = useTable("products");
  const movements = useTable("stock_movements");
  const settings = useTable("settings");
  const since = useStockSince();
  const rows = useMemo(() => computeStock(products.rows.filter((p) => includeArchived || p.status === "active"), movements.rows, { since }), [products.rows, movements.rows, includeArchived, since]);
  return { rows, loaded: products.loaded && movements.loaded && settings.loaded, since };
}
