import { IndividualConsoleLayout } from "@/components/qlix/individual-console-layout";
import { SubscriptionRouteGate } from "@/components/qlix/subscription-route-gate";
import { WorkspaceRouteGate } from "@/components/qlix/workspace-route-gate";

export default function IndividualWorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <WorkspaceRouteGate expected="individual">
      <SubscriptionRouteGate>
        <IndividualConsoleLayout>{children}</IndividualConsoleLayout>
      </SubscriptionRouteGate>
    </WorkspaceRouteGate>
  );
}
