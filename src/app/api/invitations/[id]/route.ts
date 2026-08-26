import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type InvitationRouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_: Request, context: InvitationRouteContext) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "Supabase 尚未配置，无法撤销邀请。" },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "邀请编号无效。" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
  }

  const { data: invitation, error: invitationError } = await supabase
    .from("invitations")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (invitationError) {
    return NextResponse.json(
      { error: `邀请权限校验失败：${invitationError.message}` },
      { status: 500 },
    );
  }
  if (!invitation) {
    return NextResponse.json({ error: "邀请不存在或无权操作。" }, { status: 404 });
  }

  const { data: revoked, error: revokeError } = await supabase.rpc(
    "revoke_invitation",
    { p_invitation_id: id },
  );
  if (revokeError) {
    return NextResponse.json(
      { error: `邀请撤销失败：${revokeError.message}` },
      { status: 500 },
    );
  }
  if (!revoked) {
    return NextResponse.json({ error: "邀请不存在或无权操作。" }, { status: 404 });
  }

  return NextResponse.json({
    revoked: true,
    revokedAt: new Date().toISOString(),
  });
}
