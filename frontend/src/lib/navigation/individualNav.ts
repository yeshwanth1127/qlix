import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  CreditCard,
  Fingerprint,
  Hammer,
  KeyRound,
  LayoutDashboard,
  PlayCircle,
  ScrollText,
  Settings,
  ShieldCheck,
  Plug,
  Target,
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
  "/ai-employees",
  "/overview",
  "/agents",
  "/active-runs",
  "/teams",
  "/ai-brain",
  "/knowledge",
  "/passports",
  "/audit",
] as const;

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
 */
export function getConsoleNavItems(routePrefix: string, billingExempt = false): ConsoleNavItem[] {
  const core: ConsoleNavItem[] = [
    { href: `${routePrefix}/agent-builder`, label: "AI Builder", icon: Wand2 },
    { href: `${routePrefix}/ai-employees`, label: "AI Employees", icon: Bot },
    { href: `${routePrefix}/overview`, label: "Overview", icon: LayoutDashboard },
    { href: `${routePrefix}/agents`, label: "Agents", icon: Bot },
    { href: `${routePrefix}/active-runs`, label: "Active runs", icon: PlayCircle },
    { href: `${routePrefix}/teams`, label: "Teams", icon: UsersRound },
    { href: `${routePrefix}/ai-brain`, label: "exa (ai brain)", icon: Brain },
    { href: `${routePrefix}/knowledge`, label: "Knowledge", icon: BookOpen },
    { href: `${routePrefix}/passports`, label: "Passports", icon: Fingerprint },
    { href: `${routePrefix}/audit`, label: "Audit log", icon: ScrollText },
    { href: `${routePrefix}/leads`, label: "Leads", icon: Target },
    { href: `${routePrefix}/connectors`, label: "Connectors", icon: Plug },
    { href: `${routePrefix}/skills`, label: "Skills", icon: Hammer },
    { href: `${routePrefix}/credentials`, label: "Credentials", icon: ShieldCheck },
    { href: `${routePrefix}/api-keys`, label: "API keys", icon: KeyRound },
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
  if (routePrefix === "/organization") {
    return [
      ...core,
      { href: `${routePrefix}/schedules`, label: "Schedules", icon: PlayCircle },
      { href: `${routePrefix}/compliance`, label: "Compliance", icon: ShieldCheck },
      usageItem,
      subscriptionsItem,
      ...(billingExempt
        ? []
        : [{ href: `${routePrefix}/billing`, label: "Billing", icon: CreditCard }]),
      { href: `${routePrefix}/members`, label: "Members", icon: Users },
      settingsItem,
    ];
  }
  return [
    ...core,
    subscriptionsItem,
    ...(billingExempt ? [] : [{ href: `${routePrefix}/wallet`, label: "Wallet", icon: Wallet }]),
    usageItem,
    settingsItem,
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
