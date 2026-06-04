/**
 * Client-side (browser) environment access.
 *
 * Only `NEXT_PUBLIC_*` variables are inlined into the browser bundle, so those
 * are the names referenced here. `next.config.ts` bridges the platform's
 * alternative names (SUPABASE_API_URL / SUPABASE_URL / SUPABASE_ANON_KEY) into
 * these at build time, so the correct values are baked in regardless of how the
 * hosting provider names them.
 *
 * This module intentionally does NOT throw at import time — a throw here would
 * break the login page render entirely ("nothing happens" when clicking Sign
 * in). If a value is genuinely missing the Supabase client call fails at use
 * time and the login form surfaces a readable error instead of a blank page.
 */

export const envClient = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000",
};
