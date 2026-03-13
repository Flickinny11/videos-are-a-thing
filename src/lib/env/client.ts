const requiredPublic = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const envClient = {
  supabaseUrl: requiredPublic("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: requiredPublic("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000",
};
