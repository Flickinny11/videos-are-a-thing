const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) throw new Error("Missing required env var: NEXT_PUBLIC_SUPABASE_URL");

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseAnonKey) throw new Error("Missing required env var: NEXT_PUBLIC_SUPABASE_ANON_KEY");

export const envClient = {
  supabaseUrl,
  supabaseAnonKey,
  appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000",
};
