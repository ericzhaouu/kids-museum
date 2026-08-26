import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { hasSupabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: true, mode: "preview" });
  }

  try {
    const { error } = await createAdminSupabaseClient()
      .from("museum_profiles")
      .select("id")
      .limit(1);
    if (error) {
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, mode: "local-supabase" });
  } catch {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
