import { Inter } from "next/font/google";
import { ChatLanding } from "@/components/qlix/landing/ChatLanding";
import { BetaAccessGate } from "@/components/qlix/landing/BetaAccessGate";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-landing",
});

/**
 * Public home (`/`) — chat-first builder. Visitors describe an agent and a
 * guest workspace is provisioned for them automatically; sign-in stays in the
 * header for returning users.
 */
export default function HomePage() {
  return (
    <div className={`${inter.variable} ${inter.className}`}>
      <BetaAccessGate>
        <ChatLanding />
      </BetaAccessGate>
    </div>
  );
}
