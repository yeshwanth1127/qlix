/**
 * Authenticated console: workspace-specific chrome is under `individual/` and `organization/`.
 */
export default function DashboardGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen bg-[#E2F0CC]">{children}</div>;
}
