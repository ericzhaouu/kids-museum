import { z } from "zod";
import {
  inspectWebpBytes,
} from "@/app/api/artworks/image-validation";
import {
  buildArtworkTempUploadPath,
  buildArtworkVersionedAssetPath,
  createArtworkUploadSessionId,
  extensionForMimeType,
  assertArtworkTempUploadPath,
} from "@/lib/artworks/direct-upload";
import {
  ARTWORK_IMAGE_EDGE_LIMITS,
  type ArtworkAssetKind,
  type ArtworkCreateDraftRequest,
  type ArtworkMediaCommit,
  type ArtworkMetadataInput,
  type ArtworkPatchRequest,
  type ArtworkUploadAuthorizationRequest,
  type ArtworkUploadAuthorizationResponse,
  createDefaultMediaState,
  type PatchArtworkPayload,
  type StudioArtwork,
  type StudioSuggestion,
  shouldBumpArtworkSourceVersion,
} from "@/lib/artworks/contracts";
import {
  decodeAndValidateAudioDataUrl,
  validateAudioBytes,
} from "@/lib/artworks/audio-validation";
import { MAX_WEBP_BYTES } from "@/lib/artworks/media-limits";
import { NO_MUSEUM_PROFILE_MESSAGE } from "@/lib/museum-management";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const artworkAssetSchema = z.object({
  kind: z.enum(["original", "display", "thumbnail", "audio"]),
  storage_path: z.string(),
  mime_type: z.string(),
  byte_size: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
});

const artworkRowSchema = z.object({
  id: z.string().uuid(),
  museum_id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  created_on: z.string().nullable(),
  age_label: z.string(),
  medium: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  source_version: z.number().int().positive().default(1),
  artwork_assets: z.array(artworkAssetSchema).default([]),
  artwork_notes: z
    .array(
      z.object({
        source: z.enum(["child", "parent", "transcript"]),
        content: z.string(),
        is_ai_input: z.boolean().optional(),
      }),
    )
    .default([]),
  artwork_tags: z
    .array(
      z.object({
        tags: z
          .object({
            name: z.string(),
          })
          .nullable(),
      }),
    )
    .default([]),
});

const artworkSuggestionRowSchema = z.object({
  id: z.string().uuid(),
  suggestion_type: z.enum([
    "title",
    "description",
    "tags",
    "transcript",
    "curator_note",
  ]),
  input_version: z.number().int().positive(),
  content: z.unknown(),
  status: z.enum(["pending", "accepted", "rejected", "stale"]),
  provider_request_id: z.string().nullable(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
});

const cleanupRpcResponseSchema = z.object({
  cleanupJobId: z.string().uuid().nullable().optional(),
  cleanupPaths: z.array(z.string()).default([]),
  removedPaths: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
  sourceVersion: z.number().int().positive().nullable().optional(),
});

const mediaUploadSessionDescriptorSchema = z.object({
  kind: z.enum(["original", "display", "thumbnail", "audio"]),
  path: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().positive().nullable().optional(),
});

const mediaUploadSessionSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  museum_id: z.string().uuid(),
  artwork_id: z.string().uuid(),
  authorized_paths: z.array(z.string()).default([]),
  descriptors: z.array(mediaUploadSessionDescriptorSchema).default([]),
  status: z.enum(["authorized", "committed", "failed", "cleanup_queued"]),
  expires_at: z.string(),
  cleanup_queued_at: z.string().nullable().optional(),
});

const ARTWORK_UPLOAD_SESSION_TTL_MS = 30 * 60 * 1000;

const ARTWORK_SELECT =
  "id, museum_id, title, description, created_on, age_label, medium, status, source_version, artwork_assets(kind, storage_path, mime_type, byte_size, width, height, duration_seconds), artwork_notes(source, content, is_ai_input), artwork_tags(tags(name))";

type SupabaseLike = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createServerSupabaseClient>
>;

type CommitArtworkUpdateResult = {
  warning?: string;
};

export async function getCuratorMuseum(supabase: SupabaseLike, userId: string) {
  const { data, error } = await supabase
    .from("museum_profiles")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`找不到博物馆资料：${error.message}`);
  }
  if (!data) {
    throw new Error(NO_MUSEUM_PROFILE_MESSAGE);
  }
  return data;
}

export async function listOwnedArtworks(supabase: SupabaseLike) {
  const { data, error } = await supabase
    .from("artworks")
    .select(ARTWORK_SELECT)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`作品读取失败：${error.message}`);
  }

  const parsed = z.array(artworkRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error("云端作品数据格式不完整，请检查数据库迁移。");
  }
  return parsed.data;
}

export async function getOwnedArtwork(supabase: SupabaseLike, artworkId: string) {
  const { data, error } = await supabase
    .from("artworks")
    .select(ARTWORK_SELECT)
    .eq("id", artworkId)
    .maybeSingle();
  if (error) {
    throw new Error(`作品权限校验失败：${error.message}`);
  }
  if (!data) {
    return null;
  }

  const parsed = artworkRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("作品数据格式不完整，请检查数据库迁移。");
  }
  return parsed.data;
}

export async function createArtworkDraft(
  supabase: SupabaseLike,
  museumId: string,
  payload: ArtworkCreateDraftRequest | ArtworkMetadataInput,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("请先登录馆长账号。");
  }

  const { data, error } = await supabase.rpc("create_artwork_draft", {
    p_museum_id: museumId,
    p_owner_id: user.id,
    p_title: payload.title,
    p_description: payload.description,
    p_created_on: payload.createdOn,
    p_age_label: payload.age,
    p_medium: payload.medium,
    p_child_quote: payload.childQuote,
    p_parent_note: payload.parentNote,
  });
  if (error) {
    throw new Error(`作品档案创建失败：${error.message}`);
  }
  return z
    .object({
      id: z.string().uuid(),
      museum_id: z.string().uuid(),
    })
    .parse(data);
}

export async function authorizeArtworkUploads(
  supabase: SupabaseLike,
  artworkId: string,
  request: ArtworkUploadAuthorizationRequest,
): Promise<ArtworkUploadAuthorizationResponse> {
  const artwork = await getOwnedArtwork(supabase, artworkId);
  if (!artwork) {
    throw new Error("作品不存在或无权操作。");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("请先登录馆长账号。");
  }

  const uploadSessionId = createArtworkUploadSessionId();
  const expiresAt = new Date(Date.now() + ARTWORK_UPLOAD_SESSION_TTL_MS).toISOString();
  const response: ArtworkUploadAuthorizationResponse = {
    sessionId: uploadSessionId,
    expiresAt,
  };
  let imagePaths:
    | { original: string; display: string; thumbnail: string }
    | undefined;
  let audioPath: string | undefined;
  const sessionDescriptors: z.infer<typeof mediaUploadSessionDescriptorSchema>[] = [];
  const admin = createAdminSupabaseClient();
  const sign = async (path: string) => {
    const { data, error } = await admin.storage
      .from("museum-private")
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`媒体直传授权失败：${error?.message ?? "未知错误"}`);
    }
    return {
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
    };
  };

  if (request.image) {
    const originalPath = buildArtworkTempUploadPath({
      museumId: artwork.museum_id,
      artworkId,
      uploadSessionId,
      kind: "original",
      mimeType: request.image.original.mimeType,
    });
    const displayPath = buildArtworkTempUploadPath({
      museumId: artwork.museum_id,
      artworkId,
      uploadSessionId,
      kind: "display",
      mimeType: request.image.display.mimeType,
    });
    const thumbnailPath = buildArtworkTempUploadPath({
      museumId: artwork.museum_id,
      artworkId,
      uploadSessionId,
      kind: "thumbnail",
      mimeType: request.image.thumbnail.mimeType,
    });
    sessionDescriptors.push(
      {
        kind: "original",
        path: originalPath,
        mimeType: request.image.original.mimeType,
        byteSize: request.image.original.byteSize,
        width: request.image.original.width,
        height: request.image.original.height,
      },
      {
        kind: "display",
        path: displayPath,
        mimeType: request.image.display.mimeType,
        byteSize: request.image.display.byteSize,
        width: request.image.display.width,
        height: request.image.display.height,
      },
      {
        kind: "thumbnail",
        path: thumbnailPath,
        mimeType: request.image.thumbnail.mimeType,
        byteSize: request.image.thumbnail.byteSize,
        width: request.image.thumbnail.width,
        height: request.image.thumbnail.height,
      },
    );
    imagePaths = {
      original: originalPath,
      display: displayPath,
      thumbnail: thumbnailPath,
    };
  }

  if (request.audio) {
    const pendingAudioPath = buildArtworkTempUploadPath({
      museumId: artwork.museum_id,
      artworkId,
      uploadSessionId,
      kind: "audio",
      mimeType: request.audio.mimeType,
    });
    sessionDescriptors.push({
      kind: "audio",
      path: pendingAudioPath,
      mimeType: request.audio.mimeType,
      byteSize: request.audio.byteSize,
      durationSeconds: request.audio.durationSeconds ?? null,
    });
    audioPath = pendingAudioPath;
  }

  const { error: sessionError } = await admin.from("media_upload_sessions").insert({
    id: uploadSessionId,
    owner_id: user.id,
    museum_id: artwork.museum_id,
    artwork_id: artworkId,
    authorized_paths: sessionDescriptors.map((descriptor) => descriptor.path),
    descriptors: sessionDescriptors,
    expires_at: expiresAt,
    status: "authorized",
  });
  if (sessionError) {
    throw new Error(`媒体上传会话登记失败：${sessionError.message}`);
  }

  try {
    if (imagePaths) {
      response.image = {
        original: await sign(imagePaths.original),
        display: await sign(imagePaths.display),
        thumbnail: await sign(imagePaths.thumbnail),
      };
    }
    if (audioPath) {
      response.audio = await sign(audioPath);
    }
  } catch (error) {
    await admin
      .from("media_upload_sessions")
      .update({
        status: "failed",
        last_error:
          error instanceof Error ? error.message : "媒体直传授权失败。",
      })
      .eq("id", uploadSessionId);
    throw error;
  }

  return response;
}

export async function commitArtworkUpdate(
  supabase: SupabaseLike,
  artworkId: string,
  payload: ArtworkPatchRequest,
): Promise<CommitArtworkUpdateResult> {
  const artwork = await getOwnedArtwork(supabase, artworkId);
  if (!artwork) {
    throw new Error("作品不存在或无权操作。");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("请先登录馆长账号。");
  }

  const admin = createAdminSupabaseClient();
  const uploadSession = payload.mediaCommit
    ? await loadMediaUploadSessionForCommit(admin, payload.mediaCommit, {
        artworkId,
        museumId: artwork.museum_id,
        ownerId: user.id,
      })
    : null;
  const preparedCommit = uploadSession
    ? await prepareCommittedArtworkAssets(artwork.museum_id, artworkId, payload.mediaCommit!, uploadSession)
    : createEmptyPreparedCommit();

  const versionedPaths = preparedCommit.versionedUploads.map((item) => item.path);
  try {
    await uploadVersionedAssets(preparedCommit.versionedUploads);

    const { data, error } = await admin.rpc("apply_artwork_update_server", {
      p_owner_id: user.id,
      p_artwork_id: artworkId,
      p_title: payload.title ?? null,
      p_description: payload.description ?? null,
      p_created_on: payload.createdOn ?? null,
      p_age_label: payload.age ?? null,
      p_medium: payload.medium ?? null,
      p_child_quote: payload.childQuote ?? null,
      p_parent_note: payload.parentNote ?? null,
      p_status: payload.status ?? null,
      p_update_title: payload.title !== undefined,
      p_update_description: payload.description !== undefined,
      p_update_created_on: payload.createdOn !== undefined,
      p_update_age_label: payload.age !== undefined,
      p_update_medium: payload.medium !== undefined,
      p_update_child_quote: payload.childQuote !== undefined,
      p_update_parent_note: payload.parentNote !== undefined,
      p_update_status: payload.status !== undefined,
      p_assets:
        preparedCommit.assetRows.length > 0 ? preparedCommit.assetRows : null,
      p_remove_audio: payload.removeAudio === true,
      p_bump_source_version: shouldArtworkUpdateBumpSourceVersion(payload),
    });
    if (error) {
      throw new Error(`作品修改失败：${error.message}`);
    }

    const parsed = cleanupRpcResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error("作品修改返回结果无效，请检查数据库迁移。");
    }

    const warnings: string[] = [];
    if (uploadSession) {
      await admin
        .from("media_upload_sessions")
        .update({
          status: "committed",
          last_error: null,
          committed_at: new Date().toISOString(),
        })
        .eq("id", uploadSession.id);
      const cleanupWarning = await queueArtworkUploadSessionCleanupById(
        admin,
        uploadSession.id,
        "artwork.temp.cleanup",
        { keepCommittedStatus: true },
      );
      if (cleanupWarning) {
        warnings.push(cleanupWarning);
      }
    }

    return {
      warning: warnings.length > 0 ? warnings.join("；") : undefined,
    };
  } catch (error) {
    const baseMessage =
      error instanceof Error ? error.message : "作品修改失败。";
    const cleanupWarnings: string[] = [];

    if (uploadSession) {
      await admin
        .from("media_upload_sessions")
        .update({
          status: "failed",
          last_error: baseMessage,
        })
        .eq("id", uploadSession.id);
      const tempCleanupWarning = await queueArtworkUploadSessionCleanupById(
        admin,
        uploadSession.id,
        "artwork.commit.rollback",
      );
      if (tempCleanupWarning) {
        cleanupWarnings.push(tempCleanupWarning);
      }
    }

    const versionedCleanupWarning = await queueDirectCleanupJob(
      artwork.museum_id,
      "artwork.commit.rollback.versioned",
      versionedPaths,
      user.id,
    );
    if (versionedCleanupWarning) {
      cleanupWarnings.push(versionedCleanupWarning);
    }

    if (cleanupWarnings.length > 0) {
      throw new Error(
        `${baseMessage}（且回滚清理需要人工处理：${cleanupWarnings.join("；")}）`,
      );
    }
    throw error;
  }
}

export async function listArtworkSuggestions(
  supabase: SupabaseLike,
  artworkId: string,
) {
  const { data, error } = await supabase
    .from("ai_suggestions")
    .select(
      "id, suggestion_type, input_version, content, status, provider_request_id, created_at, reviewed_at",
    )
    .eq("artwork_id", artworkId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`AI 建议读取失败：${error.message}`);
  }

  const parsed = z.array(artworkSuggestionRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error("AI 建议数据格式不完整，请检查数据库迁移。");
  }
  return parsed.data.map<StudioSuggestion>((item) => ({
    id: item.id,
    type: item.suggestion_type,
    status: item.status,
    reviewedAt: item.reviewed_at,
    sourceVersion: item.input_version,
    providerRequestId: item.provider_request_id,
    content: item.content,
    createdAt: item.created_at,
  }));
}

export async function insertAiSuggestions(
  supabase: SupabaseLike,
  artworkId: string,
  sourceVersion: number,
  providerRequestId: string | null,
  suggestion: {
    title: string;
    description: string;
    tags: string[];
  },
) {
  const { error } = await supabase.from("ai_suggestions").insert([
    {
      artwork_id: artworkId,
      suggestion_type: "title",
      input_version: sourceVersion,
      content: { value: suggestion.title },
      provider_request_id: providerRequestId,
      status: "pending",
    },
    {
      artwork_id: artworkId,
      suggestion_type: "description",
      input_version: sourceVersion,
      content: { value: suggestion.description },
      provider_request_id: providerRequestId,
      status: "pending",
    },
    {
      artwork_id: artworkId,
      suggestion_type: "tags",
      input_version: sourceVersion,
      content: { values: suggestion.tags },
      provider_request_id: providerRequestId,
      status: "pending",
    },
  ]);
  if (error) {
    throw new Error(`AI 建议保存失败：${error.message}`);
  }
}

export async function saveTranscriptResult(
  supabase: SupabaseLike,
  artwork: { id: string; museum_id: string; source_version: number },
  transcript: string,
  providerRequestId: string | null,
) {
  const { error } = await supabase.from("ai_suggestions").insert({
    artwork_id: artwork.id,
    suggestion_type: "transcript",
    input_version: artwork.source_version,
    content: { value: transcript },
    provider_request_id: providerRequestId,
    status: "pending",
  });
  if (error) {
    throw new Error(`转写审核记录保存失败：${error.message}`);
  }

  await insertAuditEvent(
    supabase,
    artwork.museum_id,
    artwork.id,
    "artwork",
    "transcript.generated",
    {
      sourceVersion: artwork.source_version,
      providerRequestId,
    },
  );
}

export async function applySuggestionReview(
  supabase: SupabaseLike,
  suggestionId: string,
  action: "accept" | "reject",
) {
  const { data, error } = await supabase.rpc("review_ai_suggestion", {
    p_suggestion_id: suggestionId,
    p_action: action,
  });
  if (error) {
    if (error.message.includes("SUGGESTION_NOT_FOUND")) {
      throw new Error("AI 建议不存在或无权操作。");
    }
    if (error.message.includes("SUGGESTION_NOT_PENDING")) {
      throw new Error("这条 AI 建议已经审核，不能重复处理。");
    }
    throw new Error(`AI 建议审核失败：${error.message}`);
  }

  const reviewed = z
    .object({
      artworkId: z.string().uuid(),
      status: z.enum(["accepted", "rejected", "stale"]),
    })
    .parse(data);
  if (reviewed.status === "stale") {
    throw new Error("作品内容已变化，这条 AI 建议已经过期，请重新生成。");
  }
  return reviewed;
}

export function payloadChangesSourceVersion(payload: PatchArtworkPayload) {
  return shouldBumpArtworkSourceVersion(payload);
}

export async function loadArtworkResponse(
  supabase: SupabaseLike,
  artworkId: string,
) {
  const artwork = await getOwnedArtwork(supabase, artworkId);
  if (!artwork) {
    throw new Error("作品不存在或无权操作。");
  }
  return toStudioArtwork(supabase, artwork);
}

export async function toStudioArtwork(
  supabase: SupabaseLike,
  artwork: z.infer<typeof artworkRowSchema>,
): Promise<StudioArtwork> {
  const mediaDefaults = createDefaultMediaState();
  const assetMap = new Map(artwork.artwork_assets.map((asset) => [asset.kind, asset]));
  const signedUrls = await signArtworkAssets(
    supabase,
    artwork.artwork_assets.map((asset) => asset.storage_path),
  );

  const childQuote = artwork.artwork_notes.find((note) => note.source === "child");
  const parentNote = artwork.artwork_notes.find((note) => note.source === "parent");
  const transcript = artwork.artwork_notes.find(
    (note) => note.source === "transcript",
  );
  const original = assetMap.get("original");
  const display = assetMap.get("display");
  const thumbnail = assetMap.get("thumbnail");
  const audio = assetMap.get("audio");

  return {
    id: artwork.id,
    title: artwork.title,
    description: artwork.description,
    createdOn: artwork.created_on,
    age: artwork.age_label,
    medium: artwork.medium,
    status: artwork.status,
    previewUrl: display ? signedUrls.get(display.storage_path) : undefined,
    originalUrl: original ? signedUrls.get(original.storage_path) : undefined,
    thumbnailUrl: thumbnail ? signedUrls.get(thumbnail.storage_path) : undefined,
    childQuote: childQuote?.content,
    parentNote: parentNote?.content,
    transcript: transcript?.content,
    tags: artwork.artwork_tags.flatMap((entry) => (entry.tags ? [entry.tags.name] : [])),
    sourceVersion: artwork.source_version,
    audio: audio
      ? {
          status: "ready",
          mimeType: audio.mime_type,
          durationSeconds: audio.duration_seconds ?? undefined,
          signedUrl: signedUrls.get(audio.storage_path),
        }
      : { status: "missing" },
    media: {
      original: original
        ? withSignedUrl(original, signedUrls.get(original.storage_path))
        : null,
      display: display
        ? withSignedUrl(display, signedUrls.get(display.storage_path))
        : null,
      thumbnail: thumbnail
        ? withSignedUrl(thumbnail, signedUrls.get(thumbnail.storage_path))
        : null,
      audio: audio ? withSignedUrl(audio, signedUrls.get(audio.storage_path)) : null,
      ...mediaDefaults,
    },
  };
}

type PreparedArtworkCommit = {
  assetRows: Array<Record<string, unknown>>;
  versionedUploads: Array<{
    path: string;
    bytes: Uint8Array;
    mimeType: string;
  }>;
  temporaryPaths: string[];
};

type MediaUploadSession = z.infer<typeof mediaUploadSessionSchema>;
type MediaUploadSessionDescriptor = z.infer<
  typeof mediaUploadSessionDescriptorSchema
>;

function createEmptyPreparedCommit(): PreparedArtworkCommit {
  return {
    assetRows: [],
    versionedUploads: [],
    temporaryPaths: [],
  };
}

export async function cleanupArtworkUploadSession(
  supabase: SupabaseLike,
  artworkId: string,
  sessionId: string,
) {
  const artwork = await getOwnedArtwork(supabase, artworkId);
  if (!artwork) {
    throw new Error("作品不存在或无权操作。");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("请先登录馆长账号。");
  }

  const admin = createAdminSupabaseClient();
  const session = await loadMediaUploadSessionById(admin, sessionId);
  if (
    session.owner_id !== user.id ||
    session.artwork_id !== artworkId ||
    session.museum_id !== artwork.museum_id
  ) {
    throw new Error("上传会话不存在或无权操作。");
  }

  const warning = await queueArtworkUploadSessionCleanupById(
    admin,
    sessionId,
    "artwork.temp.cleanup.client",
  );
  if (warning) {
    throw new Error(`上传清理登记失败：${warning}`);
  }
}

async function prepareCommittedArtworkAssets(
  museumId: string,
  artworkId: string,
  mediaCommit: ArtworkMediaCommit,
  uploadSession: MediaUploadSession,
): Promise<PreparedArtworkCommit> {
  const versionToken = createStorageVersionToken();
  const admin = createAdminSupabaseClient();
  const assetRows: Array<Record<string, unknown>> = [];
  const versionedUploads: Array<{
    path: string;
    bytes: Uint8Array;
    mimeType: string;
  }> = [];
  const temporaryPaths: string[] = [];
  const sessionDescriptors = new Map(
    uploadSession.descriptors.map((descriptor) => [
      `${descriptor.kind}:${descriptor.path}`,
      descriptor,
    ]),
  );

  if (mediaCommit.image) {
    for (const [kind, descriptor] of Object.entries(mediaCommit.image) as Array<
      [
        "original" | "display" | "thumbnail",
        NonNullable<ArtworkMediaCommit["image"]>["original"],
      ]
    >) {
      validateMediaCommitDescriptor(sessionDescriptors, descriptor, {
        museumId,
        artworkId,
        kind,
        sessionId: uploadSession.id,
      });
      const bytes = await downloadPrivateObject(admin, descriptor.path);
      const validated = await inspectWebpBytes(bytes, {
        maxBytes: MAX_WEBP_BYTES,
        maxEdge: ARTWORK_IMAGE_EDGE_LIMITS[kind],
      });
      assertDimensions(kind, descriptor, validated);

      const finalPath = buildArtworkVersionedAssetPath({
        museumId,
        artworkId,
        versionToken,
        kind,
        mimeType: "image/webp",
      });
      versionedUploads.push({
        path: finalPath,
        bytes: validated.bytes,
        mimeType: "image/webp",
      });
      temporaryPaths.push(descriptor.path);
      assetRows.push({
        kind,
        storage_path: finalPath,
        mime_type: "image/webp",
        byte_size: validated.byteLength,
        width: validated.width,
        height: validated.height,
      });
    }
  }

  if (mediaCommit.audio) {
    validateMediaCommitDescriptor(sessionDescriptors, mediaCommit.audio, {
      museumId,
      artworkId,
      kind: "audio",
      sessionId: uploadSession.id,
    });
    const bytes = await downloadPrivateObject(admin, mediaCommit.audio.path);
    const validated = await validateAudioBytes(bytes, {
      mimeType: mediaCommit.audio.mimeType,
    });
    if (
      mediaCommit.audio.durationSeconds &&
      Math.abs(mediaCommit.audio.durationSeconds - validated.durationSeconds) > 1
    ) {
      throw new Error("音频时长与浏览器预处理结果不一致，请重新上传。");
    }

    const finalPath = buildArtworkVersionedAssetPath({
      museumId,
      artworkId,
      versionToken,
      kind: "audio",
      mimeType: validated.mimeType,
    });
    versionedUploads.push({
      path: finalPath,
      bytes: validated.bytes,
      mimeType: validated.mimeType,
    });
    temporaryPaths.push(mediaCommit.audio.path);
    assetRows.push({
      kind: "audio",
      storage_path: finalPath,
      mime_type: validated.mimeType,
      byte_size: validated.byteLength,
      duration_seconds: validated.durationSeconds,
    });
  }

  return {
    assetRows,
    versionedUploads,
    temporaryPaths,
  };
}

async function uploadVersionedAssets(
  versionedUploads: Array<{
    path: string;
    bytes: Uint8Array;
    mimeType: string;
  }>,
) {
  const admin = createAdminSupabaseClient();
  for (const upload of versionedUploads) {
    const { error } = await admin.storage
      .from("museum-private")
      .upload(upload.path, upload.bytes, {
        contentType: upload.mimeType,
        cacheControl: "3600",
        upsert: false,
      });
    if (error) {
      throw new Error(`作品媒体上传失败：${error.message}`);
    }
  }
}

async function downloadPrivateObject(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  path: string,
) {
  const { data, error } = await admin.storage.from("museum-private").download(path);
  if (error || !data) {
    throw new Error(`私密媒体读取失败：${path}：${error?.message ?? "未知错误"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

async function loadMediaUploadSessionById(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  sessionId: string,
) {
  const { data, error } = await admin
    .from("media_upload_sessions")
    .select(
      "id, owner_id, museum_id, artwork_id, authorized_paths, descriptors, status, expires_at, cleanup_queued_at, last_error",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    throw new Error(`媒体上传会话读取失败：${error.message}`);
  }
  if (!data) {
    throw new Error("媒体上传会话不存在。");
  }
  return mediaUploadSessionSchema
    .extend({
      last_error: z.string().nullable().optional(),
    })
    .parse(data);
}

async function loadMediaUploadSessionForCommit(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  mediaCommit: ArtworkMediaCommit,
  expected: { artworkId: string; museumId: string; ownerId: string },
) {
  const session = await loadMediaUploadSessionById(admin, mediaCommit.sessionId);
  if (
    session.owner_id !== expected.ownerId ||
    session.artwork_id !== expected.artworkId ||
    session.museum_id !== expected.museumId
  ) {
    throw new Error("媒体上传会话不存在或无权操作。");
  }
  if (session.status !== "authorized") {
    throw new Error("媒体上传会话已失效，请重新上传。");
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new Error("媒体上传会话已过期，请重新上传。");
  }
  return session;
}

function validateMediaCommitDescriptor(
  sessionDescriptors: Map<string, MediaUploadSessionDescriptor>,
  descriptor: {
    path: string;
    mimeType: string;
    byteSize: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
  },
  expected: {
    museumId: string;
    artworkId: string;
    kind: ArtworkAssetKind;
    sessionId: string;
  },
) {
  const parsed = assertArtworkTempUploadPath(descriptor.path, {
    museumId: expected.museumId,
    artworkId: expected.artworkId,
    kind: expected.kind,
  });
  if (parsed.uploadSessionId !== expected.sessionId) {
    throw new Error("媒体上传会话不匹配。");
  }

  const authorized = sessionDescriptors.get(`${expected.kind}:${descriptor.path}`);
  if (!authorized) {
    throw new Error("媒体提交内容未通过授权校验。");
  }
  if (
    authorized.mimeType !== descriptor.mimeType ||
    authorized.byteSize !== descriptor.byteSize ||
    (authorized.width ?? null) !== (descriptor.width ?? null) ||
    (authorized.height ?? null) !== (descriptor.height ?? null) ||
    (authorized.durationSeconds ?? null) !== (descriptor.durationSeconds ?? null)
  ) {
    throw new Error("媒体提交内容与授权描述不一致。");
  }
}

async function signArtworkAssets(supabase: SupabaseLike, paths: string[]) {
  const signedUrls = new Map<string, string>();
  await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await supabase.storage
        .from("museum-private")
        .createSignedUrl(path, 15 * 60);
      if (error) {
        throw new Error(`作品媒体授权失败：${error.message}`);
      }
      signedUrls.set(path, data.signedUrl);
    }),
  );
  return signedUrls;
}

function createStorageVersionToken() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

async function queueDirectCleanupJob(
  museumId: string,
  scope: string,
  objectPaths: string[],
  ownerId?: string,
) {
  const cleanPaths = [...new Set(objectPaths.filter((value) => value.trim().length > 0))];
  if (cleanPaths.length === 0) {
    return undefined;
  }

  const { error } = await createAdminSupabaseClient().rpc("enqueue_media_cleanup_job", {
    p_museum_id: museumId,
    p_owner_id: ownerId ?? null,
    p_scope: scope,
    p_object_paths: cleanPaths,
    p_tombstone_museum_id: null,
  });
  if (error) {
    return error.message;
  }
  return undefined;
}

async function queueArtworkUploadSessionCleanupById(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  sessionId: string,
  scope: string,
  options?: { keepCommittedStatus?: boolean },
) {
  const session = await loadMediaUploadSessionById(admin, sessionId);
  if (session.status === "cleanup_queued" && session.cleanup_queued_at) {
    return undefined;
  }
  if (session.authorized_paths.length === 0) {
    return undefined;
  }

  const { error } = await admin.rpc("enqueue_media_cleanup_job", {
    p_museum_id: session.museum_id,
    p_owner_id: session.owner_id,
    p_scope: scope,
    p_object_paths: session.authorized_paths,
    p_tombstone_museum_id: null,
  });
  if (error) {
    return error.message;
  }

  const nextStatus = options?.keepCommittedStatus ? "committed" : "cleanup_queued";
  const updatePayload: {
    status: "committed" | "cleanup_queued";
    cleanup_queued_at: string;
    last_error?: string | null;
  } = {
    status: nextStatus,
    cleanup_queued_at: new Date().toISOString(),
  };
  if (options?.keepCommittedStatus) {
    updatePayload.last_error = null;
  }
  const { error: updateError } = await admin
    .from("media_upload_sessions")
    .update(updatePayload)
    .eq("id", sessionId);
  if (updateError) {
    return updateError.message;
  }
  return undefined;
}

function withSignedUrl(
  asset: z.infer<typeof artworkAssetSchema>,
  signedUrl?: string,
) {
  return {
    kind: asset.kind,
    mimeType: asset.mime_type,
    byteSize: asset.byte_size,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
    durationSeconds: asset.duration_seconds ?? undefined,
    signedUrl,
  };
}

function assertDimensions(
  label: string,
  expected: { width: number; height: number },
  actual: { width: number; height: number },
) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(`${label} 图片尺寸与浏览器处理结果不一致，请重新上传。`);
  }
}

function shouldArtworkUpdateBumpSourceVersion(payload: ArtworkPatchRequest) {
  return Boolean(
    payload.createdOn !== undefined ||
      payload.age !== undefined ||
      payload.medium !== undefined ||
      payload.childQuote !== undefined ||
      payload.parentNote !== undefined ||
      payload.mediaCommit !== undefined ||
      payload.removeAudio,
  );
}

async function insertAuditEvent(
  supabase: SupabaseLike,
  museumId: string,
  entityId: string,
  entityType: string,
  eventType: string,
  metadata: Record<string, unknown>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("audit_events").insert({
    museum_id: museumId,
    actor_id: user?.id ?? null,
    entity_type: entityType,
    entity_id: entityId,
    event_type: eventType,
    metadata,
  });
  if (error) {
    throw new Error(`审计记录写入失败：${error.message}`);
  }
}

export async function validateUploadedAudioPreview(
  audioDataUrl: string,
  mimeType: string,
) {
  return decodeAndValidateAudioDataUrl(audioDataUrl, { mimeType });
}

export { extensionForMimeType };
