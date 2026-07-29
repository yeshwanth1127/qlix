import { AppChrome } from "@/components/qlix/app-chrome";
import { SubscriptionRouteGate } from "@/components/qlix/subscription-route-gate";
import { WorkspaceRouteGate } from "@/components/qlix/workspace-route-gate";

export default function OrganizationWorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <WorkspaceRouteGate expected="organization">
      <SubscriptionRouteGate>
        <AppChrome>{children}</AppChrome>
      </SubscriptionRouteGate>
    </WorkspaceRouteGate>
  );
}
