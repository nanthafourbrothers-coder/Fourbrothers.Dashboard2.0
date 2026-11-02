import type { Role } from "./types";

/** write  = add and edit records (staff and above)
 *  manage = delete, import, change stock items and sections (manager and above)
 *  admin  = users and settings */
export type Level = "write" | "manage" | "admin";

export function roleCan(role: Role | null | undefined, level: Level): boolean {
  if (!role) return false;
  if (level === "write") return role === "admin" || role === "manager" || role === "staff";
  if (level === "manage") return role === "admin" || role === "manager";
  return role === "admin";
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  viewer: "View only",
};

export const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, including users and settings.",
  manager: "Import files, edit stock items and sections, delete records, run syncs.",
  staff: "Add and edit stock movements, shipments and section rows. Cannot delete.",
  viewer: "Look at everything and download data. Cannot add or change anything.",
};

/** What each role can do, shown as a table on the Users screen. */
export const ROLE_MATRIX: { what: string; admin: boolean; manager: boolean; staff: boolean; viewer: boolean }[] = [
  { what: "See stock, registers, charts, shipments and sections", admin: true, manager: true, staff: true, viewer: true },
  { what: "Download CSV / Excel / PDF of any table", admin: true, manager: true, staff: true, viewer: true },
  { what: "Add receipts, sales, stock counts and section rows by hand", admin: true, manager: true, staff: true, viewer: false },
  { what: "Add and edit shipments, attach photos and files", admin: true, manager: true, staff: true, viewer: false },
  { what: "Upload Excel / CSV files and update stock from Excel", admin: true, manager: true, staff: false, viewer: false },
  { what: "Add stock items, match names, create sections", admin: true, manager: true, staff: false, viewer: false },
  { what: "See the activity log and download backups", admin: true, manager: true, staff: false, viewer: false },
  { what: "Delete records (while data is unlocked)", admin: true, manager: true, staff: false, viewer: false },
  { what: "Add users, change roles, reset passwords, lock or unlock data", admin: true, manager: false, staff: false, viewer: false },
];
