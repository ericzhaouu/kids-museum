import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getOwnedArtwork,
  insertAiSuggestions,
  listArtworkSuggestions,
} from "@/lib/artworks/server";
import {
  consumeAiRateLimit,
  parseProviderSuggestion,
  parseSuggestionRequest,
} from "@/app/api/ai/suggest/route-helpers";
import { getAiVisionConfig } from "@/lib/server-env";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const PROVIDER_TIMEOUT_MS = 20_000;

type ProviderPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function GET(request: NextRequest) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式。" },
      { status: 503 },
    );
  }

  const artworkId = request.nextUrl.searchParams.get("artworkId");
  if (!artworkId || !z.string().uuid().safeParse(artworkId).success) {
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

    const artwork = await getOwnedArtwork(supabase, artworkId);
    if (!artwork) {
      return NextResponse.json({ error: "作品不存在或无权操作。" }, { status: 404 });
    }

    return NextResponse.json({
      suggestions: await listArtworkSuggestions(supabase, artworkId),
      sourceVersion: artwork.source_version,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 建议读取失败。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "当前处于本地预览模式，无法生成可审核的 AI 建议。" },
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

    const parsed = parseSuggestionRequest(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "请求内容无效。" },
        { status: 400 },
      );
    }

    const artwork = await getOwnedArtwork(supabase, parsed.data.artworkId);
    if (!artwork) {
      return NextResponse.json({ error: "作品不存在或无权操作。" }, { status: 404 });
    }

    const displayAsset = artwork.artwork_assets.find(
      (asset) => asset.kind === "display",
    );
    if (!displayAsset) {
      return NextResponse.json(
        { error: "作品尚未上传可供 AI 审阅的安全图片。" },
        { status: 400 },
      );
    }

    const rateLimit = consumeAiRateLimit(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后重试。" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const config = getAiVisionConfig();
    const { data: imageBlob, error: imageError } = await supabase.storage
      .from("museum-private")
      .download(displayAsset.storage_path);
    if (imageError || !imageBlob) {
      return NextResponse.json(
        { error: `作品图片读取失败：${imageError?.message ?? "未知错误"}` },
        { status: 500 },
      );
    }

    const dataUrl = await blobToDataUrl(imageBlob, displayAsset.mime_type);
    const childQuote =
      artwork.artwork_notes.find((note) => note.source === "child")?.content ?? "";

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), PROVIDER_TIMEOUT_MS);
    let providerResponse: Response;
    let providerPayload: ProviderPayload | null = null;
    try {
      providerResponse = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.7,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "你是儿童个人博物馆的策展助手。尊重孩子的原始表达，不诊断、不评价天赋、不推断身份。请仅返回 JSON，字段为 title、description、tags。标题自然、有童趣；介绍 60-120 个中文字符；标签 2-5 个。",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `媒介：${artwork.medium || "未填写"}\n孩子原话：${childQuote || "未填写"}`,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: dataUrl,
                    detail: "low",
                  },
                },
              ],
            },
          ],
        }),
        cache: "no-store",
        signal: abortController.signal,
      });
      if (providerResponse.ok) {
        providerPayload = (await providerResponse.json()) as ProviderPayload;
      }
    } catch {
      return NextResponse.json(
        {
          error: abortController.signal.aborted
            ? "AI 服务响应超时，请稍后重试。"
            : "AI 服务暂时无法连接，请稍后重试。",
        },
        { status: abortController.signal.aborted ? 504 : 502 },
      );
    } finally {
      clearTimeout(timeout);
    }

    const providerRequestId =
      providerResponse.headers.get("x-request-id") ?? null;
    if (!providerResponse.ok) {
      return NextResponse.json(
        {
          error: `AI 服务暂时不可用，请稍后重试${providerRequestId ? `（请求号：${providerRequestId}）` : ""}。`,
        },
        { status: 502 },
      );
    }
    const content = providerPayload?.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "AI 服务没有返回可用建议，请重试。" },
        { status: 502 },
      );
    }

    const suggestion = parseProviderSuggestion(content);
    if (!suggestion.success) {
      return NextResponse.json(
        {
          error:
            suggestion.error.issues[0]?.message ?? "AI 返回内容不完整，请重试。",
        },
        { status: 502 },
      );
    }

    const latestArtwork = await getOwnedArtwork(supabase, artwork.id);
    if (
      !latestArtwork ||
      latestArtwork.source_version !== artwork.source_version
    ) {
      return NextResponse.json(
        { error: "作品在 AI 生成期间已被修改，请重新生成建议。" },
        { status: 409 },
      );
    }

    const { error: staleError } = await supabase
      .from("ai_suggestions")
      .update({ status: "stale", reviewed_at: new Date().toISOString() })
      .eq("artwork_id", artwork.id)
      .eq("status", "pending");
    if (staleError) {
      throw new Error(`旧 AI 建议过期处理失败：${staleError.message}`);
    }

    await insertAiSuggestions(
      supabase,
      artwork.id,
      latestArtwork.source_version,
      providerRequestId,
      suggestion.data,
    );

    return NextResponse.json({
      suggestion: suggestion.data,
      suggestions: await listArtworkSuggestions(supabase, artwork.id),
      sourceVersion: latestArtwork.source_version,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 建议生成失败。" },
      { status: 500 },
    );
  }
}

async function blobToDataUrl(blob: Blob, mimeType: string) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
