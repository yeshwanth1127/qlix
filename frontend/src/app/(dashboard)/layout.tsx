import { DashboardBackground } from "@/components/qlix/DashboardBackground";

/**
 * Authenticated console: workspace-specific chrome is under `individual/` and `organization/`.
 * The animated Grainient sits behind every dashboard screen.
 */
export default function DashboardGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <DashboardBackground />
      {children}
    </>
  );
}
