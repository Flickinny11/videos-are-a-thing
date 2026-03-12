import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

const serviceKey = env.supabaseServiceRoleKey || env.supabaseSecretKey;

export const supabaseService = createClient(env.supabaseUrl, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
