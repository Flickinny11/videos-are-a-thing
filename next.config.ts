import type { NextConfig } from "next";

/**
 * Bridge the Supabase env vars into the `NEXT_PUBLIC_*` names the browser
 * bundle reads. Different hosts name these differently — the Supabase/Vercel
 * integration and this cloud sandbox expose `SUPABASE_API_URL` /
 * `SUPABASE_ANON_KEY`, while local/manual setups use `NEXT_PUBLIC_*`. Resolving
 * here (build time) guarantees the browser always gets a real value, which is
 * what makes email/password login work in every environment.
 */
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_API_URL ||
  process.env.SUPABASE_URL ||
  "";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
  },
};

export default nextConfig;
