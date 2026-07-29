"use client";

import { Suspense } from "react";
import { ConnectorsView } from "@/components/qlix/connectors/ConnectorsView";
import { McpServersView } from "@/components/qlix/mcp/McpServersView";

function ConnectorsFallback() {
  return (
    <div className="max-w-2xl py-8 text-[13px] text-black/50">Loading connectors…</div>
  );
}

export default function OrganizationConnectorsPage() {
  return (
    <>
      <Suspense fallback={<ConnectorsFallback />}>
        <ConnectorsView isOrgWorkspace={true} />
      </Suspense>
      <McpServersView />
    </>
  );
}
