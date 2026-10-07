import type { NextConfig } from "next";

// The browser only ever talks to this Next.js origin. API calls are proxied
// server-side to the Go API, so session cookies stay first-party and no API
// secrets or internal URLs reach the client bundle.
const API_URL = process.env.API_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  async redirects() {
    const agentAliases: Record<string, string> = {
      orders: "orders", customers: "customers", products: "products", inventory: "inventory",
      marketing: "marketing", finance: "finance", market: "market", reviews: "reviews",
      support: "support", pricing: "pricing",
    };
    return [
      { source: "/", destination: "/dashboard", permanent: false },
      ...Object.entries(agentAliases).map(([from, to]) => ({ source: `/${from}`, destination: `/agents/${to}`, permanent: false })),
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
