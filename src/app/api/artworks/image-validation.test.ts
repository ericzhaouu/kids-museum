import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  decodeAndValidateWebpDataUrl,
  inspectWebpBytes,
} from "@/app/api/artworks/image-validation";
import { MAX_WEBP_BYTES } from "@/lib/artworks/media-limits";

const PREFIX = "data:image/webp;base64,";
const VALID_WEBP_DATA_URL =
  `${PREFIX}UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+` +
  `AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=`;

describe("WebP upload validation", () => {
  it("decodes a valid WebP data URL", async () => {
    await expect(
      decodeAndValidateWebpDataUrl(VALID_WEBP_DATA_URL),
    ).resolves.toHaveLength(68);
  });

  it.each([
    "",
    PREFIX,
    `${PREFIX}not base64`,
    `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
    `${PREFIX}${Buffer.from("RIFFxxxxWEBP").toString("base64")}`,
  ])("rejects empty or bogus data: %s", async (value) => {
    await expect(decodeAndValidateWebpDataUrl(value)).rejects.toThrow();
  });

  it("rejects a mismatched RIFF length", async () => {
    const bytes = Buffer.from(
      VALID_WEBP_DATA_URL.slice(PREFIX.length),
      "base64",
    );
    bytes.writeUInt32LE(1, 4);

    await expect(
      decodeAndValidateWebpDataUrl(`${PREFIX}${bytes.toString("base64")}`),
    ).rejects.toThrow("不是有效的 WebP");
  });

  it("rejects a WebP container with a plausible but corrupt VP8 payload", async () => {
    const bytes = Buffer.alloc(32);
    bytes.write("RIFF", 0, "ascii");
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WEBP", 8, "ascii");
    bytes.write("VP8 ", 12, "ascii");
    bytes.writeUInt32LE(11, 16);
    bytes[20] = 0x20;
    bytes[23] = 0x9d;
    bytes[24] = 0x01;
    bytes[25] = 0x2a;
    bytes.writeUInt16LE(1, 26);
    bytes.writeUInt16LE(1, 28);
    bytes[30] = 1;

    await expect(
      decodeAndValidateWebpDataUrl(`${PREFIX}${bytes.toString("base64")}`),
    ).rejects.toThrow("无法解码");
  });

  it("fully decodes pixels instead of trusting parseable metadata", async () => {
    const corruptButParseable =
      `${PREFIX}UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASr+AAEAAUAmJaACdLoB+` +
      `AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=`;

    await expect(
      decodeAndValidateWebpDataUrl(corruptButParseable),
    ).rejects.toThrow("无法解码");
  });

  it("enforces the decoded byte-size cap", async () => {
    const bytes = Buffer.alloc(MAX_WEBP_BYTES + 2);
    bytes.write("RIFF", 0, "ascii");
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WEBP", 8, "ascii");
    bytes.write("VP8 ", 12, "ascii");
    bytes.writeUInt32LE(bytes.length - 20, 16);

    await expect(
      decodeAndValidateWebpDataUrl(`${PREFIX}${bytes.toString("base64")}`),
    ).rejects.toThrow("不能超过 8 MB");
  });

  it("allows a full 2400x2400 edge while keeping decompression limits", async () => {
    const bytes = await sharp({
      create: {
        width: 2400,
        height: 2400,
        channels: 3,
        background: { r: 120, g: 140, b: 160 },
      },
    })
      .webp()
      .toBuffer();

    await expect(
      inspectWebpBytes(Uint8Array.from(bytes), { maxEdge: 2400 }),
    ).resolves.toMatchObject({
      width: 2400,
      height: 2400,
    });
  });
});
