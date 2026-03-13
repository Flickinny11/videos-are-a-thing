"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { OglNebulaBackground } from "@/components/effects/OglNebulaBackground";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("Logantbaird@gmail.com");
  const [password, setPassword] = useState("Kilkinny!982");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      router.replace("/studio");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <OglNebulaBackground />
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-3xl border border-cyan-200/20 bg-slate-950/60 p-6 text-slate-100 backdrop-blur-2xl"
      >
        <h1 className="mb-1 text-3xl font-semibold">Media Studio Login</h1>
        <p className="mb-6 text-sm text-cyan-100/75">Supabase email/password access</p>

        <label className="mb-2 block text-xs uppercase tracking-[0.18em]">Email</label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          className="mb-4 w-full rounded-xl border border-cyan-100/25 bg-slate-900/80 p-3 outline-none focus:ring-2 focus:ring-cyan-300/45"
          required
        />

        <label className="mb-2 block text-xs uppercase tracking-[0.18em]">Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="mb-4 w-full rounded-xl border border-cyan-100/25 bg-slate-900/80 p-3 outline-none focus:ring-2 focus:ring-cyan-300/45"
          required
        />

        {error ? <p className="mb-4 text-sm text-rose-300">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-gradient-to-r from-cyan-300 to-blue-300 px-4 py-3 font-semibold text-slate-900 disabled:opacity-70"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
