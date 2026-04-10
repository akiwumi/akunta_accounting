import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Capture 10% of transactions for performance monitoring
  tracesSampleRate: 0.1,

  // No session replay — avoids capturing personal/financial data
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Scrub sensitive fields from breadcrumbs and event data
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies;
    return event;
  }
});
