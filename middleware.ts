import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";

// Auth entry points — redirect to /dashboard if already logged in
const AUTH_ROUTES = ["/login", "/register", "/sign-in"];

// Public API routes — no session required
const PUBLIC_API_ROUTES = [
  "/api/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/register",
  "/api/auth/verify",
  "/api/settings/locale",
  "/api/health",
  "/api/support"
];

// Public site routes — no session required, available to anyone
const PUBLIC_SITE_PREFIXES = ["/", "/blog", "/help", "/support", "/resources", "/pricing", "/welcome"];

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

function isPublicSiteRoute(pathname: string): boolean {
  // Exact "/" or anything under public site prefixes (but not /api/* which is handled separately)
  if (pathname === "/") return true;
  return PUBLIC_SITE_PREFIXES.filter((p) => p !== "/").some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

const withPathHeader = (request: NextRequest, response?: NextResponse) => {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  if (response) return response;
  return NextResponse.next({ request: { headers: requestHeaders } });
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Session token presence check only — full DB validation happens in route handlers.
  // No DB calls at the edge.
  const hasSessionCookie = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  // Public API — always allow
  if (isPublicApiRoute(pathname)) {
    return withPathHeader(request);
  }

  // Auth routes (/login, /register, /sign-in) — redirect to dashboard if already logged in
  if (isAuthRoute(pathname)) {
    if (hasSessionCookie) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return withPathHeader(request);
  }

  // Public site pages — always allow, no redirect
  if (isPublicSiteRoute(pathname)) {
    return withPathHeader(request);
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

  return withPathHeader(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
