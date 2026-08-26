import type {
  ArtworkMediaCommit,
  ArtworkPatchRequest,
  ArtworkUploadAuthorizationRequest,
  ArtworkUploadAuthorizationResponse,
  CreateArtworkPayload,
  PatchArtworkPayload,
  StudioArtwork,
  StudioSuggestion,
} from "@/lib/artworks/contracts";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export type ArtworkMutationResult = {
  artwork: StudioArtwork;
  warning?: string;
};

export async function createArtworkRequest(
  payload: CreateArtworkPayload,
): Promise<ArtworkMutationResult> {
  const response = await fetch("/api/artworks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toArtworkDraftRequest(payload)),
  });
  const body = (await response.json()) as
    | { artwork: StudioArtwork }
    | { error: string };
  if (!response.ok || !("artwork" in body)) {
    throw new Error("error" in body ? body.error : "作品保存失败。");
  }

  if (!payload.image && !payload.audio) {
    return { artwork: body.artwork };
  }

  let uploadPlan: ArtworkUploadAuthorizationResponse | null = null;
  try {
    uploadPlan = await authorizeArtworkUploads(
      body.artwork.id,
      buildUploadAuthorizationRequest(payload),
    );
    await performDirectArtworkUploads(body.artwork.id, payload, uploadPlan);
    const committed = await patchArtworkRequest(body.artwork.id, {
      mediaCommit: buildArtworkMediaCommitPayload(payload, uploadPlan),
    });
    return committed;
  } catch (error) {
    if (uploadPlan) {
      await requestArtworkUploadCleanup(body.artwork.id, {
        sessionId: uploadPlan.sessionId,
      });
    }
    return {
      artwork: body.artwork,
      warning: `作品草稿已创建，但媒体提交失败，可打开编辑重试上传或直接删除：${error instanceof Error ? error.message : "未知错误。"}`,
    };
  }
}

export async function updateArtworkRequest(
  artworkId: string,
  payload: PatchArtworkPayload,
): Promise<ArtworkMutationResult> {
  const requestBody: ArtworkPatchRequest = toArtworkPatchRequest(payload);
  let uploadPlan: ArtworkUploadAuthorizationResponse | null = null;
  if (payload.image || payload.audio) {
    uploadPlan = await authorizeArtworkUploads(
      artworkId,
      buildUploadAuthorizationRequest(payload),
    );
    await performDirectArtworkUploads(artworkId, payload, uploadPlan);
    requestBody.mediaCommit = buildArtworkMediaCommitPayload(payload, uploadPlan);
  }
  try {
    return await patchArtworkRequest(artworkId, requestBody);
  } catch (error) {
    if (uploadPlan) {
      await requestArtworkUploadCleanup(artworkId, {
        sessionId: uploadPlan.sessionId,
      });
    }
    throw error;
  }
}

async function patchArtworkRequest(
  artworkId: string,
  payload: ArtworkPatchRequest,
): Promise<ArtworkMutationResult> {
  const response = await fetch(`/api/artworks/${artworkId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as
    | { artwork: StudioArtwork; warning?: string }
    | { error: string };
  if (!response.ok || !("artwork" in body)) {
    throw new Error("error" in body ? body.error : "作品修改失败。");
  }
  return {
    artwork: body.artwork,
    warning: body.warning,
  };
}

export async function fetchArtworkSuggestions(artworkId: string) {
  const response = await fetch(
    `/api/ai/suggest?artworkId=${encodeURIComponent(artworkId)}`,
    { cache: "no-store" },
  );
  const body = (await response.json()) as
    | { suggestions: StudioSuggestion[]; sourceVersion: number }
    | { error: string };
  if (!response.ok || !("suggestions" in body)) {
    throw new Error("error" in body ? body.error : "AI 建议读取失败。");
  }
  return body;
}

export async function generateArtworkSuggestions(artworkId: string) {
  const response = await fetch("/api/ai/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artworkId }),
  });
  const body = (await response.json()) as
    | {
        suggestion: {
          title: string;
          description: string;
          tags: string[];
        };
        suggestions: StudioSuggestion[];
        sourceVersion: number;
      }
    | { error: string };
  if (!response.ok || !("suggestions" in body)) {
    throw new Error("error" in body ? body.error : "AI 建议生成失败。");
  }
  return body;
}

export async function reviewArtworkSuggestion(
  suggestionId: string,
  action: "accept" | "reject",
) {
  const response = await fetch(`/api/ai/suggest/${suggestionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const body = (await response.json()) as
    | { reviewed: true; status: string; suggestions: StudioSuggestion[] }
    | { error: string };
  if (!response.ok || !("reviewed" in body)) {
    throw new Error("error" in body ? body.error : "AI 建议审核失败。");
  }
  return body;
}

export async function requestArtworkTranscription(artworkId: string) {
  const response = await fetch(`/api/artworks/${artworkId}/transcription`, {
    method: "POST",
  });
  const body = (await response.json()) as
    | { transcript: string; suggestions: StudioSuggestion[] }
    | { error: string };
  if (!response.ok || !("transcript" in body)) {
    throw new Error("error" in body ? body.error : "录音转写失败。");
  }
  return body;
}

async function authorizeArtworkUploads(
  artworkId: string,
  payload: ArtworkUploadAuthorizationRequest,
) {
  const response = await fetch(`/api/artworks/${artworkId}/uploads/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as
    | { uploads: ArtworkUploadAuthorizationResponse }
    | { error: string };
  if (!response.ok || !("uploads" in body)) {
    throw new Error("error" in body ? body.error : "媒体直传授权失败。");
  }
  return body.uploads;
}

async function performDirectArtworkUploads(
  artworkId: string,
  payload: Pick<CreateArtworkPayload | PatchArtworkPayload, "image" | "audio">,
  uploadPlan: ArtworkUploadAuthorizationResponse,
) {
  const supabase = createBrowserSupabaseClient();
  const uploads: Array<Promise<void>> = [];

  if (payload.image && uploadPlan.image) {
    uploads.push(
      uploadViaSignedUrl(
        uploadPlan.image.original.path,
        uploadPlan.image.original.token,
        await dataUrlToBlob(payload.image.original.dataUrl),
        "image/webp",
        supabase,
      ),
      uploadViaSignedUrl(
        uploadPlan.image.display.path,
        uploadPlan.image.display.token,
        await dataUrlToBlob(payload.image.display.dataUrl),
        "image/webp",
        supabase,
      ),
      uploadViaSignedUrl(
        uploadPlan.image.thumbnail.path,
        uploadPlan.image.thumbnail.token,
        await dataUrlToBlob(payload.image.thumbnail.dataUrl),
        "image/webp",
        supabase,
      ),
    );
  }

  if (payload.audio && uploadPlan.audio) {
    uploads.push(
      uploadViaSignedUrl(
        uploadPlan.audio.path,
        uploadPlan.audio.token,
        await dataUrlToBlob(payload.audio.dataUrl),
        payload.audio.mimeType,
        supabase,
      ),
    );
  }

  try {
    await Promise.all(uploads);
  } catch (error) {
    await requestArtworkUploadCleanup(artworkId, {
      sessionId: uploadPlan.sessionId,
    });
    throw error;
  }
}

async function uploadViaSignedUrl(
  path: string,
  token: string,
  blob: Blob,
  contentType: string,
  supabase: ReturnType<typeof createBrowserSupabaseClient>,
) {
  const { error } = await supabase.storage
    .from("museum-private")
    .uploadToSignedUrl(path, token, blob, {
      contentType,
      upsert: false,
    });
  if (error) {
    throw new Error(`媒体直传失败：${error.message}`);
  }
}

function buildUploadAuthorizationRequest(
  payload: Pick<CreateArtworkPayload | PatchArtworkPayload, "image" | "audio">,
): ArtworkUploadAuthorizationRequest {
  const request: ArtworkUploadAuthorizationRequest = {};
  if (payload.image) {
    request.image = {
      original: {
        mimeType: "image/webp",
        byteSize: estimateBase64ByteSize(payload.image.original.dataUrl),
        width: payload.image.original.width,
        height: payload.image.original.height,
      },
      display: {
        mimeType: "image/webp",
        byteSize: estimateBase64ByteSize(payload.image.display.dataUrl),
        width: payload.image.display.width,
        height: payload.image.display.height,
      },
      thumbnail: {
        mimeType: "image/webp",
        byteSize: estimateBase64ByteSize(payload.image.thumbnail.dataUrl),
        width: payload.image.thumbnail.width,
        height: payload.image.thumbnail.height,
      },
    };
  }
  if (payload.audio) {
    request.audio = {
      mimeType: payload.audio.mimeType,
      byteSize: payload.audio.byteSize,
      durationSeconds: payload.audio.durationSeconds,
    };
  }
  return request;
}

function buildArtworkMediaCommitPayload(
  payload: Pick<CreateArtworkPayload | PatchArtworkPayload, "image" | "audio">,
  uploadPlan: ArtworkUploadAuthorizationResponse,
): ArtworkMediaCommit {
  const mediaCommit: ArtworkMediaCommit = {
    sessionId: uploadPlan.sessionId,
  };
  if (payload.image && uploadPlan.image) {
    mediaCommit.image = {
      original: {
        path: uploadPlan.image.original.path,
        mimeType: "image/webp",
        byteSize: estimateBase64ByteSize(payload.image.original.dataUrl),
        width: payload.image.original.width,
        height: payload.image.original.height,
      },
      display: {
        path: uploadPlan.image.display.path,
        mimeType: "image/webp",
        byteSize: estimateBase64ByteSize(payload.image.display.dataUrl),
        width: payload.image.display.width,
        height: payload.image.display.height,
      },
      thumbnail: {
        path: uploadPlan.image.thumbnail.path,
        mimeType: "image/webp",
        byteSize: estimateBase64ByteSize(payload.image.thumbnail.dataUrl),
        width: payload.image.thumbnail.width,
        height: payload.image.thumbnail.height,
      },
    };
  }
  if (payload.audio && uploadPlan.audio) {
    mediaCommit.audio = {
      path: uploadPlan.audio.path,
      mimeType: payload.audio.mimeType,
      byteSize: payload.audio.byteSize,
      durationSeconds: payload.audio.durationSeconds,
    };
  }
  return mediaCommit;
}

async function requestArtworkUploadCleanup(
  artworkId: string,
  payload: { sessionId: string },
) {
  if (!payload.sessionId) {
    return;
  }
  await fetch(`/api/artworks/${artworkId}/uploads/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

function toArtworkDraftRequest(payload: CreateArtworkPayload) {
  return {
    title: payload.title,
    description: payload.description,
    createdOn: payload.createdOn,
    age: payload.age,
    medium: payload.medium,
    childQuote: payload.childQuote,
    parentNote: payload.parentNote,
  };
}

function toArtworkPatchRequest(payload: PatchArtworkPayload): ArtworkPatchRequest {
  return {
    title: payload.title,
    description: payload.description,
    createdOn: payload.createdOn,
    age: payload.age,
    medium: payload.medium,
    childQuote: payload.childQuote,
    parentNote: payload.parentNote,
    status: payload.status,
    removeAudio: payload.removeAudio,
  };
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function estimateBase64ByteSize(dataUrl: string) {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}
