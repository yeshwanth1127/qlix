import type { Metadata } from "next";
import { DocsShell } from "@/components/qlix/docs/DocsShell";
import { GuideSectionContent } from "@/components/qlix/api-portal";
import { developerApiBaseUrl } from "@/lib/api-keys-api";

export const metadata: Metadata = {
  title: "Scopes · Qlix Docs",
  description: "API key scopes for the Qlix Developer API.",
};

export default function DocsScopesPage() {
  return (
    <DocsShell title="Scopes">
      <GuideSectionContent section="scopes" apiBase={developerApiBaseUrl()} variant="docs" />
    </DocsShell>
  );
}
