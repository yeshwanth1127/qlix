import { AppChrome } from "@/components/qlix/app-chrome";
import { WorkspaceRouteGate } from "@/components/qlix/workspace-route-gate";

export default function OrganizationWorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <WorkspaceRouteGate expected="organization">
      <AppChrome>{children}</AppChrome>
    </WorkspaceRouteGate>
  );
}
