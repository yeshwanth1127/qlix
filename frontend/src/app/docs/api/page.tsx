import type { Metadata } from "next";
import { DocsShell } from "@/components/qlix/docs/DocsShell";
import { ApiReferenceExplorer } from "@/components/qlix/api-portal";

export const metadata: Metadata = {
  title: "API reference · Qlix Docs",
  description: "Interactive reference for the Qlix Developer API.",
};

export default function DocsApiReferencePage() {
  return (
    <DocsShell title="API reference">
      <p className="mb-8 max-w-2xl text-[15px] leading-relaxed text-black/65">
        Operations allowlisted for <code className="font-mono text-[13px]">qlix_live_*</code> keys. Live
        execute lives in the console under API → Reference.
      </p>
      <ApiReferenceExplorer variant="docs" />
    </DocsShell>
  );
}
