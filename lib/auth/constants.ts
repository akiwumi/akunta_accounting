// Edge-safe constants — no Node.js built-ins, safe to import in middleware.
export const AUTH_COOKIE_NAME = "akunta_session";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Non-httpOnly indicator cookie — readable by JS to detect login state on public pages.
// Contains no sensitive data; the actual session token is in the httpOnly cookie.
export const AUTH_INDICATOR_COOKIE = "akunta_auth";
