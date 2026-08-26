import sharp from "sharp";
import { MAX_WEBP_BYTES } from "@/lib/artworks/media-limits";

const WEBP_DATA_URL_PREFIX = "data:image/webp;base64,";
const MAX_WEBP_INPUT_PIXELS = 2400 * 2400;

export const MAX_WEBP_DATA_URL_LENGTH =
  WEBP_DATA_URL_PREFIX.length + Math.ceil((MAX_WEBP_BYTES * 4) / 3) + 2;

export type ValidatedWebpImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  byteLength: number;
};

export async function inspectWebpBytes(
  bytes: Uint8Array,
  options?: {
    maxBytes?: number;
    maxEdge?: number;
  },
): Promise<ValidatedWebpImage> {
  const maxBytes = options?.maxBytes ?? MAX_WEBP_BYTES;
  const maxEdge = options?.maxEdge ?? 1800;

  if (bytes.byteLength === 0) {
    throw new Error("作品图片数据为空或格式无效。");
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `处理后的作品图片不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB。`,
    );
  }
  if (!hasValidWebpContainer(bytes)) {
    throw new Error("作品图片不是有效的 WebP 文件。");
  }

  try {
    const image = sharp(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      {
        failOn: "error",
        limitInputPixels: MAX_WEBP_INPUT_PIXELS,
      },
    );
    const metadata = await image.metadata();
    if (
      metadata.format !== "webp" ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > maxEdge ||
      metadata.height > maxEdge
    ) {
      throw new Error("invalid dimensions");
    }
    await image.raw().toBuffer();
    return {
      bytes,
      width: metadata.width,
      height: metadata.height,
      byteLength: bytes.byteLength,
    };
  } catch {
    throw new Error("作品图片无法解码或尺寸无效。");
  }
}

export async function decodeAndInspectWebpDataUrl(
  dataUrl: string,
  options?: {
    maxBytes?: number;
    maxEdge?: number;
  },
): Promise<ValidatedWebpImage> {
  if (!dataUrl.startsWith(WEBP_DATA_URL_PREFIX)) {
    throw new Error("作品图片必须是经过隐私清理的 WebP 图片。");
  }

  const payload = dataUrl.slice(WEBP_DATA_URL_PREFIX.length);
  if (
    payload.length === 0 ||
    payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  ) {
    throw new Error("作品图片数据为空或格式无效。");
  }

  return inspectWebpBytes(
    Uint8Array.from(Buffer.from(payload, "base64")),
    options,
  );
}

export async function decodeAndValidateWebpDataUrl(
  dataUrl: string,
): Promise<Uint8Array> {
  const result = await decodeAndInspectWebpDataUrl(dataUrl);
  return result.bytes;
}

function hasValidWebpContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 25) {
    return false;
  }
  if (
    readAscii(bytes, 0, 4) !== "RIFF" ||
    readAscii(bytes, 8, 12) !== "WEBP"
  ) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffPayloadSize = view.getUint32(4, true);
  if (riffPayloadSize !== bytes.byteLength - 8) {
    return false;
  }

  let offset = 12;
  let foundImagePayload = false;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = readAscii(bytes, offset, offset + 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    const paddedChunkSize = chunkSize + (chunkSize % 2);
    if (payloadOffset + paddedChunkSize > bytes.byteLength) {
      return false;
    }

    if (chunkType === "VP8 ") {
      foundImagePayload =
        foundImagePayload ||
        hasValidLossyVp8Payload(bytes, view, payloadOffset, chunkSize);
    } else if (chunkType === "VP8L") {
      foundImagePayload =
        foundImagePayload ||
        hasValidLosslessVp8Payload(bytes, view, payloadOffset, chunkSize);
    } else if (
      chunkType === "VP8X" &&
      !hasValidExtendedHeader(view, payloadOffset, chunkSize)
    ) {
      return false;
    }

    offset = payloadOffset + paddedChunkSize;
  }

  return offset === bytes.byteLength && foundImagePayload;
}

function hasValidLossyVp8Payload(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  size: number,
): boolean {
  if (
    size < 11 ||
    (bytes[offset] & 1) !== 0 ||
    bytes[offset + 3] !== 0x9d ||
    bytes[offset + 4] !== 0x01 ||
    bytes[offset + 5] !== 0x2a
  ) {
    return false;
  }

  const frameTag =
    bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  const firstPartitionSize = frameTag >>> 5;
  const width = view.getUint16(offset + 6, true) & 0x3fff;
  const height = view.getUint16(offset + 8, true) & 0x3fff;
  return (
    firstPartitionSize > 0 &&
    firstPartitionSize <= size - 10 &&
    width > 0 &&
    height > 0
  );
}

function hasValidLosslessVp8Payload(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  size: number,
): boolean {
  if (size < 5 || bytes[offset] !== 0x2f) {
    return false;
  }
  const dimensions = view.getUint32(offset + 1, true);
  return (dimensions >>> 29) === 0;
}

function hasValidExtendedHeader(
  view: DataView,
  offset: number,
  size: number,
): boolean {
  if (size !== 10) {
    return false;
  }
  const widthMinusOne =
    view.getUint8(offset + 4) |
    (view.getUint8(offset + 5) << 8) |
    (view.getUint8(offset + 6) << 16);
  const heightMinusOne =
    view.getUint8(offset + 7) |
    (view.getUint8(offset + 8) << 8) |
    (view.getUint8(offset + 9) << 16);
  return widthMinusOne < 0xffffff && heightMinusOne < 0xffffff;
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
