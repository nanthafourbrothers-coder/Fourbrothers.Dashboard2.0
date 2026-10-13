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
  viewer: "Viewer",
};

export const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, including users and settings.",
  manager: "Import files, edit stock items and sections, delete records, run syncs.",
  staff: "Add and edit stock movements, shipments and section rows. Cannot delete.",
  viewer: "Look at everything, change nothing.",
};
