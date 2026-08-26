import { NextResponse } from "next/server";
import { resolveRequestOrigin } from "@/lib/request-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = resolveRequestOrigin(request);
  const code = url.searchParams.get("code");
  const destination = new URL("/studio", origin);

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", origin),
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Supabase auth callback failed", {
      code: error.code,
      message: error.message,
      status: error.status,
    });
    return NextResponse.redirect(
      new URL("/login?error=callback_failed", origin),
    );
  }

  return NextResponse.redirect(destination);
}
