import { IndividualConsoleLayout } from "@/components/qlix/individual-console-layout";
import { WorkspaceRouteGate } from "@/components/qlix/workspace-route-gate";

export default function IndividualWorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <WorkspaceRouteGate expected="individual">
      <IndividualConsoleLayout>{children}</IndividualConsoleLayout>
    </WorkspaceRouteGate>
  );
}
