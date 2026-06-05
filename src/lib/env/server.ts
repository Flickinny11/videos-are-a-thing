/**
 * Server-side environment access.
 *
 * Values are resolved lazily through getters so importing this module never
 * throws at load time — middleware.ts imports it on every request (including the
 * public login page), so an eager throw on one unrelated missing var used to
 * 500 the whole site.
 *
 * IMPORTANT: every value is read with a *static* `process.env.X` reference, not
 * dynamic `process.env[name]`. Middleware runs in the Edge runtime, where only
 * statically-analyzable references are inlined at build time; dynamic bracket
 * access with a variable key resolves to `undefined` in Edge and would crash
 * middleware (HTTP 504). The `firstNonEmpty(...)` helper therefore takes already
 * resolved values, so each `process.env.X` below stays statically analyzable.
 *
 * The fallback names let the same code work whether the host sets
 * NEXT_PUBLIC_SUPABASE_URL or SUPABASE_API_URL, etc. (`next.config.ts` also
 * bridges the NEXT_PUBLIC_* names the browser bundle needs.)
 */

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    if (value && value.trim()) return value;
  }
  return "";
};

const requireVal = (label: string, value: string): string => {
  if (!value) throw new Error(`Missing required configuration: ${label}`);
  return value;
};

export const envServer = {
  get supabaseUrl(): string {
    return requireVal(
      "Supabase URL (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_API_URL / SUPABASE_URL)",
      firstNonEmpty(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_API_URL,
        process.env.SUPABASE_URL,
      ),
    );
  },
  get supabaseAnonKey(): string {
    return requireVal(
      "Supabase anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY)",
      firstNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, process.env.SUPABASE_ANON_KEY),
    );
  },
  get supabaseSecretKey(): string {
    return firstNonEmpty(process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  get supabaseServiceRoleKey(): string {
    return firstNonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  get supabaseAccessToken(): string {
    return firstNonEmpty(process.env.SUPABASE_ACCESS_TOKEN);
  },
  get supabaseProjectRef(): string {
    return firstNonEmpty(process.env.SUPABASE_PROJECT_REF, process.env.SUPABASE_PROJECT_ID);
  },
  get runpodApiKey(): string {
    return firstNonEmpty(process.env.RUNPOD_API_KEY);
  },
  get falKey(): string {
    return firstNonEmpty(process.env.FAL_KEY, process.env.FAL_API_KEY);
  },
  get atlasCloudApiKey(): string {
    return firstNonEmpty(process.env.ATLAS_CLOUD_API_KEY, process.env.ATLASCLOUD_API_KEY);
  },
};
