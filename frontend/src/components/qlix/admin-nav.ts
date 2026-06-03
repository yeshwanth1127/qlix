import type { LucideIcon } from "lucide-react";
import { Activity, Building2, LayoutDashboard } from "lucide-react";

export interface AdminNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

export function getAdminNavItems(): AdminNavItem[] {
  return [
    { href: "/admin/overview", label: "Overview", icon: LayoutDashboard },
    { href: "/admin/billing/orgs", label: "Organizations", icon: Building2 },
    { href: "/admin/billing/events", label: "Event log", icon: Activity },
  ];
}

