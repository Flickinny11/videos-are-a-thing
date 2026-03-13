import { redirect } from "next/navigation";

import { AppExperienceShell } from "@/components/app/AppExperienceShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AuthenticatedAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <AppExperienceShell userEmail={user.email || "Unknown"}>{children}</AppExperienceShell>;
}
