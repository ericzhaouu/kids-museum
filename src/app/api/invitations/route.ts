import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createInvitationToken,
  hashInvitationToken,
} from "@/lib/invitations";
import {
  serializeInvitation,
  type InvitationRow,
  type VisitorSessionRow,
} from "@/app/api/invitations/invitation-state";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const createInvitationSchema = z.object({
  label: z.string().trim().max(80).default("家人邀请"),
  validDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7),
});

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "Supabase 尚未配置，无法读取邀请。" },
      { status: 503 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
  }

  const { data: invitations, error: invitationsError } = await supabase
    .from("invitations")
    .select("id, label, expires_at, revoked_at, created_at")
    .order("created_at", { ascending: false });
  if (invitationsError) {
    return NextResponse.json(
      { error: `邀请读取失败：${invitationsError.message}` },
      { status: 500 },
    );
  }

  const invitationIds = invitations.map((invitation) => invitation.id);
  let sessions: VisitorSessionRow[] = [];
  if (invitationIds.length > 0) {
    const { data, error: sessionsError } = await supabase
      .from("visitor_sessions")
      .select("id, invitation_id, expires_at, revoked_at, last_seen_at")
      .in("invitation_id", invitationIds);
    if (sessionsError) {
      return NextResponse.json(
        { error: `家庭访问记录读取失败：${sessionsError.message}` },
        { status: 500 },
      );
    }
    sessions = data;
  }

  return NextResponse.json({
    invitations: (invitations as InvitationRow[]).map((invitation) =>
      serializeInvitation(invitation, sessions),
    ),
  });
}

export async function POST(request: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "Supabase 尚未配置，无法创建真实邀请。" },
      { status: 503 },
    );
  }

  const parsed = createInvitationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "邀请参数无效。" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
  }

  const { data: museum, error: museumError } = await supabase
    .from("museum_profiles")
    .select("id")
    .eq("owner_id", user.id)
    .single();
  if (museumError) {
    return NextResponse.json(
      { error: `找不到博物馆资料：${museumError.message}` },
      { status: 500 },
    );
  }

  const token = createInvitationToken();
  const tokenHash = await hashInvitationToken(token);
  const expiresAt = new Date(
    Date.now() + parsed.data.validDays * 24 * 60 * 60 * 1000,
  );
  const { data: invitation, error: insertError } = await supabase
    .from("invitations")
    .insert({
      museum_id: museum.id,
      token_hash: tokenHash,
      label: parsed.data.label,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, label, expires_at, revoked_at, created_at")
    .single();
  if (insertError) {
    return NextResponse.json(
      { error: `邀请创建失败：${insertError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    invitation: {
      ...serializeInvitation(invitation as InvitationRow, []),
      url: `${new URL(request.url).origin}/visit/${token}`,
    },
  });
}
