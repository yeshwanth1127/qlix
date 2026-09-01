"use client";

import { Suspense } from "react";
import { ConnectorsView } from "@/components/qlix/connectors/ConnectorsView";

function ConnectorsFallback() {
  return (
    <div className="max-w-2xl py-8">
      <div className="sketch-skeleton mb-3 h-4 w-32 rounded-full" />
      <div className="sketch-skeleton h-3 w-64 rounded-full" />
    </div>
  );
}

export default function IndividualConnectorsPage() {
  return (
    <Suspense fallback={<ConnectorsFallback />}>
      <ConnectorsView isOrgWorkspace={false} />
    </Suspense>
  );
}
