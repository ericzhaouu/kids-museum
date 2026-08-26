import { NextResponse } from "next/server";
import { createArtworkDraftRequestSchema } from "@/lib/artworks/contracts";
import {
  createArtworkDraft,
  getCuratorMuseum,
  listOwnedArtworks,
  loadArtworkResponse,
  toStudioArtwork,
} from "@/lib/artworks/server";
import { NO_MUSEUM_PROFILE_MESSAGE } from "@/lib/museum-management";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式。" },
      { status: 503 },
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

    const artworks = await Promise.all(
      (await listOwnedArtworks(supabase)).map((artwork) =>
        toStudioArtwork(supabase, artwork),
      ),
    );
    return NextResponse.json({ artworks });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "作品读取失败。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式，作品不会上传到云端。" },
      { status: 503 },
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

    const requestBody = await request.json();
    const parsed = createArtworkDraftRequestSchema.safeParse(requestBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "作品信息无效。" },
        { status: 400 },
      );
    }

    const museum = await getCuratorMuseum(supabase, user.id);
    const artwork = await createArtworkDraft(supabase, museum.id, parsed.data);

    return NextResponse.json(
      { artwork: await loadArtworkResponse(supabase, artwork.id) },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "作品保存失败。" },
      {
        status:
          error instanceof Error && error.message === NO_MUSEUM_PROFILE_MESSAGE
            ? 409
            : 500,
      },
    );
  }
}
