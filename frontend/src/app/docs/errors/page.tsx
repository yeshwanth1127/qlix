import type { Metadata } from "next";
import { DocsShell } from "@/components/qlix/docs/DocsShell";
import { GuideSectionContent } from "@/components/qlix/api-portal";
import { developerApiBaseUrl } from "@/lib/api-keys-api";

export const metadata: Metadata = {
  title: "Errors & limits · Qlix Docs",
  description: "Error codes, rate limits, and RBAC for the Qlix Developer API.",
};

export default function DocsErrorsPage() {
  const apiBase = developerApiBaseUrl();
  return (
    <DocsShell title="Errors & limits">
      <div className="flex flex-col gap-12">
        <section>
          <h2 className="text-[17px] font-semibold tracking-tight text-[#1c1830]">Errors</h2>
          <div className="mt-4">
            <GuideSectionContent section="errors" apiBase={apiBase} variant="docs" />
          </div>
        </section>
        <section>
          <h2 className="text-[17px] font-semibold tracking-tight text-[#1c1830]">Limits & RBAC</h2>
          <div className="mt-4">
            <GuideSectionContent section="limits" apiBase={apiBase} variant="docs" />
          </div>
        </section>
      </div>
    </DocsShell>
  );
}
