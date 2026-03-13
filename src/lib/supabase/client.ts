"use client";

import { createBrowserClient } from "@supabase/ssr";

import { envClient } from "@/lib/env/client";

export const createSupabaseBrowserClient = () =>
  createBrowserClient(envClient.supabaseUrl, envClient.supabaseAnonKey);
