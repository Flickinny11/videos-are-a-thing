import { cookies } from "next/headers";

import { SIMPLE_AUTH_COOKIE, verifySimpleAuthToken } from "@/lib/simple-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const requireUser = async (request?: Request) => {
  const simpleCookie = request?.headers.get("cookie")?.match(new RegExp(`${SIMPLE_AUTH_COOKIE}=([^;]+)`))?.[1] || (await cookies()).get(SIMPLE_AUTH_COOKIE)?.value;
  const simpleUser = verifySimpleAuthToken(simpleCookie);
  if (simpleUser) return simpleUser;
  const authHeader = request?.headers.get("authorization") || request?.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const { data, error } = await supabaseService.auth.getUser(token);
    if (!error && data?.user) {
      return data.user;
    }
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user;
};
