import type { Metadata } from "next";
import { DocsShell } from "@/components/qlix/docs/DocsShell";
import { GuideSectionContent } from "@/components/qlix/api-portal";
import { developerApiBaseUrl } from "@/lib/api-keys-api";

export const metadata: Metadata = {
  title: "Developer API · Qlix Docs",
  description: "Get started with the Qlix Developer API — API keys, agents, AI Builder, runs, audit, and AI Brain.",
};

export default function DocsOverviewPage() {
  const apiBase = developerApiBaseUrl();
  return (
    <DocsShell title="Qlix Developer API">
      <p className="mb-8 max-w-2xl text-[15px] leading-relaxed text-black/65">
        Account-scoped REST under <code className="font-mono text-[13px]">/api/v1</code> for Layer 3 agent
        identity, Layer 5 audit, AI Builder, agent and team runs, and AI Brain. Authenticate with{" "}
        <code className="font-mono text-[13px]">qlix_live_*</code> keys from the console.
      </p>
      <div className="flex flex-col gap-12">
        <section>
          <h2 className="text-[17px] font-semibold tracking-tight text-[#012F13]">Get started</h2>
          <div className="mt-4">
            <GuideSectionContent section="start" apiBase={apiBase} variant="docs" />
          </div>
        </section>
        <section>
          <h2 className="text-[17px] font-semibold tracking-tight text-[#012F13]">Common recipes</h2>
          <div className="mt-4">
            <GuideSectionContent section="recipes" apiBase={apiBase} variant="docs" />
          </div>
        </section>
        <section>
          <h2 className="text-[17px] font-semibold tracking-tight text-[#012F13]">Not in this API</h2>
          <div className="mt-4">
            <GuideSectionContent section="not-in-api" apiBase={apiBase} variant="docs" />
          </div>
        </section>
      </div>
    </DocsShell>
  );
}
