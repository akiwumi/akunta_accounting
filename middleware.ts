import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, isAuthenticatedToken } from "@/lib/auth/session";

const PUBLIC_ROUTES = ["/login", "/api/auth/login", "/api/auth/logout"];

const isPublicRoute = (pathname: string) =>
  PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

const withPathHeader = (request: NextRequest) => {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasSession = isAuthenticatedToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  if (isPublicRoute(pathname)) {
    if (pathname === "/login" && hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return withPathHeader(request);
  }

  if (!hasSession) {
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
  // Exclude Next.js static internals and all file-like requests from middleware.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
