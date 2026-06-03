export type WorkspaceKind = "individual" | "organization";

/** First URL segment for the authenticated console (`/individual` or `/organization`). */
export function consoleRoutePrefix(workspaceKind: WorkspaceKind): string {
  return workspaceKind === "individual" ? "/individual" : "/organization";
}

/** Default home after sign-in/sign-up: overview lives under the workspace segment. */
export function consoleHomePath(workspaceKind: WorkspaceKind): string {
  return `${consoleRoutePrefix(workspaceKind)}/overview`;
}

export function userFirstName(displayName: string | null | undefined, email: string): string {
  if (displayName?.trim()) {
    return displayName.trim().split(/\s+/)[0] ?? email.split("@")[0] ?? "there";
  }
  return email.split("@")[0] ?? "there";
}

export function userInitials(displayName: string | null | undefined, email: string): string {
  if (displayName?.trim()) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
    }
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/** Human-readable label for `Organization.plan` in the UI. */
export function formatOrganizationPlanLabel(plan: string | undefined): string {
  const raw = plan?.trim().toLowerCase();
  if (!raw) return "Free";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
