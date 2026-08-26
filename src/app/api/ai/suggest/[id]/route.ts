import { NextResponse } from "next/server";
import { z } from "zod";
import {
  applySuggestionReview,
  listArtworkSuggestions,
} from "@/lib/artworks/server";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const reviewSchema = z
  .object({
    action: z.enum(["accept", "reject"]),
  })
  .strict();

type SuggestionRouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: SuggestionRouteContext) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式。" },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "建议编号无效。" }, { status: 400 });
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
  const parsed = reviewSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "审核动作无效。" },
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

    const review = await applySuggestionReview(supabase, id, parsed.data.action);
    return NextResponse.json({
      reviewed: true,
      status: review.status,
      suggestions: await listArtworkSuggestions(supabase, review.artworkId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 建议审核失败。";
    const status = message.includes("不存在或无权操作") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
