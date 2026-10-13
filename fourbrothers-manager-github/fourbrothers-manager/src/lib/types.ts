// Shared types for FOURBROTHERS MANAGER.
// Every table below has a matching table in supabase/schema.sql (same column names).

export type Role = "admin" | "manager" | "staff" | "viewer";

export type ColumnType = "text" | "number" | "date" | "datetime" | "boolean" | "select";

export interface ColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  width?: number;
  options?: string[]; // for select columns
  hidden?: boolean; // hidden by default in the grid
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  ext_key: string | null; // unique business key: sku, or handle::options, or tally::name
  sku: string | null;
  name: string;
  category: string | null;
  unit: string | null;
  location: string | null;
  opening_qty: number;
  reorder_level: number;
  price: number | null;
  cost: number | null;
  shopify_qty: number | null; // last on hand figure seen in Shopify
  shopify_handle: string | null;
  vendor: string | null;
  status: "active" | "archived";
  image_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductAlias {
  id: string;
  alias: string; // original text as seen in a file
  alias_key: string; // normalised key used for matching
  product_id: string | null; // null means "ignore this name" (not a stock item)
  created_at: string;
}

export type MovementType = "IN" | "OUT" | "ADJUST";

export interface Movement {
  id: string;
  date: string; // YYYY-MM-DD
  type: MovementType;
  product_id: string | null;
  raw_name: string;
  qty: number; // always positive for IN/OUT, signed for ADJUST
  party: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  voucher_type: string | null;
  voucher_no: string | null;
  channel: string | null;
  location: string | null; // warehouse / godown
  source: string; // manual | import | shopify | api
  batch_id: string | null;
  dedupe_key: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ImportBatch {
  id: string;
  filename: string;
  kind: string;
  destination: string;
  row_count: number;
  inserted: number;
  skipped: number;
  summary: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
}

export interface Dataset {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  columns: ColumnDef[];
  source_file: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatasetRow {
  id: string;
  dataset_id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ShipmentStatus = "Pending" | "Packed" | "Dispatched" | "Delivered" | "Returned";

export interface Shipment {
  id: string;
  ship_date: string; // YYYY-MM-DD
  customer_name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  invoice_no: string | null;
  courier: string | null;
  tracking_no: string | null;
  status: ShipmentStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentFile {
  id: string;
  shipment_id: string;
  path: string; // storage path
  name: string;
  mime: string | null;
  size: number | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: string | null;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface TableMap {
  profiles: Profile;
  products: Product;
  product_aliases: ProductAlias;
  stock_movements: Movement;
  import_batches: ImportBatch;
  datasets: Dataset;
  dataset_rows: DatasetRow;
  shipments: Shipment;
  shipment_files: ShipmentFile;
  audit_log: AuditEntry;
  settings: SettingRow;
}
export type TableName = keyof TableMap;

export const STATUS_OPTIONS: ShipmentStatus[] = ["Pending", "Packed", "Dispatched", "Delivered", "Returned"];
