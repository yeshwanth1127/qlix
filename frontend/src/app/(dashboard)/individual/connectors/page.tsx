"use client";

import { ConnectorsView } from "@/components/qlix/connectors/ConnectorsView";
import { McpServersView } from "@/components/qlix/mcp/McpServersView";

export default function IndividualConnectorsPage() {
  return (
    <>
      <ConnectorsView isOrgWorkspace={false} />
      <McpServersView />
    </>
  );
}
