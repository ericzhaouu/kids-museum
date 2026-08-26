import { parseBuffer } from "music-metadata";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_SECONDS,
  audioMimeTypes,
} from "@/lib/artworks/contracts";

const AUDIO_DATA_URL_PREFIX = /^data:(audio\/[a-z0-9.+-]+);base64,/i;

const AUDIO_SIGNATURES = [
  {
    mimeType: "audio/webm" as const,
    matches: (bytes: Uint8Array) =>
      bytes.length >= 4 &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3,
  },
  {
    mimeType: "audio/mpeg" as const,
    matches: (bytes: Uint8Array) =>
      (bytes.length >= 3 &&
        bytes[0] === 0x49 &&
        bytes[1] === 0x44 &&
        bytes[2] === 0x33) ||
      (bytes.length >= 2 &&
        bytes[0] === 0xff &&
        (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2)),
  },
  {
    mimeType: "audio/mp4" as const,
    matches: (bytes: Uint8Array) =>
      bytes.length >= 12 &&
      readAscii(bytes, 4, 8) === "ftyp" &&
      ["M4A ", "isom", "mp42", "mp41"].includes(readAscii(bytes, 8, 12)),
  },
  {
    mimeType: "audio/wav" as const,
    matches: (bytes: Uint8Array) =>
      bytes.length >= 12 &&
      readAscii(bytes, 0, 4) === "RIFF" &&
      readAscii(bytes, 8, 12) === "WAVE",
  },
  {
    mimeType: "audio/ogg" as const,
    matches: (bytes: Uint8Array) =>
      bytes.length >= 4 && readAscii(bytes, 0, 4) === "OggS",
  },
];

export type ValidatedAudioAsset = {
  bytes: Uint8Array;
  byteLength: number;
  mimeType: (typeof audioMimeTypes)[number];
  durationSeconds: number;
};

export async function validateAudioBytes(
  bytes: Uint8Array,
  options?: { maxBytes?: number; mimeType?: string },
): Promise<ValidatedAudioAsset> {
  const maxBytes = options?.maxBytes ?? MAX_AUDIO_BYTES;
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new Error(
      `音频大小不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB。`,
    );
  }

  const detected = AUDIO_SIGNATURES.find((entry) => entry.matches(bytes));
  if (!detected) {
    throw new Error("音频文件头无效或格式不受支持。");
  }
  if (options?.mimeType && detected.mimeType !== options.mimeType) {
    throw new Error("音频 MIME 与文件头不匹配。");
  }

  const metadata = await parseBuffer(Buffer.from(bytes), {
    mimeType: detected.mimeType,
    size: bytes.byteLength,
  });
  const durationSeconds = Number(metadata.format.duration ?? NaN);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("音频时长无法被服务端可靠验证，请改用 MP3、M4A、WebM、OGG 或 WAV 后重试。");
  }
  if (durationSeconds > MAX_AUDIO_DURATION_SECONDS) {
    throw new Error(`音频时长不能超过 ${MAX_AUDIO_DURATION_SECONDS} 秒。`);
  }

  return {
    bytes,
    byteLength: bytes.byteLength,
    mimeType: detected.mimeType,
    durationSeconds,
  };
}

export async function decodeAndValidateAudioDataUrl(
  dataUrl: string,
  options?: { maxBytes?: number; mimeType?: string },
): Promise<ValidatedAudioAsset> {
  const match = AUDIO_DATA_URL_PREFIX.exec(dataUrl);
  if (!match) {
    throw new Error("音频必须是经过浏览器读取的 data URL。");
  }

  const claimedMimeType = match[1]?.toLowerCase();
  if (!claimedMimeType || !audioMimeTypes.includes(claimedMimeType as never)) {
    throw new Error("当前只支持 WebM、MP3、M4A、WAV 或 OGG 音频。");
  }
  if (options?.mimeType && options.mimeType !== claimedMimeType) {
    throw new Error("音频 MIME 与实际上传字段不一致。");
  }

  const payload = dataUrl.slice(match[0].length);
  if (
    payload.length === 0 ||
    payload.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      payload,
    )
  ) {
    throw new Error("音频 base64 编码无效。");
  }

  return validateAudioBytes(
    Uint8Array.from(Buffer.from(payload, "base64")),
    {
      maxBytes: options?.maxBytes,
      mimeType: claimedMimeType,
    },
  );
}

function readAscii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}
