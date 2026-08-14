"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SketchBox, SketchPageHeader } from "@/components/qlix/sketch";
import { sketchButton } from "@/components/qlix/sketch";
import { ApiKeysView } from "@/components/qlix/api-keys-view";
import { ApiReferenceExplorer } from "./ApiReferenceExplorer";
import { DeveloperGuides } from "./DeveloperGuides";
import { portalTabActive } from "./portalTheme";

export type ApiPortalTab = "keys" | "guides" | "reference";

const TABS: { id: ApiPortalTab; label: string }[] = [
  { id: "keys", label: "Keys" },
  { id: "guides", label: "Guides" },
  { id: "reference", label: "Reference" },
];

function parseTab(raw: string | null): ApiPortalTab {
  if (raw === "guides" || raw === "reference" || raw === "keys") return raw;
  return "keys";
}

export function ApiPortalView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = parseTab(searchParams.get("tab"));

  const setTab = useCallback(
    (next: ApiPortalTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "keys") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto pb-6">
      <SketchPageHeader title="API" />
      <p className="-mt-2 max-w-2xl text-[13px] leading-relaxed text-black/60">
        Programmatic access to Qlix Layer 3 (agents), Layer 5 (audit), AI Builder, runs, teams, and AI Brain.
        Create a
        key, then call the Developer API as your account.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={selected ? portalTabActive.console : sketchButton}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "keys" ? <ApiKeysView /> : null}
      {tab === "guides" ? (
        <SketchBox className="p-4">
          <DeveloperGuides variant="console" />
        </SketchBox>
      ) : null}
      {tab === "reference" ? <ApiReferenceExplorer variant="console" enableTryIt /> : null}
    </div>
  );
}
