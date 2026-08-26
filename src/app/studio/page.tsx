import { StudioDashboard } from "@/components/studio-dashboard";
import { redirect } from "next/navigation";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function StudioPage() {
  const cloudEnabled = hasSupabaseConfig();
  if (cloudEnabled) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/login");
    }
  }

  return <StudioDashboard cloudEnabled={cloudEnabled} />;
}
