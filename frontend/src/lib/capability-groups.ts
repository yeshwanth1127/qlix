import type { PermissionScope } from "@/lib/agents-api";

/** Product-level capability under a vendor group (e.g. Gmail under Google). */
export interface CapabilityProduct {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Scopes granted when this product is selected. */
  readonly scopes: readonly PermissionScope[];
  /** Subset of `scopes` that always require JIT approval. */
  readonly forceJitScopes: readonly PermissionScope[];
}

export interface CapabilityGroup {
  readonly id: string;
  readonly label: string;
  readonly products: readonly CapabilityProduct[];
}

/**
 * Vendor → product groupings for capability pickers.
 * Underlying permission scopes stay flat in the catalog; this is UI structure only.
 */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  {
    id: "google",
    label: "Google",
    products: [
      {
        id: "gmail",
        label: "Gmail",
        description: "Read and send email via connected Gmail",
        scopes: ["email.read", "email.send"],
        forceJitScopes: ["email.send"],
      },
      {
        id: "drive",
        label: "Drive",
        description: "Read and write files in Google Drive",
        scopes: ["drive.read", "drive.write"],
        forceJitScopes: ["drive.write"],
      },
      {
        id: "calendar",
        label: "Calendar",
        description: "Read and write Google Calendar events",
        scopes: ["calendar.read", "calendar.write"],
        forceJitScopes: ["calendar.write"],
      },
      {
        id: "gmeet",
        label: "GMeet",
        description: "Create and manage Google Meet links",
        scopes: ["meet.manage"],
        forceJitScopes: ["meet.manage"],
      },
      {
        id: "youtube",
        label: "YouTube",
        description: "Read and publish YouTube via Google",
        scopes: ["youtube.read", "youtube.publish"],
        forceJitScopes: ["youtube.publish"],
      },
    ],
  },
];

/** Every scope id that belongs to a capability group (hidden from the flat list). */
export const GROUPED_SCOPE_IDS: ReadonlySet<string> = new Set(
  CAPABILITY_GROUPS.flatMap((g) => g.products.flatMap((p) => p.scopes)),
);

export function productSelectionState(
  product: CapabilityProduct,
  selected: readonly string[],
): "all" | "some" | "none" {
  const selectedSet = new Set(selected);
  const hit = product.scopes.filter((s) => selectedSet.has(s)).length;
  if (hit === 0) return "none";
  if (hit === product.scopes.length) return "all";
  return "some";
}
