import { NextResponse, type NextRequest } from "next/server";

// httpOnly session cookie set by the backend (AUTH_COOKIE_NAME). Middleware can only check for its
// presence, not verify the JWT (the API remains the real authorization boundary) — but this stops
// protected route shells from rendering for anonymous visitors and removes the client-gate flash.
const SESSION_COOKIE = "qlix_session";

// Route groups that require an authenticated session. The Next route-group folder `(dashboard)`
// does not appear in the URL, so we match the child segments directly.
const PROTECTED_PREFIXES = ["/individual", "/organization", "/overview", "/admin"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/individual/:path*", "/organization/:path*", "/overview/:path*", "/admin/:path*"],
};
