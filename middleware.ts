import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");
  const hasAuthToken = request.cookies
    .getAll()
    .some((cookie) => cookie.name.includes("auth-token"));

  if (!hasAuthToken && !isAuthRoute && !request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (hasAuthToken && isAuthRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
