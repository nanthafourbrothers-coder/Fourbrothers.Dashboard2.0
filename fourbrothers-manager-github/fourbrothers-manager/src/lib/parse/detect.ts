// Looks at a sheet and picks the best reader for it.

import type { RawSheet } from "./rawFile";
import { buildGenericTable, type ParsedTable } from "./table";
import { parseTallyRegister } from "./tally";
import { parsePurchaseBook } from "./purchase";
import { parseShopifyInventory, parseShopifyOrders, parseShopifyProducts } from "./shopify";

export function interpretSheet(raw: RawSheet): ParsedTable {
  const readers = [parseTallyRegister, parsePurchaseBook, parseShopifyInventory, parseShopifyProducts, parseShopifyOrders];
  for (const read of readers) {
    try {
      const t = read(raw);
      if (t && t.rows.length) return t;
    } catch (e) {
      console.warn("reader failed, falling back to generic table", e);
    }
  }
  return buildGenericTable(raw);
}

/** Friendly default name for a new section made from this table. */
export function suggestSectionName(t: ParsedTable): string {
  switch (t.kind) {
    case "shopify_orders":
      return "Shopify Orders";
    case "shopify_products":
      return "Shopify Products";
    case "shopify_inventory":
      return "Shopify Inventory";
    case "tally_register":
      return "Sales Register";
    case "purchase_book":
      return "Purchase Book";
    default: {
      const base = t.source.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+\d{4}-\d{2}-\d{2}.*$/, "").trim();
      const name = base || t.sheet;
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
}
