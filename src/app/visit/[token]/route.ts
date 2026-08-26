import { NextResponse } from "next/server";
import {
  createInvitationToken,
  hashInvitationToken,
} from "@/lib/invitations";
import { VISITOR_COOKIE } from "@/lib/museum-access";
import { resolveRequestOrigin } from "@/lib/request-origin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type VisitRouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: Request, context: VisitRouteContext) {
  const origin = resolveRequestOrigin(request);
  const { token } = await context.params;
  if (!token || token.length > 128) {
    return NextResponse.redirect(new URL("/login?invite=invalid", origin));
  }

  const tokenHash = await hashInvitationToken(token);
  const admin = createAdminSupabaseClient();
  const { data: invitation, error } = await admin
    .from("invitations")
    .select("id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (
    error ||
    !invitation ||
    invitation.revoked_at ||
    new Date(invitation.expires_at) <= new Date()
  ) {
    return NextResponse.redirect(new URL("/login?invite=expired", origin));
  }

  const visitorToken = createInvitationToken();
  const sessionHash = await hashInvitationToken(visitorToken);
  const invitationExpiry = new Date(invitation.expires_at);
  const sessionExpiry = new Date(
    Math.min(
      invitationExpiry.getTime(),
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ),
  );
  const { error: sessionError } = await admin.from("visitor_sessions").insert({
    invitation_id: invitation.id,
    session_hash: sessionHash,
    expires_at: sessionExpiry.toISOString(),
  });
  if (sessionError) {
    return NextResponse.redirect(new URL("/login?invite=failed", origin));
  }

  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.set(VISITOR_COOKIE, visitorToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: sessionExpiry,
  });
  return response;
}
