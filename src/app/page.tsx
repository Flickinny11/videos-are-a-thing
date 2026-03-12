import { redirect } from "next/navigation";

import { MediaStudioClient } from "@/components/studio/MediaStudioClient";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <MediaStudioClient userEmail={user.email || "Unknown"} />;
}
