import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Capture 10% of transactions for performance tracing
  tracesSampleRate: 0.1,

  // Replay only on errors — never record sessions (protects financial data)
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,

  // Strip auth cookies from all outgoing events
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies;
    return event;
  }
});
