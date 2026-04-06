export const AUTH_COOKIE_NAME = "akunta_session";

const DEFAULT_USERNAME = "owner@akunta.app";
const DEFAULT_PASSWORD = "Akunta2026!";
const DEFAULT_SESSION_TOKEN = "akunta-local-session";

export const AUTH_USERNAME = process.env.AKUNTA_LOGIN_USERNAME ?? DEFAULT_USERNAME;
export const AUTH_PASSWORD = process.env.AKUNTA_LOGIN_PASSWORD ?? DEFAULT_PASSWORD;
export const AUTH_SESSION_TOKEN = process.env.AKUNTA_SESSION_TOKEN ?? DEFAULT_SESSION_TOKEN;
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

export const verifyLoginCredentials = (username: string, password: string) =>
  username.trim().toLowerCase() === AUTH_USERNAME.trim().toLowerCase() && password === AUTH_PASSWORD;

export const isAuthenticatedToken = (token: string | undefined | null) => token === AUTH_SESSION_TOKEN;
