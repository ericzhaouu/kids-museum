import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getOwnedArtwork,
  listArtworkSuggestions,
  saveTranscriptResult,
} from "@/lib/artworks/server";
import { getAiTranscriptionConfig } from "@/lib/server-env";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ArtworkRouteContext = {
  params: Promise<{ id: string }>;
};

const responseSchema = z.object({
  text: z.string().trim().min(1),
});

export async function POST(_: Request, context: ArtworkRouteContext) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式，无法转写录音。" },
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

    const audioAsset = artwork.artwork_assets.find((asset) => asset.kind === "audio");
    if (!audioAsset) {
      return NextResponse.json({ error: "该作品还没有可转写的录音。" }, { status: 400 });
    }

    const config = getAiTranscriptionConfig();
    const { data: audioBlob, error: audioError } = await supabase.storage
      .from("museum-private")
      .download(audioAsset.storage_path);
    if (audioError || !audioBlob) {
      return NextResponse.json(
        { error: `私密音频读取失败：${audioError?.message ?? "未知错误"}` },
        { status: 500 },
      );
    }

    const formData = new FormData();
    formData.set("model", config.model);
    formData.set(
      "file",
      new Blob([await audioBlob.arrayBuffer()], {
        type: audioAsset.mime_type,
      }),
      `artwork-audio.${mimeSubtype(audioAsset.mime_type)}`,
    );

    const providerResponse = await fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
      cache: "no-store",
    });
    const providerRequestId =
      providerResponse.headers.get("x-request-id") ?? null;
    if (!providerResponse.ok) {
      return NextResponse.json(
        {
          error: `转写服务暂时不可用，请稍后重试${providerRequestId ? `（请求号：${providerRequestId}）` : ""}。`,
        },
        { status: 502 },
      );
    }

    const payload = responseSchema.safeParse(await providerResponse.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: "转写服务返回内容无效，请重试。" },
        { status: 502 },
      );
    }

    await saveTranscriptResult(supabase, artwork, payload.data.text, providerRequestId);
    return NextResponse.json({
      transcript: payload.data.text,
      suggestions: await listArtworkSuggestions(supabase, artwork.id),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "录音转写失败。" },
      { status: 500 },
    );
  }
}

function mimeSubtype(mimeType: string) {
  return mimeType.split("/")[1] ?? "bin";
}
