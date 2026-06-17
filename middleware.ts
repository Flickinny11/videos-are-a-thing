import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SIMPLE_AUTH_COOKIE, verifySimpleAuthToken } from "@/lib/simple-auth";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Build a redirect that preserves any auth cookies that `updateSession` set on
 * the original response (refreshed tokens, or — critically — the *removal* of a
 * stale cookie). Without copying these, a redirect would drop the cookie
 * mutation and the next request would loop right back here.
 */
const redirectPreservingCookies = (request: NextRequest, pathname: string, base: NextResponse) => {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  base.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
};

export async function middleware(request: NextRequest) {
  const simpleUser = verifySimpleAuthToken(request.cookies.get(SIMPLE_AUTH_COOKIE)?.value);
  const { response, user, authResolved } = simpleUser
    ? { response: NextResponse.next({ request }), user: simpleUser, authResolved: true }
    : await updateSession(request);

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/auth");
  const isApiRoute = pathname.startsWith("/api");

  // If we couldn't reach Supabase to validate the session, don't make a routing
  // decision — just let the request through. The page/layout will resolve auth
  // (or the next request will), and a transient hiccup never 504s the site.
  if (!authResolved) {
    return response;
  }

  // Unauthenticated (no valid session) and trying to reach a protected page →
  // send to the login form. API routes do their own auth and must not redirect.
  if (!user && !isAuthRoute && !isApiRoute) {
    return redirectPreservingCookies(request, "/login", response);
  }

  // Already authenticated but sitting on the login page → go straight to the
  // studio. Gating on the validated `user` (not a cookie name) prevents the
  // /login ⇄ / redirect loop that stale cookies used to trigger.
  if (user && isAuthRoute) {
    return redirectPreservingCookies(request, "/studio", response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
