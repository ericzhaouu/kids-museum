import { describe, expect, it } from "vitest";
import {
  decodeAndValidateAudioDataUrl,
  validateAudioBytes,
} from "@/lib/artworks/audio-validation";

function toDataUrl(mimeType: string, bytes: Uint8Array) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function createSilentWav(seconds: number) {
  const sampleRate = 1;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

describe("audio upload validation", () => {
  it("accepts supported audio signatures and returns server-verified duration", async () => {
    const wav = createSilentWav(2);
    await expect(
      decodeAndValidateAudioDataUrl(toDataUrl("audio/wav", wav)),
    ).resolves.toMatchObject({
      mimeType: "audio/wav",
      byteLength: wav.byteLength,
      durationSeconds: 2,
    });
    await expect(
      validateAudioBytes(Uint8Array.from(wav), { mimeType: "audio/wav" }),
    ).resolves.toMatchObject({
      mimeType: "audio/wav",
      byteLength: wav.byteLength,
      durationSeconds: 2,
    });
  });

  it("rejects mismatched or spoofed mime types", async () => {
    const wav = createSilentWav(1);
    await expect(
      decodeAndValidateAudioDataUrl(toDataUrl("audio/mp4", wav)),
    ).rejects.toThrow("文件头");
    await expect(
      decodeAndValidateAudioDataUrl("data:audio/mp3;base64,@@@@"),
    ).rejects.toThrow("只支持");
  });

  it("rejects invalid base64, oversized payloads, and unbounded durations", async () => {
    await expect(
      decodeAndValidateAudioDataUrl("data:audio/webm;base64,@@@@"),
    ).rejects.toThrow("编码无效");

    const large = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01]);
    await expect(
      decodeAndValidateAudioDataUrl(toDataUrl("audio/webm", large), {
        maxBytes: 4,
      }),
    ).rejects.toThrow("不能超过");

    const tooLong = createSilentWav(601);
    await expect(
      decodeAndValidateAudioDataUrl(toDataUrl("audio/wav", tooLong)),
    ).rejects.toThrow("600 秒");
  });
});
