import type { ColumnDef } from "../types";

/** Column keys that every "movement ready" table (Tally register, purchase book, ...) uses. */
export const MOVEMENT_COLUMNS: ColumnDef[] = [
  { key: "date", label: "Date", type: "date" },
  { key: "item", label: "Item", type: "text" },
  { key: "qty", label: "Qty", type: "number" },
  { key: "party", label: "Party", type: "text" },
  { key: "voucher_type", label: "Voucher type", type: "text" },
  { key: "voucher_no", label: "Voucher no", type: "text" },
  { key: "channel", label: "Channel", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "pincode", label: "Pincode", type: "text" },
  { key: "gstin", label: "GSTIN", type: "text" },
  { key: "address", label: "Address", type: "text" },
  { key: "notes", label: "Notes", type: "text" },
];

export function pickColumns(keys: string[]): ColumnDef[] {
  return keys.map((k) => MOVEMENT_COLUMNS.find((c) => c.key === k)!).filter(Boolean);
}
