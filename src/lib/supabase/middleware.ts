import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { envServer } from "@/lib/env/server";

/**
 * Refresh the Supabase session for the incoming request and report whether a
 * *valid* user is authenticated.
 *
 * Returning the resolved `user` (instead of only checking for the presence of
 * an `auth-token` cookie) is what lets the middleware avoid redirect loops: a
 * stale/expired cookie is still a cookie, but `getUser()` will reject it, and
 * `@supabase/ssr` clears the bad cookie via `setAll` on the returned response.
 */
export const updateSession = async (request: NextRequest) => {
  let response = NextResponse.next({ request });

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

  // IMPORTANT: getUser() validates the JWT with Supabase Auth. Do not trust the
  // cookie's mere existence — an expired session has a cookie but no user.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
};
