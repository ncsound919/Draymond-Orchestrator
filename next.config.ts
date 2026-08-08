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
      "connect-src 'self' https://api.openai.com https://cdn.jsdelivr.net",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  // better-sqlite3 is a native module — never bundle it into server builds.
  serverExternalPackages: ['better-sqlite3'],

  // Pin the workspace root �?" a stray pnpm-lock.yaml in a parent directory
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
    const result: {
      source: string;
      headers: { key: string; value: string }[];
    }[] = [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];

    // CORS for API consumers (Open-Chat web, Aetherdesk, local dev). Deny by
    // default: when CORS_ORIGIN is unset, no CORS header rule is emitted so
    // cross-origin browsers can't read API responses. Server-side clients
    // (Node fetch / curl) are unaffected.
    if (process.env.CORS_ORIGIN) {
      result.push({
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGIN },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type, X-Review-Token, X-Api-Key" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      });
    }

    return result;
  },

  async redirects() {
    return [];
  },
};

export default nextConfig;
