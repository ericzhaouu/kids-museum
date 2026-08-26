import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const configured = hasSupabaseConfig();
  if (configured) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect("/studio");
    }
  }

  return <LoginForm configured={configured} />;
}
