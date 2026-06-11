import { Inter, Saira } from "next/font/google";
import { ChatLanding } from "@/components/qlix/landing/ChatLanding";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-landing",
});

const saira = Saira({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-landing-logo",
  weight: ["500", "600", "700"],
});

/**
 * Public home (`/`) — chat-first builder. Visitors describe an agent and a
 * guest workspace is provisioned for them automatically; sign-in stays in the
 * header for returning users.
 */
export default function HomePage() {
  return (
    <div className={`${inter.variable} ${saira.variable} ${inter.className}`}>
      <ChatLanding />
    </div>
  );
}
