/**
 * Authenticated console: workspace-specific chrome is under `individual/` and `organization/`.
 */
export default function DashboardGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
