import type { Metadata } from "next";
import { DocsShell } from "@/components/qlix/docs/DocsShell";
import { GuideSectionContent } from "@/components/qlix/api-portal";
import { developerApiBaseUrl } from "@/lib/api-keys-api";

export const metadata: Metadata = {
  title: "Authentication · Qlix Docs",
  description: "Authenticate to the Qlix Developer API with qlix_live API keys.",
};

export default function DocsAuthenticationPage() {
  return (
    <DocsShell title="Authentication">
      <GuideSectionContent section="auth" apiBase={developerApiBaseUrl()} variant="docs" />
    </DocsShell>
  );
}
