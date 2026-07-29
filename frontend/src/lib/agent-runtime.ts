import type { PermissionScope } from "./agents-api";

/** Scopes whose tools only run on a local/hybrid runner (matches backend scope catalog). */
const HYBRID_ONLY_SCOPES: PermissionScope[] = [
  "system.file_read",
  "system.file_write",
  "system.gui_control",
];

export function scopesRequireHybrid(scopes: readonly PermissionScope[]): boolean {
  return scopes.some((s) => HYBRID_ONLY_SCOPES.includes(s));
}
