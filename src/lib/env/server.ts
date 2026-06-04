/**
 * Server-side environment access.
 *
 * Values are resolved lazily through getters so that importing this module
 * never throws at load time. That matters because `middleware.ts` (which runs
 * on every request, including the public landing/login page) imports this
 * module: an eager `throw` on one unrelated missing var (e.g. RUNPOD_API_KEY)
 * used to 500 the entire site — including login — even though middleware only
 * needs the Supabase URL + anon key.
 *
 * Each value also accepts the alternative names that hosting providers expose
 * (Supabase integrations, Vercel, this cloud sandbox), so the same code works
 * whether the platform sets NEXT_PUBLIC_SUPABASE_URL or SUPABASE_API_URL, etc.
 */

const pick = (...names: string[]): string => {
  for (const name of names) {
    const value = process.env[name];
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
      pick("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_API_URL", "SUPABASE_URL"),
    );
  },
  get supabaseAnonKey(): string {
    return requireVal(
      "Supabase anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY)",
      pick("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"),
    );
  },
  get supabaseSecretKey(): string {
    return pick("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  },
  get supabaseServiceRoleKey(): string {
    return pick("SUPABASE_SERVICE_ROLE_KEY");
  },
  get supabaseAccessToken(): string {
    return pick("SUPABASE_ACCESS_TOKEN");
  },
  get supabaseProjectRef(): string {
    return pick("SUPABASE_PROJECT_REF", "SUPABASE_PROJECT_ID");
  },
  get runpodApiKey(): string {
    return pick("RUNPOD_API_KEY");
  },
  get falKey(): string {
    return pick("FAL_KEY", "FAL_API_KEY");
  },
  get atlasCloudApiKey(): string {
    return pick("ATLAS_CLOUD_API_KEY", "ATLASCLOUD_API_KEY");
  },
};
