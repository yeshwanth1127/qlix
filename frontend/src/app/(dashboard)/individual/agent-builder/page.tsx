"use client";

import { Inter } from "next/font/google";
import { ChatLanding } from "@/components/qlix/landing/ChatLanding";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-landing",
});

export default function IndividualAgentBuilderPage() {
  return (
    <div className={`${inter.variable} ${inter.className} size-full`}>
      <ChatLanding variant="dashboard" orgId={null} />
    </div>
  );
}
