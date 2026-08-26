import { NextResponse } from "next/server";
import {
  deleteMuseumPayloadSchema,
  initializeMuseumPayloadSchema,
  matchesMuseumDeleteConfirmation,
} from "@/lib/museum-management";
import { processPendingMediaCleanupJobs } from "@/lib/media-cleanup";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({
      museum: null,
      cloudEnabled: false,
      canInitialize: false,
    });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
  }

  const { data: museum, error } = await supabase
    .from("museum_profiles")
    .select("id, name, artist_nickname, theme_id, theme_version, created_at, updated_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: `博物馆资料读取失败：${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    museum: museum
      ? {
          id: museum.id,
          name: museum.name,
          artistNickname: museum.artist_nickname,
          themeId: museum.theme_id,
          themeVersion: museum.theme_version,
          createdAt: museum.created_at,
          updatedAt: museum.updated_at,
        }
      : null,
    cloudEnabled: true,
    canInitialize: !museum,
  });
}

export async function POST(request: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式。" },
      { status: 503 },
    );
  }

  const parsed = initializeMuseumPayloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "博物馆资料无效。" },
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

  const { data: existing } = await supabase
    .from("museum_profiles")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "当前账号已拥有博物馆，无需重复初始化。" },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("museum_profiles")
    .insert({
      owner_id: user.id,
      name: parsed.data.name,
      artist_nickname: parsed.data.artistNickname,
      theme_id: parsed.data.themeId,
    })
    .select("id, name, artist_nickname, theme_id, theme_version, created_at, updated_at")
    .single();
  if (error) {
    return NextResponse.json(
      { error: `博物馆初始化失败：${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      museum: {
        id: data.id,
        name: data.name,
        artistNickname: data.artist_nickname,
        themeId: data.theme_id,
        themeVersion: data.theme_version,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    },
    { status: 201 },
  );
}

export async function DELETE(request: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式。" },
      { status: 503 },
    );
  }

  const parsed = deleteMuseumPayloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "删除确认无效。" },
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
    .select("id, name")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (museumError) {
    return NextResponse.json(
      { error: `博物馆资料读取失败：${museumError.message}` },
      { status: 500 },
    );
  }
  if (!museum) {
    return NextResponse.json(
      { error: "当前账号尚未初始化博物馆，请先创建新的馆藏空间。" },
      { status: 409 },
    );
  }
  if (!matchesMuseumDeleteConfirmation(parsed.data.confirmationText, museum.name)) {
    return NextResponse.json(
      { error: "删除确认不匹配，请输入博物馆名称或固定确认短语。" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("delete_museum_permanently");
  if (error) {
    return NextResponse.json(
      { error: `全馆删除失败：${error.message}` },
      { status: 500 },
    );
  }

  await processPendingMediaCleanupJobs(10).catch(() => undefined);

  return NextResponse.json({
    deleted: true,
    preservedAuthUser: true,
    cleanupJobId:
      data && typeof data === "object" && "cleanupJobId" in data
        ? (data.cleanupJobId ?? null)
        : null,
  });
}
