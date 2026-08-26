import "server-only";

import { z } from "zod";
import { defaultRoomArtworkDisplayConfig, normalizeRoomArtworkDisplayConfig } from "@/lib/exhibition-curation";
import { isExhibitionThemeId } from "@/lib/exhibition-themes";
import { featuredExhibition, type Exhibition } from "@/lib/museum-data";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const publishedExhibitionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string(),
  introduction: z.string(),
  theme_id: z.string(),
  theme_version: z.number().int().positive().default(1),
  published_at: z.string().nullable(),
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
              sort_order: z.number(),
              display_config: z.unknown().nullable().optional(),
              artworks: z
                .object({
                  id: z.string().uuid(),
                  museum_id: z.string().uuid(),
                  title: z.string(),
                  description: z.string(),
                  status: z.literal("published"),
                  created_on: z.string().nullable(),
                  age_label: z.string(),
                  medium: z.string(),
                  artwork_assets: z.array(
                    z.object({
                      kind: z.enum(["original", "display", "thumbnail", "audio"]),
                      storage_path: z.string(),
                    }),
                  ),
                  artwork_notes: z.array(
                    z.object({
                      source: z.enum(["child", "parent", "transcript"]),
                      content: z.string(),
                    }),
                  ),
                })
                .nullable(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

export function isMuseumArtworkAssetPath(
  storagePath: string,
  museumId: string,
  artworkId: string,
) {
  const prefix = `${museumId}/${artworkId}/`;
  return storagePath.startsWith(prefix) && storagePath.length > prefix.length;
}

export async function getPublishedExhibition(
  museumId: string,
): Promise<Exhibition> {
  let admin: ReturnType<typeof createAdminSupabaseClient>;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    return featuredExhibition;
  }

  const { data, error } = await admin
    .from("exhibitions")
    .select(
      "id, title, subtitle, introduction, theme_id, theme_version, published_at, exhibition_rooms(id, name, subtitle, introduction, sort_order, room_artworks(sort_order, display_config, artworks(id, museum_id, title, description, status, created_on, age_label, medium, artwork_assets(kind, storage_path), artwork_notes(source, content))))",
    )
    .eq("museum_id", museumId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`已发布展览读取失败：${error.message}`);
  }
  if (!data) {
    return featuredExhibition;
  }

  const parsed = publishedExhibitionSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("已发布展览数据格式不完整，请检查数据库迁移。");
  }

  const rooms = await Promise.all(
    [...parsed.data.exhibition_rooms]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map(async (room, roomIndex) => ({
        id: room.id,
        number: String(roomIndex + 1).padStart(2, "0"),
        name: room.name,
        subtitle: room.subtitle || "这些作品正在一起讲一个故事。",
        introduction: room.introduction || "请在这里慢慢看下去。",
        artworks: await Promise.all(
          [...room.room_artworks]
            .sort((left, right) => left.sort_order - right.sort_order)
            .map(async (roomArtwork) => {
              const artwork = roomArtwork.artworks;
              if (!artwork) {
                throw new Error("展览中的作品数据缺失。");
              }
              if (artwork.museum_id !== museumId) {
                throw new Error("展览包含了其他博物馆的作品。");
              }
              const displayAsset = artwork.artwork_assets.find(
                (asset) => asset.kind === "display",
              );
              const audioAsset = artwork.artwork_assets.find(
                (asset) => asset.kind === "audio",
              );

              const [imageUrl, audioUrl] = await Promise.all([
                signAsset(admin, displayAsset?.storage_path, museumId, artwork.id, "展览图片"),
                signAsset(admin, audioAsset?.storage_path, museumId, artwork.id, "展览录音"),
              ]);

              const childQuote = artwork.artwork_notes.find(
                (note) => note.source === "child",
              );

              return {
                id: artwork.id,
                title: artwork.title,
                createdAt: formatCreatedOn(artwork.created_on),
                age: artwork.age_label || "年龄待补充",
                medium: artwork.medium || "媒介待补充",
                childQuote: childQuote?.content || "还没有记录原话。",
                description: artwork.description || "这件作品的策展说明还在整理中。",
                imageUrl,
                hasAudio: Boolean(audioUrl),
                audioUrl,
                display: normalizeRoomArtworkDisplayConfig(
                  roomArtwork.display_config as Partial<typeof defaultRoomArtworkDisplayConfig>,
                ),
              };
            }),
        ),
      })),
  );

  const artworkCount = rooms.reduce((count, room) => count + room.artworks.length, 0);

  return {
    title: parsed.data.title,
    subtitle: parsed.data.subtitle,
    introduction: parsed.data.introduction,
    curatorNote: `${rooms.length} 个展室 · ${artworkCount} 件作品 · 私密家庭展`,
    themeId: isExhibitionThemeId(parsed.data.theme_id)
      ? parsed.data.theme_id
      : "warm-gallery",
    rooms,
  };
}

async function signAsset(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  storagePath: string | undefined,
  museumId: string,
  artworkId: string,
  label: string,
) {
  if (!storagePath) {
    return undefined;
  }

  if (!isMuseumArtworkAssetPath(storagePath, museumId, artworkId)) {
    throw new Error(`${label}路径与当前博物馆或作品不匹配。`);
  }

  const { data, error } = await admin.storage
    .from("museum-private")
    .createSignedUrl(storagePath, 15 * 60);
  if (error) {
    throw new Error(`${label}授权失败：${error.message}`);
  }
  return data.signedUrl;
}

function formatCreatedOn(value: string | null) {
  if (!value) {
    return "日期待补充";
  }

  const [year, month, day] = value.split("-");
  if (!year || !month) {
    return value;
  }
  if (!day || day === "01") {
    return `${year} 年 ${Number(month)} 月`;
  }
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}
