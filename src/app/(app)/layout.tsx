import { redirect } from "next/navigation";

import { AppExperienceShell } from "@/components/app/AppExperienceShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AuthenticatedAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let user = null;
  try {
    const supabase = await createSupabaseServerClient();
    // Hard timeout so a slow/hanging Supabase call can't stall the render into a
    // gateway timeout — degrade to "unauthenticated" and bounce to login.
    const { data } = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("supabase-timeout")), 4000)),
    ]);
    user = data.user;
  } catch {
    // Couldn't reach Supabase to validate the session — treat as unauthenticated
    // and bounce to login instead of throwing a 500/504. (redirect() must stay
    // outside the try: it works by throwing a control-flow signal internally.)
    user = null;
  }

  if (!user) {
    redirect("/login");
  }

  return <AppExperienceShell userEmail={user.email || "Unknown"}>{children}</AppExperienceShell>;
}
