import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateExhibitionSuggestions,
  getEditableExhibition,
  listExhibitionSuggestions,
} from "@/lib/exhibitions/editor-server";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ExhibitionSuggestionRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: ExhibitionSuggestionRouteContext) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "当前处于本地预览模式。" }, { status: 503 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "展览编号无效。" }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
    }

    const exhibition = await getEditableExhibition(supabase, id);
    if (!exhibition) {
      return NextResponse.json({ error: "展览不存在或无权操作。" }, { status: 404 });
    }

    return NextResponse.json({
      suggestions: await listExhibitionSuggestions(supabase, id),
      sourceVersion: exhibition.curationVersion ?? 1,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "策展建议读取失败。" },
      { status: 500 },
    );
  }
}

export async function POST(_: Request, context: ExhibitionSuggestionRouteContext) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式，无法生成可审核的策展建议。" },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "展览编号无效。" }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
    }

    return NextResponse.json(await generateExhibitionSuggestions(supabase, id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "策展建议生成失败。" },
      { status: 500 },
    );
  }
}
