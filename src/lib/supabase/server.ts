import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/auth-storage";
import { getSupabaseServerConfig } from "@/lib/server-env";

export async function createServerSupabaseClient() {
  const { url, anonKey } = getSupabaseServerConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    auth: {
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });
}
