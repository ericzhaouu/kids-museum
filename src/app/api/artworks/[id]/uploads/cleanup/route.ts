import { NextResponse } from "next/server";
import { z } from "zod";
import { artworkUploadCleanupRequestSchema } from "@/lib/artworks/contracts";
import { cleanupArtworkUploadSession } from "@/lib/artworks/server";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ArtworkUploadCleanupRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: ArtworkUploadCleanupRouteContext,
) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式。" },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "作品编号无效。" }, { status: 400 });
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求内容不是有效的 JSON。" },
      { status: 400 },
    );
  }

  const parsed = artworkUploadCleanupRequestSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "上传清理参数无效。" },
      { status: 400 },
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
    }

    await cleanupArtworkUploadSession(supabase, id, parsed.data.sessionId);
    return NextResponse.json({ cleanedUp: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "上传清理登记失败。";
    return NextResponse.json(
      { error: message },
      { status: message.includes("不存在或无权操作") ? 404 : 500 },
    );
  }
}
