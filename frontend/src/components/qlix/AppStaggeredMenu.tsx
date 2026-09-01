"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getConsoleNavItems, isConsoleNavActive } from "@/lib/navigation/individualNav";
import { canAccessBilling, canSeeOrgSettings } from "@/lib/org-permissions";
import { StaggeredMenu, type StaggeredMenuItem } from "./StaggeredMenu";
import { QlixWordmark } from "./landing/QlixWordmark";
import { useSession } from "./session-context";

interface AppStaggeredMenuProps {
  readonly currentPath: string;
  readonly routePrefix: string;
  readonly showUpgradeCta: boolean;
}

export function AppStaggeredMenu({ currentPath, routePrefix, showUpgradeCta }: AppStaggeredMenuProps) {
  const { session } = useSession();
  const [menuPage, setMenuPage] = useState(0);
  const allItems = useMemo<StaggeredMenuItem[]>(() => {
    const all = getConsoleNavItems(
      routePrefix,
      session?.user.billingExempt ?? false,
      session?.organization.enabledPluginIds ?? [],
    );
    const permitted = routePrefix !== "/organization" || session?.organization.workspaceKind !== "organization"
      ? all
      : all.filter((item) => {
          if (!session) return true;
          if (item.href.endsWith("/settings")) return canSeeOrgSettings(session.user.role);
          if (item.href.endsWith("/billing")) return canAccessBilling(session.user.role);
          return true;
        });
    const overviewHref = `${routePrefix}/overview`;
    const menuItems = permitted.map((item) => ({
      href: item.href,
      label: item.label,
      ariaLabel: `Open ${item.label}`,
      active: isConsoleNavActive(item.href, currentPath, overviewHref),
    }));
    if (showUpgradeCta) {
      menuItems.push({
        href: `${routePrefix}/upgrade`,
        label: "Upgrade",
        ariaLabel: "Upgrade workspace",
        active: currentPath === `${routePrefix}/upgrade`,
      });
    }
    return menuItems;
  }, [currentPath, routePrefix, session, showUpgradeCta]);

  useEffect(() => setMenuPage(0), [currentPath]);

  const items = useMemo<StaggeredMenuItem[]>(() => {
    const primaryCount = 10;
    const primary = allItems.slice(0, primaryCount);
    const secondary = allItems.slice(primaryCount);
    if (menuPage === 0) {
      return secondary.length > 0
        ? [...primary, { label: "More", ariaLabel: "Show more menu items", onSelect: () => setMenuPage(1) }]
        : primary;
    }

    const pageSize = 8;
    const start = (menuPage - 1) * pageSize;
    const pageItems = secondary.slice(start, start + pageSize);
    const hasNext = start + pageSize < secondary.length;
    return [
      { label: "Back", ariaLabel: "Previous menu page", onSelect: () => setMenuPage((page) => Math.max(0, page - 1)) },
      ...pageItems,
      ...(hasNext
        ? [{ label: "Next", ariaLabel: "Next menu page", onSelect: () => setMenuPage((page) => page + 1) }]
        : []),
    ];
  }, [allItems, menuPage]);

  return (
    <StaggeredMenu
      position="left"
      items={items}
      colors={["#8BC53D", "#012F13"]}
      accentColor="#8BC53D"
      menuButtonColor="#012F13"
      openMenuButtonColor="#E2F0CC"
      displayItemNumbering
      iconOnly
      alwaysOpen
      logo={(
        <Link href={`${routePrefix}/overview`} aria-label="Qlix overview" className="text-[#012F13]">
          <QlixWordmark className="text-[32px]" />
        </Link>
      )}
    />
  );
}
