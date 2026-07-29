import type { Metadata } from "next";
import { Londrina_Outline } from "next/font/google";
import { Providers } from "@/components/qlix/providers";
import "./globals.css";

// Brand typeface for the "QLIX." wordmark — an outline/hollow display face.
// Exposed site-wide as the `--font-brand` CSS variable (see QlixWordmark).
const brandFont = Londrina_Outline({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-brand",
});

export const metadata: Metadata = {
  title: "Qlix",
  description: "Developer console for Exora — agent identity and audit",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full ${brandFont.variable}`} suppressHydrationWarning>
      <body className="min-h-full font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
