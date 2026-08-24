import type { NextConfig } from "next";

// Sentry is loaded lazily: the @sentry/nextjs module tree (SDK init, source
// upload plumbing) is heavy (~20s of config-load time when imported statically).
// Only import + wrap the config when SENTRY_DSN is set. Without a DSN the
// config stays byte-for-byte identical for dev/CI.
export default async function loadNextConfig(): Promise<NextConfig> {

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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://frontend-cdn.perplexity.ai",
      "style-src 'self' 'unsafe-inline' https://frontend-cdn.perplexity.ai",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://frontend-cdn.perplexity.ai",
      "connect-src 'self' http://localhost:3444 http://127.0.0.1:3444 ws://localhost:3444 ws://127.0.0.1:3444 https://api.openai.com https://cdn.jsdelivr.net https://frontend-cdn.perplexity.ai",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  // Vendored agent repos (agents/**) are type-checked transitively when their
  // modules are imported (e.g. scripts/local-codenexus.ts) even though tsconfig
  // excludes them. Their TS errors must not gate the fleet's standalone build.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Emit a minimal self-contained server for the desktop (Electron) build —
  // `.next/standalone` + `.next/static`. Keeps the packaged EXE small and lets
  // Electron spawn the production server without bundling all of node_modules.
  output: 'standalone',

  // better-sqlite3 is a native module — never bundle it into server builds.
  serverExternalPackages: ['better-sqlite3'],

  // Keep the fleet's live agent/service dirs OUT of the standalone trace. The
  // standalone output was previously copying these (plus their live SQLite
  // DBs), and the running services hold open handles on them — which made
  // `next build` fail with EBUSY while trying to clean `.next/standalone`.
  outputFileTracingExcludes: {
    '/': [
      './agents/**',
      './**/agents/**',
      './data/**',
      './.next/standalone/**',
      './**/traces.db*',
    ],
  },

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

// Sentry (OSS error reporting) activates only when SENTRY_DSN is set — the
// build stays byte-for-byte unchanged for dev/CI without a DSN. Source-map
// upload additionally needs SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN.
if (process.env.SENTRY_DSN) {
  const { withSentryConfig } = await import("@sentry/nextjs");
  return withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    telemetry: false,
    widenClientFileUpload: true,
  });
}
return nextConfig;
}
