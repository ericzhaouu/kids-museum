import { z } from "zod";
import { MAX_WEBP_BYTES } from "@/lib/artworks/media-limits";

export const ARTWORK_IMAGE_EDGE_LIMITS = {
  original: 2400,
  display: 1600,
  thumbnail: 480,
} as const;

export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const MAX_AUDIO_DURATION_SECONDS = 600;

export const audioMimeTypes = [
  "audio/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
] as const;

export type ArtworkStatus = "draft" | "published" | "archived";

const normalizedNumber = z.number().finite().min(0).max(1);

export const artworkMetadataInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(""),
  createdOn: z.iso.date().nullable().default(null),
  age: z.string().trim().max(40).default(""),
  medium: z.string().trim().max(80).default(""),
  childQuote: z.string().trim().max(500).default(""),
  parentNote: z.string().trim().max(1000).default(""),
});

const imageVariantSchema = z.object({
  dataUrl: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const processedArtworkImageSchema = z.object({
  original: imageVariantSchema,
  display: imageVariantSchema,
  thumbnail: imageVariantSchema,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  crop: z.object({
    x: normalizedNumber,
    y: normalizedNumber,
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  }),
  focusX: normalizedNumber,
  focusY: normalizedNumber,
});

export const artworkAudioInputSchema = z.object({
  dataUrl: z.string().min(1),
  mimeType: z.enum(audioMimeTypes),
  durationSeconds: z
    .number()
    .finite()
    .positive()
    .max(MAX_AUDIO_DURATION_SECONDS),
  byteSize: z.number().int().positive().max(MAX_AUDIO_BYTES),
  fileName: z.string().trim().max(200).optional(),
});

export const createArtworkPayloadSchema = artworkMetadataInputSchema.extend({
  image: processedArtworkImageSchema,
  audio: artworkAudioInputSchema.nullish(),
});

export const patchArtworkPayloadSchema = artworkMetadataInputSchema
  .partial()
  .extend({
    status: z.enum(["draft", "published", "archived"]).optional(),
    image: processedArtworkImageSchema.optional(),
    audio: artworkAudioInputSchema.nullish(),
    removeAudio: z.boolean().optional(),
  })
  .refine(
    (value) =>
      Object.keys(value).length > 0 &&
      !(value.audio !== undefined && value.removeAudio === true),
    {
      message: "请至少提交一项作品修改，且不能同时上传音频并删除音频。",
    },
  );

const imageUploadDescriptorSchema = z.object({
  mimeType: z.literal("image/webp"),
  byteSize: z.number().int().positive().max(MAX_WEBP_BYTES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const audioUploadDescriptorSchema = z.object({
  mimeType: z.enum(audioMimeTypes),
  byteSize: z.number().int().positive().max(MAX_AUDIO_BYTES),
  durationSeconds: z
    .number()
    .finite()
    .positive()
    .max(MAX_AUDIO_DURATION_SECONDS)
    .optional(),
});

export const artworkUploadAuthorizationRequestSchema = z
  .object({
    image: z
      .object({
        original: imageUploadDescriptorSchema.extend({
          width: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.original),
          height: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.original),
        }),
        display: imageUploadDescriptorSchema.extend({
          width: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.display),
          height: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.display),
        }),
        thumbnail: imageUploadDescriptorSchema.extend({
          width: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.thumbnail),
          height: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.thumbnail),
        }),
      })
      .optional(),
    audio: audioUploadDescriptorSchema.optional(),
  })
  .refine((value) => Boolean(value.image || value.audio), {
    message: "请至少声明一项需要直传的媒体。",
  });

const uploadedImageAssetSchema = imageUploadDescriptorSchema.extend({
  path: z.string().trim().min(1),
});

const uploadedAudioAssetSchema = audioUploadDescriptorSchema.extend({
  path: z.string().trim().min(1),
});

export const artworkMediaCommitSchema = z
  .object({
    sessionId: z.string().uuid(),
    image: z
      .object({
        original: uploadedImageAssetSchema.extend({
          width: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.original),
          height: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.original),
        }),
        display: uploadedImageAssetSchema.extend({
          width: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.display),
          height: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.display),
        }),
        thumbnail: uploadedImageAssetSchema.extend({
          width: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.thumbnail),
          height: z.number().int().positive().max(ARTWORK_IMAGE_EDGE_LIMITS.thumbnail),
        }),
      })
      .optional(),
    audio: uploadedAudioAssetSchema.optional(),
  })
  .refine((value) => Boolean(value.image || value.audio), {
    message: "请至少提交一项待提交媒体。",
  });

const signedUploadDescriptorSchema = z.object({
  path: z.string().min(1),
  token: z.string().min(1),
  signedUrl: z.string().url(),
});

export const artworkUploadAuthorizationResponseSchema = z.object({
  sessionId: z.string().uuid(),
  expiresAt: z.iso.datetime(),
  image: z
    .object({
      original: signedUploadDescriptorSchema,
      display: signedUploadDescriptorSchema,
      thumbnail: signedUploadDescriptorSchema,
    })
    .optional(),
  audio: signedUploadDescriptorSchema.optional(),
});

export const artworkUploadCleanupRequestSchema = z.object({
  sessionId: z.string().uuid(),
});

export const createArtworkDraftRequestSchema = artworkMetadataInputSchema;

export const patchArtworkRequestSchema = artworkMetadataInputSchema
  .partial()
  .extend({
    status: z.enum(["draft", "published", "archived"]).optional(),
    mediaCommit: artworkMediaCommitSchema.optional(),
    removeAudio: z.boolean().optional(),
  })
  .refine(
    (value) =>
      Object.keys(value).length > 0 &&
      !(value.mediaCommit?.audio && value.removeAudio === true),
    {
      message: "请至少提交一项作品修改，且不能同时上传音频并删除音频。",
    },
  );

export type ArtworkMetadataInput = z.infer<typeof artworkMetadataInputSchema>;
export type ProcessedArtworkImage = z.infer<typeof processedArtworkImageSchema>;
export type ArtworkAudioInput = z.infer<typeof artworkAudioInputSchema>;
export type CreateArtworkPayload = z.infer<typeof createArtworkPayloadSchema>;
export type PatchArtworkPayload = z.infer<typeof patchArtworkPayloadSchema>;
export type ArtworkUploadAuthorizationRequest = z.infer<
  typeof artworkUploadAuthorizationRequestSchema
>;
export type ArtworkMediaCommit = z.infer<typeof artworkMediaCommitSchema>;
export type ArtworkUploadAuthorizationResponse = z.infer<
  typeof artworkUploadAuthorizationResponseSchema
>;
export type ArtworkUploadCleanupRequest = z.infer<
  typeof artworkUploadCleanupRequestSchema
>;
export type ArtworkCreateDraftRequest = z.infer<
  typeof createArtworkDraftRequestSchema
>;
export type ArtworkPatchRequest = z.infer<typeof patchArtworkRequestSchema>;

export type ArtworkAssetKind = "original" | "display" | "thumbnail" | "audio";

export type StudioArtworkAsset = {
  kind: ArtworkAssetKind;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  signedUrl?: string;
};

export type StudioSuggestion = {
  id: string;
  type: "title" | "description" | "tags" | "transcript" | "curator_note";
  status: "pending" | "accepted" | "rejected" | "stale";
  reviewedAt: string | null;
  sourceVersion: number;
  providerRequestId: string | null;
  content: unknown;
  createdAt: string;
};

export type StudioArtwork = {
  id: string;
  title: string;
  description: string;
  createdOn: string | null;
  createdOnLabel?: string;
  age: string;
  medium: string;
  status: ArtworkStatus;
  visual?: string;
  previewUrl?: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  childQuote?: string;
  parentNote?: string;
  transcript?: string;
  tags: string[];
  sourceVersion: number;
  audio?: {
    status: "missing" | "ready";
    mimeType?: string;
    durationSeconds?: number;
    signedUrl?: string;
  };
  media: {
    original: StudioArtworkAsset | null;
    display: StudioArtworkAsset | null;
    thumbnail: StudioArtworkAsset | null;
    audio: StudioArtworkAsset | null;
    focusX: number;
    focusY: number;
    rotation: 0 | 90 | 180 | 270;
    crop: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
};

export function shouldBumpArtworkSourceVersion(payload: PatchArtworkPayload) {
  return Boolean(
    payload.createdOn !== undefined ||
      payload.age !== undefined ||
      payload.medium !== undefined ||
      payload.childQuote !== undefined ||
      payload.parentNote !== undefined ||
      payload.image !== undefined ||
      payload.audio !== undefined ||
      payload.removeAudio,
  );
}

export function createDefaultMediaState() {
  return {
    focusX: 0.5,
    focusY: 0.5,
    rotation: 0 as const,
    crop: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  };
}
