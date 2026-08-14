import type { Metadata } from "next";
import { DocsShell } from "@/components/qlix/docs/DocsShell";
import { GuideSectionContent } from "@/components/qlix/api-portal";
import { developerApiBaseUrl } from "@/lib/api-keys-api";

export const metadata: Metadata = {
  title: "JIT approvals · Qlix Docs",
  description:
    "Just-in-time approvals for the Qlix Developer API — requests go back to the channel that started the run.",
};

export default function DocsJitPage() {
  return (
    <DocsShell title="JIT approvals">
      <GuideSectionContent section="jit" apiBase={developerApiBaseUrl()} variant="docs" />
    </DocsShell>
  );
}
