import { Inter, Saira } from "next/font/google";
import { WorkspaceLandingPage } from "@/components/qlix/workspace-landing-page";

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

/** Public home (`/`) — marketing / workspace onboarding hero. */
export default function HomePage() {
  return (
    <div
      className={`${inter.variable} ${saira.variable} ${inter.className} bg-[var(--landing-form-column-bg)] text-[var(--landing-text)]`}
    >
      <WorkspaceLandingPage />
    </div>
  );
}
