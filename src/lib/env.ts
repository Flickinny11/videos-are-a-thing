const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const env = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  supabaseAccessToken: process.env.SUPABASE_ACCESS_TOKEN || "",
  supabaseProjectRef: required("SUPABASE_PROJECT_REF"),
  runpodApiKey: required("RUNPOD_API_KEY"),
  appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000",
};
