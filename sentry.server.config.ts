import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  tracesSampleRate: 0.1,

  beforeSend(event) {
    // Strip any auth tokens or cookie values from server-side events
    if (event.request?.cookies) delete event.request.cookies;
    if (event.request?.headers?.["cookie"]) delete event.request.headers["cookie"];
    return event;
  }
});
