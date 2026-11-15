import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { ACCESS_DENIED_HEADER, checkAccess, denialMessage, isReadMethod } from "@/lib/auth/roles";
import {
  ACCESS_COOKIE_NAME,
  readAccessCookie,
  REQUEST_METHOD_HEADER,
  REQUEST_PATH_HEADER,
  REQUEST_SIGNATURE_HEADER,
  signRequestLine
} from "@/lib/auth/signing";

// Auth entry points — redirect to /dashboard if already logged in
const AUTH_ROUTES = ["/login", "/register", "/sign-in"];

// Public API routes — no session required
const PUBLIC_API_ROUTES = [
  "/api/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/complete-supabase",
  "/api/auth/register",
  "/api/auth/verify",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/bankid",
  // Accepting an invitation works signed in or not; the handler checks the
  // invitation token and, when there is a session, the signed-in email.
  "/api/invitations/accept",
  // Machine-to-machine callbacks. Each handler verifies its own signature or
  // shared secret, so they must not be gated on a browser session.
  "/api/billing/webhook",
  "/api/queue/ocr",
  "/api/receipts/email-webhook",
  // Scheduled jobs. Each handler requires the CRON_SECRET bearer token.
  "/api/cron",
  "/api/settings/locale",
  "/api/health",
  "/api/support"
];

// Public site routes — no session required, available to anyone
const PUBLIC_SITE_PREFIXES = [
  "/", "/blog", "/help", "/support", "/resources", "/pricing", "/welcome",
  "/forgot-password", "/reset-password", "/privacy", "/terms",
  // Invitation links must open for someone who has no account yet.
  "/invite"
];

// Shown to a signed-in person who is not a member of any business. It lives
// under /login so it gets the plain layout, but it must not bounce a signed-in
// visitor to the dashboard (which would send them straight back).
const NO_ACCESS_ROUTE = "/login/no-access";

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

// Sensitive sub-routes that must remain protected even if their parent is public
const PROTECTED_API_SUBROUTES = ["/api/health/smtp"];

function isPublicApiRoute(pathname: string): boolean {
  if (PROTECTED_API_SUBROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return false;
  }
  return PUBLIC_API_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

function isPublicSiteRoute(pathname: string): boolean {
  // Exact "/" or anything under public site prefixes (but not /api/* which is handled separately)
  if (pathname === "/") return true;
  // Sentry tunnel (next.config.mjs tunnelRoute) must work for logged-out visitors.
  if (pathname === "/monitoring-tunnel") return true;
  return PUBLIC_SITE_PREFIXES.filter((p) => p !== "/").some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

// Forwards the request with the pathname and method the app may trust. Both
// are overwritten here, so a value sent by the client never reaches a handler,
// and they are signed so a handler can tell they came from this proxy.
const forward = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, pathname);
  requestHeaders.set(REQUEST_METHOD_HEADER, method);
  requestHeaders.set(REQUEST_SIGNATURE_HEADER, await signRequestLine(method, pathname));
  return NextResponse.next({ request: { headers: requestHeaders } });
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Session token presence check only — full DB validation happens in route handlers.
  // No DB calls at the edge.
  const sessionToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const hasSessionCookie = Boolean(sessionToken);

  // Public API — always allow
  if (isPublicApiRoute(pathname)) {
    return forward(request);
  }

  // Auth routes (/login, /register, /sign-in) — redirect to dashboard if already logged in
  if (isAuthRoute(pathname)) {
    // ?expired=1 is where a page sends a visitor whose cookie no longer matches
    // a session. Showing the form (instead of bouncing to the dashboard, which
    // would bounce back) lets them sign in again.
    const staleSession = request.nextUrl.searchParams.get("expired") === "1";
    const noAccessPage = pathname === NO_ACCESS_ROUTE;
    if (hasSessionCookie && !staleSession && !noAccessPage) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return forward(request);
  }

  // Public site pages — always allow, no redirect
  if (isPublicSiteRoute(pathname)) {
    return forward(request);
  }

  // Everything else requires a session
  if (!hasSessionCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // A clean 403 for members whose role does not allow this request. The signed
  // role cookie can only cause a refusal here: when it is missing, expired or
  // does not verify, the request goes on and requireAuthContext() decides from
  // the database.
  if (!isReadMethod(request.method)) {
    const access = await readAccessCookie(request.cookies.get(ACCESS_COOKIE_NAME)?.value, sessionToken);
    const denial = access ? checkAccess(access.role, request.method, pathname) : null;
    if (denial) {
      return NextResponse.json(
        { error: denialMessage(denial, request.cookies.get("locale")?.value), code: denial },
        { status: 403, headers: { [ACCESS_DENIED_HEADER]: denial } }
      );
    }
  }

  return forward(request);
}

export const config = {
  // Every /api path runs through the proxy, including ones with a dot in a
  // segment (the second pattern skips those as static files). Otherwise a
  // request such as /api/x/a.b would reach its handler without the signed
  // method header.
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
