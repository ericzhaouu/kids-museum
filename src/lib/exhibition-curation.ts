import { z } from "zod";
import type { ExhibitionThemeId } from "@/lib/exhibition-themes";
import type {
  ArtworkVisual,
  Exhibition,
  GalleryRoom,
  StudioArtworkLike,
} from "@/lib/museum-data";
import { featuredExhibition } from "@/lib/museum-data";

export const exhibitionStatuses = ["draft", "published", "archived"] as const;
export type EditableExhibitionStatus = (typeof exhibitionStatuses)[number];

export const displaySizes = ["small", "medium", "large"] as const;
export type DisplaySize = (typeof displaySizes)[number];

export const framePresets = [
  "classic",
  "shadow",
  "float",
  "storybook",
] as const;
export type FramePreset = (typeof framePresets)[number];

export type RoomArtworkDisplayConfig = {
  featured: boolean;
  size: DisplaySize;
  framePreset: FramePreset;
};

export type EditableRoomArtwork = {
  artworkId: string;
  displayConfig?: RoomArtworkDisplayConfig;
};

export type EditableExhibitionRoom = {
  id?: string;
  name: string;
  subtitle: string;
  introduction: string;
  artworks: EditableRoomArtwork[];
};

export type EditableExhibition = {
  id?: string;
  title: string;
  subtitle: string;
  introduction: string;
  status: EditableExhibitionStatus;
  themeId: ExhibitionThemeId;
  themeVersion?: number;
  curationVersion?: number;
  publishedAt?: string | null;
  updatedAt?: string;
  rooms: EditableExhibitionRoom[];
};

export type ExhibitionAiSuggestion = {
  id: string;
  exhibitionId: string;
  suggestionType: "title" | "introduction" | "room_introduction";
  targetRoomOrder: number | null;
  status: "pending" | "accepted" | "rejected" | "stale";
  inputVersion: number;
  content: unknown;
  providerRequestId: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type PublishValidationIssue = {
  path: string;
  message: string;
};

export const defaultRoomArtworkDisplayConfig: RoomArtworkDisplayConfig = {
  featured: false,
  size: "medium",
  framePreset: "classic",
};

export const roomArtworkDisplayConfigSchema = z
  .object({
    featured: z.boolean().optional(),
    size: z.enum(displaySizes).optional(),
    framePreset: z.enum(framePresets).optional(),
  })
  .strict();

export const editableRoomArtworkSchema = z.object({
  artworkId: z.string().uuid(),
  displayConfig: roomArtworkDisplayConfigSchema.optional(),
});

export const editableExhibitionSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(100),
  subtitle: z.string().trim().max(150).default(""),
  introduction: z.string().trim().max(2000).default(""),
  status: z.enum(exhibitionStatuses),
  themeId: z.string(),
  themeVersion: z.number().int().positive().optional(),
  curationVersion: z.number().int().positive().optional(),
  publishedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  rooms: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(80),
        subtitle: z.string().trim().max(150).default(""),
        introduction: z.string().trim().max(1000).default(""),
        artworks: z.array(editableRoomArtworkSchema).max(24),
      }),
    )
    .min(1)
    .max(12),
});

export function normalizeRoomArtworkDisplayConfig(
  input?: Partial<RoomArtworkDisplayConfig> | null,
): RoomArtworkDisplayConfig {
  const parsed = roomArtworkDisplayConfigSchema
    .catch(defaultRoomArtworkDisplayConfig)
    .parse(input ?? {});

  return {
    featured: parsed.featured ?? defaultRoomArtworkDisplayConfig.featured,
    size: parsed.size ?? defaultRoomArtworkDisplayConfig.size,
    framePreset: parsed.framePreset ?? defaultRoomArtworkDisplayConfig.framePreset,
  };
}

export function createEmptyExhibitionRoom(index: number): EditableExhibitionRoom {
  const roomNumber = index + 1;
  return {
    id: crypto.randomUUID(),
    name: `新展室 ${String(roomNumber).padStart(2, "0")}`,
    subtitle: "",
    introduction: "",
    artworks: [],
  };
}

export function createEmptyExhibition(
  themeId: ExhibitionThemeId = "warm-gallery",
): EditableExhibition {
  return {
    title: "未命名展览",
    subtitle: "",
    introduction: "",
    status: "draft",
    themeId,
    themeVersion: 1,
    curationVersion: 1,
    rooms: [createEmptyExhibitionRoom(0), createEmptyExhibitionRoom(1)],
  };
}

export function buildEditableExhibitionFromFeatured(): EditableExhibition {
  return {
    title: featuredExhibition.title,
    subtitle: featuredExhibition.subtitle,
    introduction: featuredExhibition.introduction,
    status: "published",
    themeId: featuredExhibition.themeId ?? "warm-gallery",
    themeVersion: 1,
    curationVersion: 1,
    rooms: featuredExhibition.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      subtitle: room.subtitle,
      introduction: room.introduction,
      artworks: room.artworks.map((artwork, artworkIndex) => ({
        artworkId: artwork.id,
        displayConfig: normalizeRoomArtworkDisplayConfig({
          size: artworkIndex === 1 ? "large" : "medium",
          framePreset: artworkIndex === 1 ? "shadow" : "classic",
          featured: artworkIndex === 1,
        }),
      })),
    })),
  };
}

export function summarizeEditableExhibition(exhibition: EditableExhibition) {
  const artworkCount = new Set(
    exhibition.rooms.flatMap((room) => room.artworks.map((artwork) => artwork.artworkId)),
  ).size;
  return {
    roomCount: exhibition.rooms.length,
    artworkCount,
  };
}

export function validateExhibitionForPublish(
  exhibition: EditableExhibition,
  artworks: Array<{ id: string; status: string }>,
) {
  const issues: PublishValidationIssue[] = [];
  const eligibleIds = new Set(
    artworks.filter((artwork) => artwork.status === "published").map((artwork) => artwork.id),
  );

  if (exhibition.rooms.length < 2) {
    issues.push({
      path: "rooms",
      message: "发布前至少需要 2 个展室。",
    });
  }

  exhibition.rooms.forEach((room, roomIndex) => {
    if (room.artworks.length === 0) {
      issues.push({
        path: `rooms.${roomIndex}.artworks`,
        message: `展室 ${String(roomIndex + 1).padStart(2, "0")} 发布前至少需要 1 件已发布作品。`,
      });
      return;
    }
    if (room.artworks.some((item) => !eligibleIds.has(item.artworkId))) {
      issues.push({
        path: `rooms.${roomIndex}.artworks`,
        message: `展室 ${String(roomIndex + 1).padStart(2, "0")} 包含未发布作品，请先发布或移出。`,
      });
    }
  });

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function normalizeEditableExhibition(
  exhibition: z.infer<typeof editableExhibitionSchema>,
): EditableExhibition {
  return {
    ...exhibition,
    themeId: exhibition.themeId as EditableExhibition["themeId"],
    title: exhibition.title.trim(),
    subtitle: exhibition.subtitle.trim(),
    introduction: exhibition.introduction.trim(),
    rooms: exhibition.rooms.map((room) => ({
      ...room,
      name: room.name.trim(),
      subtitle: room.subtitle.trim(),
      introduction: room.introduction.trim(),
      artworks: room.artworks.map((artwork) => ({
        artworkId: artwork.artworkId,
        displayConfig: normalizeRoomArtworkDisplayConfig(artwork.displayConfig),
      })),
    })),
  };
}

export function buildExhibitionPreview(
  exhibition: EditableExhibition,
  artworks: StudioArtworkLike[],
): Exhibition {
  const artworkMap = new Map(artworks.map((artwork) => [artwork.id, artwork]));
  const rooms = exhibition.rooms.map<GalleryRoom>((room, roomIndex) => ({
    id: room.id ?? `preview-room-${roomIndex}`,
    number: String(roomIndex + 1).padStart(2, "0"),
    name: room.name || `展室 ${String(roomIndex + 1).padStart(2, "0")}`,
    subtitle: room.subtitle || "这些作品正在一起讲一个故事。",
    introduction: room.introduction || "请在这里慢慢看下去。",
    artworks: room.artworks
      .map((placement) => {
        const artwork = artworkMap.get(placement.artworkId);
        if (!artwork || artwork.status === "archived") {
          return null;
        }

        return {
          id: artwork.id,
          title: artwork.title,
          createdAt: artwork.createdOnLabel ?? artwork.createdOn ?? "日期待补充",
          age: artwork.age || "年龄待补充",
          medium: artwork.medium || "媒介待补充",
          childQuote: artwork.childQuote || "还没有记录原话。",
          description: artwork.description || "这件作品的策展说明还在整理中。",
          imageUrl: artwork.previewUrl,
          hasAudio: artwork.audio?.status === "ready",
          audioUrl: artwork.audio?.signedUrl,
          visual: coerceArtworkVisual(artwork.visual),
          display: normalizeRoomArtworkDisplayConfig(placement.displayConfig),
        };
      })
      .filter((artwork): artwork is NonNullable<typeof artwork> => Boolean(artwork)),
  }));

  const artworkCount = rooms.reduce((count, room) => count + room.artworks.length, 0);

  return {
    title: exhibition.title || "未命名展览",
    subtitle: exhibition.subtitle,
    introduction: exhibition.introduction,
    curatorNote: `${rooms.length} 个展室 · ${artworkCount} 件作品 · 草稿预览`,
    themeId: exhibition.themeId,
    rooms,
  };
}

function coerceArtworkVisual(value?: string): ArtworkVisual | undefined {
  return value &&
    [
      "flying-whale",
      "rainbow-city",
      "moon-garden",
      "family-table",
      "blue-cat",
      "paper-forest",
    ].includes(value)
    ? (value as ArtworkVisual)
    : undefined;
}
