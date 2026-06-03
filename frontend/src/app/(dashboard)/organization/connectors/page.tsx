"use client";

import { ConnectorsView } from "@/components/qlix/connectors/ConnectorsView";
import { useSession } from "@/components/qlix/session-context";
import { canSeeOrgSettings } from "@/lib/org-permissions";

export default function OrganizationConnectorsPage() {
  const { session } = useSession();
  const canManageN8n = session ? canSeeOrgSettings(session.user.role) : false;
  return <ConnectorsView isOrgWorkspace={true} canManageN8n={canManageN8n} />;
}
