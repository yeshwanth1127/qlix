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

/** `routePrefix` is `/individual` or `/organization`. */
export function getConsoleNavItems(routePrefix: string): ConsoleNavItem[] {
  const core: ConsoleNavItem[] = [
    { href: `${routePrefix}/overview`, label: "Overview", icon: LayoutDashboard },
    { href: `${routePrefix}/agents`, label: "Agents", icon: Bot },
    { href: `${routePrefix}/agent-builder`, label: "AI Builder", icon: Wand2 },
    { href: `${routePrefix}/active-runs`, label: "Active runs", icon: PlayCircle },
    { href: `${routePrefix}/teams`, label: "Teams", icon: UsersRound },
    { href: `${routePrefix}/ai-brain`, label: "AI Brain", icon: Brain },
    { href: `${routePrefix}/knowledge`, label: "Knowledge", icon: BookOpen },
    { href: `${routePrefix}/passports`, label: "Passports", icon: Fingerprint },
    { href: `${routePrefix}/audit`, label: "Audit log", icon: ScrollText },
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
  if (routePrefix === "/organization") {
    return [
      ...core,
      usageItem,
      { href: `${routePrefix}/billing`, label: "Billing", icon: CreditCard },
      { href: `${routePrefix}/members`, label: "Members", icon: Users },
      settingsItem,
    ];
  }
  return [
    ...core,
    { href: `${routePrefix}/wallet`, label: "Wallet", icon: Wallet },
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
