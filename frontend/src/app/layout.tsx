import type { Metadata } from "next";
import { Providers } from "@/components/qlix/providers";
import "./globals.css";

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
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
