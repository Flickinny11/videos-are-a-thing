import { createClient } from "@supabase/supabase-js";

import { envServer } from "@/lib/env/server";

const serviceKey = envServer.supabaseServiceRoleKey || envServer.supabaseSecretKey;

export const supabaseService = createClient(envServer.supabaseUrl, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
