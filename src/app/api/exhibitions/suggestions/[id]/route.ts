import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewExhibitionSuggestion } from "@/lib/exhibitions/editor-server";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ExhibitionSuggestionReviewRouteContext = {
  params: Promise<{ id: string }>;
};

const reviewSchema = z.object({
  action: z.enum(["accept", "reject"]),
});

export async function PATCH(
  request: Request,
  context: ExhibitionSuggestionReviewRouteContext,
) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "当前处于本地预览模式。" }, { status: 503 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "建议编号无效。" }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(await request.json());
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

    const result = await reviewExhibitionSuggestion(supabase, id, parsed.data.action);
    return NextResponse.json({
      reviewed: true,
      exhibition: result.exhibition,
      suggestions: result.suggestions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "策展建议审核失败。";
    const status =
      message.includes("不存在或无权操作") || message.includes("已经过期") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
