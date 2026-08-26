import { NextResponse } from "next/server";
import {
  normalizeEditableExhibition,
  validateExhibitionForPublish,
  type EditableExhibition,
} from "@/lib/exhibition-curation";
import { listOwnedArtworks } from "@/lib/artworks/server";
import {
  listEditableExhibitions,
  saveEditableExhibition,
} from "@/lib/exhibitions/editor-server";
import { parseExhibitionRequest } from "@/app/api/exhibitions/route-helpers";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    if (!hasSupabaseConfig()) {
      return NextResponse.json({ error: "当前处于本地预览模式。" }, { status: 503 });
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
    }

    return NextResponse.json(await listEditableExhibitions(supabase));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "展览读取失败。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseConfig()) {
      return NextResponse.json({ error: "当前处于本地预览模式。" }, { status: 503 });
    }

    const parsed = parseExhibitionRequest(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "展览信息无效。" },
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

    const normalized = normalizeEditableExhibition({
      ...parsed.data,
      themeId: parsed.data.themeId as EditableExhibition["themeId"],
    });
    const artworks = await listOwnedArtworks(supabase);
    const publishCheck = validateExhibitionForPublish(normalized, artworks);
    if (normalized.status === "published" && !publishCheck.valid) {
      return NextResponse.json(
        { error: publishCheck.issues[0]?.message ?? "当前展览还不能发布。" },
        { status: 400 },
      );
    }

    const exhibition = await saveEditableExhibition(supabase, normalized);
    return NextResponse.json({
      exhibition,
      publishable: publishCheck.valid,
      issues: publishCheck.issues.map((issue) => issue.message),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "展览保存失败。" },
      { status: 500 },
    );
  }
}
