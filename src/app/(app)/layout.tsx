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
    const { data } = await supabase.auth.getUser();
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
