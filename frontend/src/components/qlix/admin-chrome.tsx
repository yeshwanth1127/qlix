"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { AppTopbar } from "./app-topbar";
import { useSession } from "./session-context";
import { getAdminNavItems } from "./admin-nav";

export function AdminChrome({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/sign-in");
      return;
    }
    if (!session.user.isSuperAdmin) {
      const kind = session.user.workspaceKind ?? session.organization.workspaceKind;
      router.replace(kind === "organization" ? "/organization/overview" : "/individual/overview");
    }
  }, [loading, router, session]);

  const items = useMemo(() => getAdminNavItems(), []);

  if (loading || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-[--text-tertiary]">
        Loading…
      </div>
    );
  }
  if (!session.user.isSuperAdmin) {
    return null;
  }

  return (
    <div>
      <AppTopbar
        onOpenMobileNav={() => setMobileOpen(true)}
        workspaceLabel="Super admin"
        homeHref="/admin/overview"
        variant="organization"
      />

      {mobileOpen ? (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <div
            className="qlix-glass-sidebar absolute left-0 top-0 flex h-full w-52 flex-col shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex h-12 items-center justify-between border-b border-[--border-subtle] px-3">
              <span className="text-[13px] font-medium text-[--text-primary]">Admin</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex size-8 items-center justify-center rounded-md text-[--text-tertiary] hover:bg-[--bg-hover]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors duration-150",
                      active
                        ? "border-l-2 border-blue-500 bg-[--bg-active] font-medium text-white"
                        : "border-l-2 border-transparent text-[--text-secondary] hover:bg-[--bg-hover]",
                    )}
                  >
                    <Icon
                      className={cn("size-4 shrink-0", active ? "text-[--accent]" : "text-[--text-tertiary]")}
                      strokeWidth={1.75}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}

      <aside
        className={cn(
          "qlix-glass-sidebar fixed left-0 top-12 z-30 hidden h-[calc(100vh-3rem)] w-52 flex-col md:flex",
        )}
        aria-label="Admin navigation"
      >
        <div className="border-b border-[--border-subtle] px-4 pb-4 pt-2">
          <div className="text-[10px] font-medium uppercase tracking-widest text-[--text-tertiary]">
            Platform
          </div>
          <div className="mt-1 text-sm font-semibold text-white">Super admin</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-4">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 px-4 py-2 text-[13px] transition-colors duration-150 ease-out",
                  active
                    ? "border-l-2 border-blue-500 bg-[--bg-active] font-medium text-white"
                    : "border-l-2 border-transparent text-[--text-tertiary] hover:bg-[--bg-hover] hover:text-[--text-secondary]",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-[--accent]" : "text-[--text-tertiary] group-hover:text-[--text-secondary]",
                  )}
                  strokeWidth={1.75}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="bg-[--bg-base] pt-12 transition-[padding] duration-150 ease-out md:pl-52">
        <div className="animate-qlix-fade-in mx-auto max-w-[1800px] px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

