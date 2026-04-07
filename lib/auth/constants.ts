// Edge-safe constants — no Node.js built-ins, safe to import in middleware.
export const AUTH_COOKIE_NAME = "akunta_session";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
