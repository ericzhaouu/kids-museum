import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_SECONDS,
  audioMimeTypes,
  type ArtworkAudioInput,
} from "@/lib/artworks/contracts";
import { readFileAsDataUrl } from "@/lib/image-processing";

const allowedAudioMimeTypes = new Set<string>(audioMimeTypes);

export async function buildArtworkAudioInput(
  file: File,
): Promise<ArtworkAudioInput> {
  if (!allowedAudioMimeTypes.has(file.type)) {
    throw new Error("当前只支持 WebM、MP3、M4A、WAV 或 OGG 音频。");
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("音频不能超过 12 MB。");
  }

  const durationSeconds = await readAudioDuration(file);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("无法读取音频时长，请更换文件。");
  }
  if (durationSeconds > MAX_AUDIO_DURATION_SECONDS) {
    throw new Error("音频时长不能超过 10 分钟。");
  }

  return {
    dataUrl: await readFileAsDataUrl(file),
    mimeType: file.type as ArtworkAudioInput["mimeType"],
    durationSeconds,
    byteSize: file.size,
    fileName: file.name,
  };
}

async function readAudioDuration(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error("无法读取音频元数据。"));
      audio.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
