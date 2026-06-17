import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { envServer } from "@/lib/env/server";
import { createSimpleAuthToken, isSimpleAuthCredential, SIMPLE_AUTH_COOKIE } from "@/lib/simple-auth";

const redirectPreservingCookies = (request: NextRequest, pathname: string, base: NextResponse) => {
  const url = new URL(pathname, request.url);
  const redirect = NextResponse.redirect(url, { status: 303 });
  base.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
};

const isFetchLogin = (request: NextRequest) =>
  request.headers.get("x-requested-with") === "fetch-login";

const loginFailure = (request: NextRequest, message: string, response: NextResponse) => {
  if (isFetchLogin(request)) {
    return NextResponse.json({ success: false, message }, { status: 401 });
  }

  const pathname = `/login?error=${encodeURIComponent(message)}`;
  return redirectPreservingCookies(request, pathname, response);
};

export async function POST(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(envServer.supabaseUrl, envServer.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return loginFailure(request, "Email and password are required.", response);
  }

  if (isSimpleAuthCredential(email, password)) {
    response.cookies.set(SIMPLE_AUTH_COOKIE, createSimpleAuthToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return loginFailure(request, error.message || "Login failed.", response);
    }
  }

  if (isFetchLogin(request)) {
    const json = NextResponse.json({ success: true });
    response.cookies.getAll().forEach((cookie) => json.cookies.set(cookie));
    return json;
  }

  return redirectPreservingCookies(request, "/studio", response);
}
