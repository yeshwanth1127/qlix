"use client";

import { ConnectorsView } from "@/components/qlix/connectors/ConnectorsView";
import { McpServersView } from "@/components/qlix/mcp/McpServersView";

export default function OrganizationConnectorsPage() {
  return (
    <>
      <ConnectorsView isOrgWorkspace={true} />
      <McpServersView />
    </>
  );
}
