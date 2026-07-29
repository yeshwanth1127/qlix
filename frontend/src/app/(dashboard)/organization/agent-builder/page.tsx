"use client";

import { Inter } from "next/font/google";
import { ChatLanding } from "@/components/qlix/landing/ChatLanding";
import { useSession } from "@/components/qlix/session-context";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-landing",
});

export default function OrganizationAgentBuilderPage() {
  const { session } = useSession();
  const orgId = session?.organization.id ?? null;

  return (
    <div className={`${inter.variable} ${inter.className} size-full`}>
      <ChatLanding variant="dashboard" orgId={orgId} />
    </div>
  );
}
