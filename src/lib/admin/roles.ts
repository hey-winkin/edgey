import type { StaffRole } from "./auth";

export const purchaseRoles = ["catalogue", "finance"] as const satisfies readonly StaffRole[];

export function hasPurchasingRole(roles: readonly StaffRole[]) {
  return purchaseRoles.some((role) => roles.includes(role));
}
