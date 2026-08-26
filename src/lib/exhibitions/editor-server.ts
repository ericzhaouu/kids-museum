import { z } from "zod";
import {
  editableExhibitionSchema,
  normalizeEditableExhibition,
  normalizeRoomArtworkDisplayConfig,
  type EditableExhibition,
  type EditableExhibitionRoom,
  type ExhibitionAiSuggestion,
} from "@/lib/exhibition-curation";
import { isExhibitionThemeId } from "@/lib/exhibition-themes";
import { getAiVisionConfig } from "@/lib/server-env";

type SupabaseLike = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createServerSupabaseClient>
>;

const exhibitionRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string(),
  introduction: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  theme_id: z.string(),
  theme_version: z.number().int().positive().default(1),
  curation_version: z.number().int().positive().default(1),
  published_at: z.string().nullable().optional(),
  updated_at: z.string(),
  exhibition_rooms: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        subtitle: z.string(),
        introduction: z.string(),
        sort_order: z.number(),
        room_artworks: z
          .array(
            z.object({
              artwork_id: z.string().uuid(),
              sort_order: z.number(),
              display_config: z.unknown().nullable().optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const suggestionRowSchema = z.object({
  id: z.string().uuid(),
  exhibition_id: z.string().uuid(),
  suggestion_type: z.enum(["title", "introduction", "room_introduction"]),
  target_room_order: z.number().int().nullable(),
  input_version: z.number().int().positive(),
  content: z.unknown(),
  status: z.enum(["pending", "accepted", "rejected", "stale"]),
  provider_request_id: z.string().nullable(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
});

const suggestionPayloadSchema = z.object({
  title: z.string().trim().min(1).max(100),
  introduction: z.string().trim().min(20).max(300),
  rooms: z
    .array(
      z.object({
        order: z.number().int().min(0),
        introduction: z.string().trim().min(20).max(220),
      }),
    )
    .max(12),
});

const EDITOR_SELECT =
  "id, title, subtitle, introduction, status, theme_id, theme_version, curation_version, published_at, updated_at, exhibition_rooms(id, name, subtitle, introduction, sort_order, room_artworks(artwork_id, sort_order, display_config))";

export async function listEditableExhibitions(supabase: SupabaseLike) {
  const { data, error } = await supabase
    .from("exhibitions")
    .select(EDITOR_SELECT)
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(`展览读取失败：${error.message}`);
  }

  const parsed = z.array(exhibitionRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error("展览数据格式不完整，请检查数据库迁移。");
  }

  const exhibitions = parsed.data.map(toEditableExhibition);
  return {
    exhibitions,
    activeExhibitionId: selectActiveExhibitionId(exhibitions),
  };
}

export async function getEditableExhibition(
  supabase: SupabaseLike,
  exhibitionId: string,
) {
  const { data, error } = await supabase
    .from("exhibitions")
    .select(EDITOR_SELECT)
    .eq("id", exhibitionId)
    .maybeSingle();
  if (error) {
    throw new Error(`展览读取失败：${error.message}`);
  }
  if (!data) {
    return null;
  }

  const parsed = exhibitionRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("展览数据格式不完整，请检查数据库迁移。");
  }
  return toEditableExhibition(parsed.data);
}

export async function saveEditableExhibition(
  supabase: SupabaseLike,
  exhibition: EditableExhibition,
) {
  const parsed = editableExhibitionSchema.parse(exhibition);
  const payload = normalizeEditableExhibition({
    ...parsed,
    themeId: parsed.themeId as EditableExhibition["themeId"],
  });
  const { data: exhibitionId, error } = await supabase.rpc("save_exhibition_curation", {
    p_exhibition_id: payload.id ?? null,
    p_title: payload.title,
    p_subtitle: payload.subtitle,
    p_introduction: payload.introduction,
    p_status: payload.status,
    p_theme_id: payload.themeId,
    p_rooms: payload.rooms,
  });
  if (error || !exhibitionId) {
    throw new Error(`展览保存失败：${error?.message ?? "未知错误"}`);
  }

  const saved = await getEditableExhibition(supabase, exhibitionId);
  if (!saved) {
    throw new Error("展览已保存，但无法读取最新结果。");
  }
  return saved;
}

export async function archiveEditableExhibition(
  supabase: SupabaseLike,
  exhibitionId: string,
) {
  const { data: archived, error } = await supabase.rpc("archive_exhibition", {
    p_exhibition_id: exhibitionId,
  });
  if (error) {
    throw new Error(`展览归档失败：${error.message}`);
  }
  if (!archived) {
    throw new Error("展览不存在或无权操作。");
  }

  const updated = await getEditableExhibition(supabase, exhibitionId);
  if (!updated) {
    throw new Error("展览归档后读取失败。");
  }
  return updated;
}

export async function deleteEditableExhibition(
  supabase: SupabaseLike,
  exhibitionId: string,
) {
  const current = await getEditableExhibition(supabase, exhibitionId);
  if (!current) {
    throw new Error("展览不存在或无权操作。");
  }
  if (current.status === "published") {
    throw new Error("已发布展览请先归档，再删除。");
  }

  const { data: deleted, error } = await supabase.rpc("delete_exhibition", {
    p_exhibition_id: exhibitionId,
  });
  if (error) {
    throw new Error(`展览删除失败：${error.message}`);
  }
  if (!deleted) {
    throw new Error("展览不存在或无权操作。");
  }
}

export async function listExhibitionSuggestions(
  supabase: SupabaseLike,
  exhibitionId: string,
) {
  const { data, error } = await supabase
    .from("exhibition_ai_suggestions")
    .select(
      "id, exhibition_id, suggestion_type, target_room_order, input_version, content, status, provider_request_id, created_at, reviewed_at",
    )
    .eq("exhibition_id", exhibitionId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`策展建议读取失败：${error.message}`);
  }
  const parsed = z.array(suggestionRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error("策展建议数据格式不完整，请检查数据库迁移。");
  }

  return parsed.data.map<ExhibitionAiSuggestion>((item) => ({
    id: item.id,
    exhibitionId: item.exhibition_id,
    suggestionType: item.suggestion_type,
    targetRoomOrder: item.target_room_order,
    inputVersion: item.input_version,
    content: item.content,
    status: item.status,
    providerRequestId: item.provider_request_id,
    createdAt: item.created_at,
    reviewedAt: item.reviewed_at,
  }));
}

export async function generateExhibitionSuggestions(
  supabase: SupabaseLike,
  exhibitionId: string,
) {
  const exhibition = await getEditableExhibition(supabase, exhibitionId);
  if (!exhibition) {
    throw new Error("展览不存在或无权操作。");
  }

  const artworks = await loadExhibitionSuggestionArtworks(supabase, exhibitionId);
  if (artworks.length === 0) {
    throw new Error("这场展览还没有可供策展助手参考的作品。");
  }

  const prompt = buildExhibitionSuggestionPrompt(exhibition, artworks);
  const config = getAiVisionConfig();
  const providerResponse = await fetch(`${config.baseUrl}/chat/completions`, {
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
            "你是儿童个人博物馆的策展助手。不能使用家长备注，不能暴露隐私。请仅返回 JSON，字段为 title、introduction、rooms。rooms 是数组，每项包含 order 和 introduction，中文自然、温柔、适合家庭展览审阅。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
    cache: "no-store",
  });

  const providerRequestId = providerResponse.headers.get("x-request-id") ?? null;
  if (!providerResponse.ok) {
    await insertAuditEvent(supabase, exhibitionId, "exhibition.ai_suggestion.failed", {
      providerRequestId,
      status: providerResponse.status,
    });
    throw new Error(
      `策展建议服务暂时不可用，请稍后重试${providerRequestId ? `（请求号：${providerRequestId}）` : ""}。`,
    );
  }

  const providerPayload = (await providerResponse.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = providerPayload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("策展建议服务没有返回可用内容，请重试。");
  }

  const parsedContent = parseExhibitionSuggestionContent(content);
  if (!parsedContent.success) {
    throw new Error(
      parsedContent.error.issues[0]?.message ?? "策展建议内容不完整，请重试。",
    );
  }

  if (
    parsedContent.data.rooms.some(
      (room) => room.order >= exhibition.rooms.length,
    )
  ) {
    throw new Error("策展建议包含不存在的展室，请重试。");
  }

  const latestExhibition = await getEditableExhibition(supabase, exhibitionId);
  if (
    !latestExhibition ||
    latestExhibition.curationVersion !== exhibition.curationVersion
  ) {
    throw new Error("展览在 AI 生成期间已被修改，请重新生成建议。");
  }

  await supabase.rpc("stale_exhibition_ai_suggestions", {
    p_exhibition_id: exhibitionId,
  });

  const { data: museum } = await supabase
    .from("exhibitions")
    .select("museum_id")
    .eq("id", exhibitionId)
    .single();
  if (!museum) {
    throw new Error("展览不存在或无权操作。");
  }

  const rows = [
    {
      exhibition_id: exhibitionId,
      museum_id: museum.museum_id,
      suggestion_type: "title",
      target_room_order: null,
      input_version: latestExhibition.curationVersion ?? 1,
      content: { value: parsedContent.data.title },
      status: "pending",
      provider_request_id: providerRequestId,
    },
    {
      exhibition_id: exhibitionId,
      museum_id: museum.museum_id,
      suggestion_type: "introduction",
      target_room_order: null,
      input_version: latestExhibition.curationVersion ?? 1,
      content: { value: parsedContent.data.introduction },
      status: "pending",
      provider_request_id: providerRequestId,
    },
    ...parsedContent.data.rooms.map((room) => ({
      exhibition_id: exhibitionId,
      museum_id: museum.museum_id,
      suggestion_type: "room_introduction" as const,
      target_room_order: room.order,
      input_version: latestExhibition.curationVersion ?? 1,
      content: { value: room.introduction },
      status: "pending" as const,
      provider_request_id: providerRequestId,
    })),
  ];

  const { error } = await supabase.from("exhibition_ai_suggestions").insert(rows);
  if (error) {
    throw new Error(`策展建议保存失败：${error.message}`);
  }

  await insertAuditEvent(supabase, exhibitionId, "exhibition.ai_suggestion.generated", {
    providerRequestId,
    sourceVersion: latestExhibition.curationVersion ?? 1,
    roomCount: rows.filter((row) => row.suggestion_type === "room_introduction").length,
  });

  return {
    suggestions: await listExhibitionSuggestions(supabase, exhibitionId),
    sourceVersion: latestExhibition.curationVersion ?? 1,
  };
}

export async function reviewExhibitionSuggestion(
  supabase: SupabaseLike,
  suggestionId: string,
  action: "accept" | "reject",
) {
  const { data, error } = await supabase.rpc(
    "review_exhibition_ai_suggestion",
    {
      p_suggestion_id: suggestionId,
      p_action: action,
    },
  );
  if (error) {
    if (error.message.includes("SUGGESTION_NOT_FOUND")) {
      throw new Error("策展建议不存在或无权操作。");
    }
    if (error.message.includes("SUGGESTION_NOT_PENDING")) {
      throw new Error("这条策展建议已经审核，不能重复处理。");
    }
    throw new Error(`策展建议审核失败：${error.message}`);
  }
  const reviewed = z
    .object({
      exhibitionId: z.string().uuid(),
      status: z.enum(["accepted", "rejected", "stale"]),
    })
    .parse(data);
  if (reviewed.status === "stale") {
    throw new Error("展览内容已变化，这条策展建议已经过期，请重新生成。");
  }

  const refreshedExhibition = await getEditableExhibition(
    supabase,
    reviewed.exhibitionId,
  );
  if (!refreshedExhibition) {
    throw new Error("展览审核后读取失败。");
  }

  return {
    exhibition: refreshedExhibition,
    suggestions: await listExhibitionSuggestions(
      supabase,
      reviewed.exhibitionId,
    ),
  };
}

export function selectActiveExhibitionId(exhibitions: EditableExhibition[]) {
  return (
    exhibitions.find((exhibition) => exhibition.status === "draft")?.id ??
    exhibitions.find((exhibition) => exhibition.status === "published")?.id ??
    exhibitions[0]?.id ??
    null
  );
}

export function parseExhibitionSuggestionContent(input: string) {
  try {
    return suggestionPayloadSchema.safeParse(
      JSON.parse(input.replace(/^```json\s*|\s*```$/g, "")),
    );
  } catch {
    return suggestionPayloadSchema.safeParse(undefined);
  }
}

function toEditableExhibition(row: z.infer<typeof exhibitionRowSchema>): EditableExhibition {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    introduction: row.introduction,
    status: row.status,
    themeId: isExhibitionThemeId(row.theme_id) ? row.theme_id : "warm-gallery",
    themeVersion: row.theme_version,
    curationVersion: row.curation_version,
    publishedAt: row.published_at ?? null,
    updatedAt: row.updated_at,
    rooms: [...row.exhibition_rooms]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map<EditableExhibitionRoom>((room) => ({
        id: room.id,
        name: room.name,
        subtitle: room.subtitle,
        introduction: room.introduction,
        artworks: [...room.room_artworks]
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((roomArtwork) => ({
            artworkId: roomArtwork.artwork_id,
            displayConfig: normalizeRoomArtworkDisplayConfig(
              roomArtwork.display_config as Record<string, unknown>,
            ),
          })),
      })),
  };
}

async function loadExhibitionSuggestionArtworks(
  supabase: SupabaseLike,
  exhibitionId: string,
) {
  const { data, error } = await supabase
    .from("exhibition_rooms")
    .select(
      "sort_order, name, room_artworks(sort_order, artworks(id, title, description, status, artwork_notes(source, content)))",
    )
    .eq("exhibition_id", exhibitionId)
    .order("sort_order", { ascending: true });
  if (error) {
    throw new Error(`策展素材读取失败：${error.message}`);
  }

  const parsed = z
    .array(
      z.object({
        sort_order: z.number(),
        name: z.string(),
        room_artworks: z
          .array(
            z.object({
              sort_order: z.number(),
              artworks: z
                .object({
                  id: z.string().uuid(),
                  title: z.string(),
                  description: z.string(),
                  status: z.enum(["draft", "published", "archived"]),
                  artwork_notes: z
                    .array(
                      z.object({
                        source: z.enum(["child", "parent", "transcript"]),
                        content: z.string(),
                      }),
                    )
                    .default([]),
                })
                .nullable(),
            }),
          )
          .default([]),
      }),
    )
    .safeParse(data);
  if (!parsed.success) {
    throw new Error("策展素材格式不完整，请检查数据库迁移。");
  }

  return parsed.data.flatMap((room) =>
    room.room_artworks
      .sort((left, right) => left.sort_order - right.sort_order)
      .flatMap((entry) => {
        const artwork = entry.artworks;
        if (!artwork || artwork.status === "archived") {
          return [];
        }
        return [
          {
            roomOrder: room.sort_order,
            roomName: room.name,
            title: artwork.title,
            description: artwork.description,
            childQuote:
              artwork.artwork_notes.find((note) => note.source === "child")?.content ?? "",
          },
        ];
      }),
  );
}

function buildExhibitionSuggestionPrompt(
  exhibition: EditableExhibition,
  artworks: Array<{
    roomOrder: number;
    roomName: string;
    title: string;
    description: string;
    childQuote: string;
  }>,
) {
  return [
    `当前展览标题：${exhibition.title || "未命名展览"}`,
    `当前副标题：${exhibition.subtitle || "未填写"}`,
    `当前门厅序言：${exhibition.introduction || "未填写"}`,
    "展室与作品：",
    ...exhibition.rooms.map((room, roomIndex) => {
      const roomArtworks = artworks.filter((item) => item.roomOrder === roomIndex);
      return [
        `- 展室 ${roomIndex + 1}《${room.name}》`,
        room.subtitle ? `  副标题：${room.subtitle}` : "  副标题：未填写",
        room.introduction ? `  当前串词：${room.introduction}` : "  当前串词：未填写",
        ...roomArtworks.map(
          (artwork) =>
            `  * ${artwork.title}｜说明：${artwork.description || "未填写"}｜孩子原话：${artwork.childQuote || "未填写"}`,
        ),
      ].join("\n");
    }),
  ].join("\n");
}

async function insertAuditEvent(
  supabase: SupabaseLike,
  exhibitionId: string,
  eventType: string,
  metadata: Record<string, unknown>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: exhibition, error } = await supabase
    .from("exhibitions")
    .select("museum_id")
    .eq("id", exhibitionId)
    .single();
  if (error) {
    throw new Error(`审计记录写入失败：${error.message}`);
  }

  const { error: insertError } = await supabase.from("audit_events").insert({
    museum_id: exhibition.museum_id,
    actor_id: user?.id ?? null,
    event_type: eventType,
    entity_type: "exhibition",
    entity_id: exhibitionId,
    metadata,
  });
  if (insertError) {
    throw new Error(`审计记录写入失败：${insertError.message}`);
  }
}
