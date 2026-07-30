import { NextResponse, type NextRequest } from "next/server";
import {
  authIsConfigured,
  requestIsAuthenticated,
} from "./lib/auth";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (authIsConfigured() && requestIsAuthenticated(request)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: authIsConfigured()
          ? "Authentication required."
          : "Authentication environment variables are not configured.",
      },
      { status: authIsConfigured() ? 401 : 503 }
    );
  }

  const loginUrl = new URL("/login", request.url);
  if (!authIsConfigured()) loginUrl.searchParams.set("setup", "required");
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.png|og.png|file.svg|globe.svg|window.svg).*)",
  ],
};
