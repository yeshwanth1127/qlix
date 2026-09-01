import type { NextConfig } from "next";

// Baseline security headers. Kept conservative (no restrictive script/style CSP) to avoid breaking
// Next's inline runtime; `frame-ancestors 'none'` + X-Frame-Options stop clickjacking, and the
// others harden MIME sniffing, referrer leakage, and unused browser features. When served behind
// nginx these complement the server-level headers.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["qlixdev.exora.solutions"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
