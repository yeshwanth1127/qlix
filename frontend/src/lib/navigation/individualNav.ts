import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  FileText,
  Fingerprint,
  Hammer,
  KeyRound,
  LayoutDashboard,
  PlayCircle,
  Puzzle,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Target,
  Plug,
  Users,
  UsersRound,
  Wallet,
  Wand2,
} from "lucide-react";

export interface ConsoleNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

const PRIMARY_NAV_SUFFIXES = [
  "/agent-builder",
  "/overview",
  "/agents",
  "/active-runs",
  "/schedules",
  "/teams",
  "/ai-brain",
  "/knowledge",
  "/passports",
  "/plugins",
  "/assessments",
  "/gtm",
] as const;

/**
 * Frontend mirror of backend/src/plugins/pluginCatalog.ts's per-plugin nav items.
 * Can't import the backend catalog directly (separate build), and icons are React
 * components so the backend only sends an icon *name* — this is where that name
 * resolves to an actual component. Keep in sync with PLUGIN_CATALOG by hand;
 * a plugin with no entry here simply contributes no nav items once enabled.
 */
const PLUGIN_ICONS: Record<string, LucideIcon> = {
  ClipboardCheck,
  Target,
};

const PLUGIN_NAV_ITEMS: Record<string, ReadonlyArray<{ href: string; label: string; iconName: string }>> = {
  assessment: [{ href: "assessments", label: "Assessments", iconName: "ClipboardCheck" }],
  outreach: [],
  gtm: [
    { href: "gtm", label: "GTM", iconName: "Target" },
  ],
};

function pluginNavItems(routePrefix: string, enabledPluginIds: readonly string[]): ConsoleNavItem[] {
  return enabledPluginIds.flatMap((pluginId) => {
    if (pluginId === "gtm" && routePrefix !== "/organization") return [];
    return (PLUGIN_NAV_ITEMS[pluginId] ?? []).map((item) => ({
      href: `${routePrefix}/${item.href}`,
      label: item.label,
      icon: PLUGIN_ICONS[item.iconName] ?? Puzzle,
    }));
  });
}

function isPrimaryNavItem(href: string): boolean {
  return PRIMARY_NAV_SUFFIXES.some((suffix) => href.endsWith(suffix));
}

export function splitConsoleNavItems(items: ConsoleNavItem[]): {
  primary: ConsoleNavItem[];
  more: ConsoleNavItem[];
} {
  const primary: ConsoleNavItem[] = [];
  const more: ConsoleNavItem[] = [];
  for (const item of items) {
    if (isPrimaryNavItem(item.href)) primary.push(item);
    else more.push(item);
  }
  return { primary, more };
}

/**
 * `routePrefix` is `/individual` or `/organization`.
 * When `billingExempt` is true, the money-facing destinations (Billing / Wallet) are
 * omitted — exempt accounts are never charged, so only Usage is relevant to them.
 * `enabledPluginIds` are this org's enabled plugins (session.organization.enabledPluginIds) —
 * each contributes its own nav items (see PLUGIN_NAV_ITEMS above), spliced in after Teams.
 */
export function getConsoleNavItems(
  routePrefix: string,
  billingExempt = false,
  enabledPluginIds: readonly string[] = [],
): ConsoleNavItem[] {
  const core: ConsoleNavItem[] = [
    { href: `${routePrefix}/agent-builder`, label: "AI Builder", icon: Wand2 },
    { href: `${routePrefix}/overview`, label: "Overview", icon: LayoutDashboard },
    { href: `${routePrefix}/agents`, label: "Agents", icon: Bot },
    { href: `${routePrefix}/active-runs`, label: "Active runs", icon: PlayCircle },
    { href: `${routePrefix}/schedules`, label: "Schedules", icon: CalendarClock },
    { href: `${routePrefix}/teams`, label: "Teams", icon: UsersRound },
    ...pluginNavItems(routePrefix, enabledPluginIds),
    { href: `${routePrefix}/ai-brain`, label: "AI Brain", icon: Brain },
    { href: `${routePrefix}/knowledge`, label: "Knowledge", icon: BookOpen },
    { href: `${routePrefix}/passports`, label: "Passports", icon: Fingerprint },
    { href: `${routePrefix}/audit`, label: "Audit log", icon: ScrollText },
    { href: `${routePrefix}/plugins`, label: "Plugins", icon: Puzzle },
    { href: `${routePrefix}/connectors`, label: "Connectors", icon: Plug },
    { href: `${routePrefix}/skills`, label: "Skills", icon: Hammer },
    { href: `${routePrefix}/credentials`, label: "Credentials", icon: ShieldCheck },
    { href: `${routePrefix}/api-keys`, label: "API", icon: KeyRound },
  ];
  const usageItem: ConsoleNavItem = {
    href: `${routePrefix}/usage`,
    label: "Usage",
    icon: Activity,
  };
  const settingsItem: ConsoleNavItem = {
    href: `${routePrefix}/settings`,
    label: "Settings",
    icon: Settings,
  };
  const subscriptionsItem: ConsoleNavItem = {
    href: `${routePrefix}/subscriptions`,
    label: "Subscriptions",
    icon: CreditCard,
  };
  const legalItems: ConsoleNavItem[] = [
    { href: "/docs", label: "Docs", icon: BookOpen },
    { href: "/privacy", label: "Privacy", icon: Shield },
    { href: "/terms", label: "Terms", icon: FileText },
  ];
  if (routePrefix === "/organization") {
    return [
      ...core,
      { href: `${routePrefix}/compliance`, label: "Compliance", icon: ShieldCheck },
      usageItem,
      subscriptionsItem,
      ...(billingExempt
        ? []
        : [{ href: `${routePrefix}/billing`, label: "Billing", icon: CreditCard }]),
      { href: `${routePrefix}/members`, label: "Members", icon: Users },
      settingsItem,
      ...legalItems,
    ];
  }
  return [
    ...core,
    subscriptionsItem,
    ...(billingExempt ? [] : [{ href: `${routePrefix}/wallet`, label: "Wallet", icon: Wallet }]),
    usageItem,
    settingsItem,
    ...legalItems,
  ];
}

export function isConsoleNavActive(
  itemHref: string,
  pathname: string,
  overviewHref: string,
): boolean {
  if (itemHref === overviewHref) {
    return pathname === overviewHref;
  }
  return pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}
