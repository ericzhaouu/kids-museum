import { describe, expect, it } from "vitest";
import {
  assertArtworkTempUploadPath,
  buildArtworkTempUploadPath,
  buildArtworkVersionedAssetPath,
} from "@/lib/artworks/direct-upload";

const museumId = "11111111-1111-4111-8111-111111111111";
const artworkId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

describe("artwork direct upload paths", () => {
  it("builds deterministic temp and final paths without exposing caller control", () => {
    expect(
      buildArtworkTempUploadPath({
        museumId,
        artworkId,
        uploadSessionId: sessionId,
        kind: "display",
        mimeType: "image/webp",
      }),
    ).toBe(`${museumId}/${artworkId}/temp/${sessionId}/display.webp`);
    expect(
      buildArtworkVersionedAssetPath({
        museumId,
        artworkId,
        versionToken: "v-123",
        kind: "audio",
        mimeType: "audio/mp4",
      }),
    ).toBe(`${museumId}/${artworkId}/v-123/audio.m4a`);
  });

  it("rejects forged cross-museum temp paths", () => {
    expect(() =>
      assertArtworkTempUploadPath(
        `99999999-9999-4999-8999-999999999999/${artworkId}/temp/${sessionId}/audio.wav`,
        { museumId, artworkId, kind: "audio" },
      ),
    ).toThrow("路径无效");
  });

  it("rejects traversal and wrong kind paths", () => {
    expect(() =>
      assertArtworkTempUploadPath(
        `${museumId}/${artworkId}/temp/${sessionId}/../audio.wav`,
        { museumId, artworkId, kind: "audio" },
      ),
    ).toThrow("路径无效");
    expect(() =>
      assertArtworkTempUploadPath(
        `${museumId}/${artworkId}/temp/${sessionId}/thumbnail.webp`,
        { museumId, artworkId, kind: "audio" },
      ),
    ).toThrow("路径无效");
  });
});
