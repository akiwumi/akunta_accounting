import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const distDir = process.env.NEXT_DIST_DIR?.trim();

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      // Sentry tunnel route is same-origin; ingest fallback for direct reporting
      "connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io https://va.vercel-scripts.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  }
];

const noIndexHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" }
];

const noIndexRouteBases = [
  "/api",
  "/dashboard",
  "/receipts",
  "/invoices",
  "/imports",
  "/transactions",
  "/ledger",
  "/review",
  "/reports",
  "/settings",
  "/assets",
  "/audit",
  "/compliance",
  "/mileage",
  "/salaries",
  "/periodiseringsfond",
  "/welcome",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password"
];

const noIndexSources = Array.from(
  new Set(
    noIndexRouteBases.flatMap((base) => [base, `${base}/:path*`])
  )
);

const nextConfig = {
  ...(distDir ? { distDir } : {}),
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      ...noIndexSources.map((source) => ({ source, headers: noIndexHeaders }))
    ];
  }
};

export default withSentryConfig(nextConfig, {
  // Sentry org/project for source map uploads (set in Vercel env vars)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Tunnel Sentry requests through your own domain — avoids ad blockers
  tunnelRoute: "/monitoring-tunnel",

  // Keep source maps off the CDN (uploaded to Sentry only)
  hideSourceMaps: true,

  // Suppress build-time Sentry CLI output
  silent: !process.env.CI,

  // Automatically instrument React components for better error context
  reactComponentAnnotation: { enabled: true }
});
