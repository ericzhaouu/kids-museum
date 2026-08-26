import "server-only";

import { cookies } from "next/headers";
import { hashInvitationToken } from "@/lib/invitations";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const VISITOR_COOKIE = "museum_visitor";

export async function resolveAccessibleMuseumId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: museum, error: museumError } = await supabase
      .from("museum_profiles")
      .select("id")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (museumError) {
      throw new Error(`馆长权限校验失败：${museumError.message}`);
    }
    return museum?.id ?? null;
  }

  const visitorToken = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (!visitorToken) {
    return null;
  }

  const sessionHash = await hashInvitationToken(visitorToken);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("visitor_sessions")
    .select(
      "id, expires_at, revoked_at, invitations!inner(museum_id, expires_at, revoked_at)",
    )
    .eq("session_hash", sessionHash)
    .maybeSingle();

  if (error) {
    throw new Error(`访客会话校验失败：${error.message}`);
  }
  if (!data || data.revoked_at || new Date(data.expires_at) <= new Date()) {
    return null;
  }

  const invitation = Array.isArray(data.invitations)
    ? data.invitations[0]
    : data.invitations;
  if (
    invitation &&
    !invitation.revoked_at &&
    new Date(invitation.expires_at) > new Date()
  ) {
    return invitation.museum_id;
  }
  return null;
}
