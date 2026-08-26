"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/auth-storage";
import { getBrowserSupabaseConfig } from "@/lib/supabase/config";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createBrowserSupabaseClient() {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getBrowserSupabaseConfig();
  browserClient = createBrowserClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
    },
  });
  return browserClient;
}
