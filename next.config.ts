import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openai.com",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  // Pin the workspace root — a stray pnpm-lock.yaml in a parent directory
  // makes Next infer the wrong root and double the path (e.g. ./src\src\...).
  turbopack: {
    root: process.cwd(),
  },

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // CORS for API consumers: Open-Chat web, Aetherdesk, and local dev.
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGIN || "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type, X-Review-Token, X-Api-Key" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
    ];
  },

  async redirects() {
    return [];
  },
};

export default nextConfig;
