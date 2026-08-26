import type { ArtworkAssetKind } from "@/lib/artworks/contracts";

type ArtworkUploadPathParts = {
  museumId: string;
  artworkId: string;
  kind: ArtworkAssetKind;
  mimeType: string;
};

const TEMP_SEGMENT = "temp";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createArtworkUploadSessionId() {
  return crypto.randomUUID();
}

export function buildArtworkTempUploadPath(
  input: ArtworkUploadPathParts & { uploadSessionId: string },
) {
  return `${input.museumId}/${input.artworkId}/${TEMP_SEGMENT}/${input.uploadSessionId}/${input.kind}.${extensionForMimeType(input.mimeType)}`;
}

export function buildArtworkVersionedAssetPath(
  input: ArtworkUploadPathParts & { versionToken: string },
) {
  return `${input.museumId}/${input.artworkId}/${input.versionToken}/${input.kind}.${extensionForMimeType(input.mimeType)}`;
}

export function assertArtworkTempUploadPath(
  path: string,
  expected: {
    museumId: string;
    artworkId: string;
    kind: ArtworkAssetKind;
  },
) {
  const parsed = parseArtworkTempUploadPath(path);
  if (
    parsed.museumId !== expected.museumId ||
    parsed.artworkId !== expected.artworkId ||
    parsed.kind !== expected.kind
  ) {
    throw new Error("媒体暂存路径无效。");
  }
  return parsed;
}

export function parseArtworkTempUploadPath(path: string) {
  if (path.includes("\\") || path.includes("..")) {
    throw new Error("媒体暂存路径无效。");
  }

  const segments = path.split("/");
  if (segments.length !== 5) {
    throw new Error("媒体暂存路径无效。");
  }

  const [museumId, artworkId, tempSegment, uploadSessionId, fileName] = segments;
  if (
    !UUID_PATTERN.test(museumId) ||
    !UUID_PATTERN.test(artworkId) ||
    tempSegment !== TEMP_SEGMENT ||
    !UUID_PATTERN.test(uploadSessionId)
  ) {
    throw new Error("媒体暂存路径无效。");
  }

  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    throw new Error("媒体暂存路径无效。");
  }

  const kind = fileName.slice(0, dotIndex) as ArtworkAssetKind;
  const extension = fileName.slice(dotIndex + 1).toLowerCase();
  if (!["original", "display", "thumbnail", "audio"].includes(kind)) {
    throw new Error("媒体暂存路径无效。");
  }

  return {
    museumId,
    artworkId,
    uploadSessionId,
    kind,
    extension,
  };
}

export function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/webp":
      return "webp";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
      return "wav";
    default:
      throw new Error("不支持的媒体 MIME 类型。");
  }
}
