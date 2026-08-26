import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/auth-storage";
import { getBrowserSupabaseConfig } from "@/lib/supabase/config";

export function createBrowserSupabaseClient() {
  const { url, anonKey } = getBrowserSupabaseConfig();
  return createBrowserClient(url, anonKey, {
    auth: {
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
    },
  });
}
