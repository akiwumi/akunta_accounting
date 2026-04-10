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
      // Sentry error reporting + Vercel Analytics
      "connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io https://va.vercel-scripts.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  }
];

const nextConfig = {
  ...(distDir ? { distDir } : {}),
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  }
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only upload source maps when DSN is configured (avoids build warnings)
  silent: true,
  disableLogger: true,

  // Don't fail the build if Sentry auth token is missing
  authToken: process.env.SENTRY_AUTH_TOKEN,

  widenClientFileUpload: true,
  hideSourceMaps: true,
  tunnelRoute: "/monitoring-tunnel",

  // Disable Sentry completely at build time if no DSN is set
  ...(process.env.NEXT_PUBLIC_SENTRY_DSN ? {} : { disableClientWebpackPlugin: true, disableServerWebpackPlugin: true })
});
