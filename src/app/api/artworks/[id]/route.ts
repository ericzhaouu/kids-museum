import { NextResponse } from "next/server";
import { z } from "zod";
import { patchArtworkRequestSchema } from "@/lib/artworks/contracts";
import {
  commitArtworkUpdate,
  getOwnedArtwork,
  loadArtworkResponse,
} from "@/lib/artworks/server";
import { NO_MUSEUM_PROFILE_MESSAGE } from "@/lib/museum-management";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ArtworkRouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: ArtworkRouteContext) {
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
  const parsed = patchArtworkRequestSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "作品信息无效。" },
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

    const artwork = await getOwnedArtwork(supabase, id);
    if (!artwork) {
      return NextResponse.json({ error: "作品不存在或无权操作。" }, { status: 404 });
    }

    const result = await commitArtworkUpdate(supabase, id, parsed.data);
    return NextResponse.json({
      artwork: await loadArtworkResponse(supabase, id),
      warning: result.warning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "作品修改失败。";
    const status = message.includes("不存在或无权操作")
      ? 404
      : message === NO_MUSEUM_PROFILE_MESSAGE
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_: Request, context: ArtworkRouteContext) {
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

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
    }

    const artwork = await getOwnedArtwork(supabase, id);
    if (!artwork) {
      return NextResponse.json({ error: "作品不存在或无权操作。" }, { status: 404 });
    }

    const { data, error: deleteError } = await supabase.rpc(
      "delete_artwork",
      { p_artwork_id: id },
    );
    if (deleteError) {
      if (deleteError.message.includes("ARTWORK_IN_PUBLISHED_EXHIBITION")) {
        return NextResponse.json(
          { error: "作品正在已发布展览中，请先从展览移除或归档展览。" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: `作品档案删除失败：${deleteError.message}` },
        { status: 500 },
      );
    }
    if (!data || typeof data !== "object") {
      return NextResponse.json(
        { error: "作品不存在或无权操作。" },
        { status: 404 },
      );
    }
    const payload = data as { cleanupJobId?: string | null; paths?: string[] };

    return NextResponse.json({
      deleted: true,
      mediaCleanupPending: (payload.paths ?? []).length > 0,
      cleanupJobId: payload.cleanupJobId ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "作品删除失败。" },
      {
        status:
          error instanceof Error && error.message === NO_MUSEUM_PROFILE_MESSAGE
            ? 409
            : 500,
      },
    );
  }
}
