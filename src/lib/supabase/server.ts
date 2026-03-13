import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { envServer } from "@/lib/env/server";

export const createSupabaseServerClient = async () => {
  const cookieStore = await cookies();

  return createServerClient(envServer.supabaseUrl, envServer.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server component context can be read-only. Middleware handles refresh.
        }
      },
    },
  });
};
