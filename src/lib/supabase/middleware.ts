import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { envServer } from "@/lib/env/server";

/**
 * Refresh the Supabase session for the incoming request and report whether a
 * *valid* user is authenticated.
 *
 * Two resilience rules keep a Supabase hiccup from taking the whole site down
 * with a 504 (the middleware runs on every request):
 *
 *  1. We only make a network round-trip when an auth cookie is actually present.
 *     Logged-out traffic — most importantly the public landing page — never
 *     touches Supabase, so it can never 504 here.
 *  2. The `getUser()` validation is wrapped in try/catch. On a transient network
 *     failure we report `authResolved: false` so the caller declines to make a
 *     routing decision instead of crashing.
 *
 * Validating with `getUser()` (rather than trusting the cookie's mere presence)
 * is what avoids redirect loops: an expired session has a cookie but no user,
 * and `@supabase/ssr` clears the bad cookie via `setAll` on the response.
 */
export const updateSession = async (request: NextRequest) => {
  let response = NextResponse.next({ request });

  const hasAuthCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.includes("auth-token"));

  // No session cookie → definitively logged out. Skip the Supabase call.
  if (!hasAuthCookie) {
    return { response, user: null, authResolved: true };
  }

  const supabase = createServerClient(envServer.supabaseUrl, envServer.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    // getUser() validates the JWT with Supabase Auth.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { response, user, authResolved: true };
  } catch {
    // Network failure reaching Supabase Auth (e.g. a transient `fetch failed`).
    // Let the request proceed without a routing decision rather than 504-ing.
    return { response, user: null, authResolved: false };
  }
};
