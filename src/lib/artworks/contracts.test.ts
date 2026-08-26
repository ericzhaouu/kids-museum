import { describe, expect, it } from "vitest";
import {
  artworkMediaCommitSchema,
  artworkUploadAuthorizationRequestSchema,
  createArtworkPayloadSchema,
  patchArtworkPayloadSchema,
  patchArtworkRequestSchema,
  shouldBumpArtworkSourceVersion,
} from "@/lib/artworks/contracts";

function imagePayload() {
  return {
    original: {
      dataUrl: "data:image/webp;base64,AA==",
      width: 1200,
      height: 900,
    },
    display: {
      dataUrl: "data:image/webp;base64,AA==",
      width: 800,
      height: 600,
    },
    thumbnail: {
      dataUrl: "data:image/webp;base64,AA==",
      width: 320,
      height: 240,
    },
    rotation: 90 as const,
    crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
    focusX: 0.4,
    focusY: 0.6,
  };
}

describe("artwork API contracts", () => {
  it("accepts full create payloads with image and audio metadata", () => {
    expect(
      createArtworkPayloadSchema.safeParse({
        title: "会发光的桥",
        description: "",
        createdOn: null,
        age: "6 岁",
        medium: "水彩",
        childQuote: "这座桥晚上会亮",
        parentNote: "",
        image: imagePayload(),
        audio: {
          dataUrl: "data:audio/webm;base64,AA==",
          mimeType: "audio/webm",
          durationSeconds: 12,
          byteSize: 1024,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects conflicting audio patch instructions", () => {
    expect(
      patchArtworkPayloadSchema.safeParse({
        audio: {
          dataUrl: "data:audio/webm;base64,AA==",
          mimeType: "audio/webm",
          durationSeconds: 12,
          byteSize: 1024,
        },
        removeAudio: true,
      }).success,
    ).toBe(false);
  });

  it("bumps source version only for source inputs and media changes", () => {
    expect(shouldBumpArtworkSourceVersion({ title: "仅改标题" })).toBe(false);
    expect(shouldBumpArtworkSourceVersion({ childQuote: "新的原话" })).toBe(true);
    expect(shouldBumpArtworkSourceVersion({ image: imagePayload() })).toBe(true);
  });

  it("validates direct-upload authorization and commit contracts", () => {
    expect(
      artworkUploadAuthorizationRequestSchema.safeParse({
        image: {
          original: {
            mimeType: "image/webp",
            byteSize: 1024,
            width: 2400,
            height: 1800,
          },
          display: {
            mimeType: "image/webp",
            byteSize: 512,
            width: 1600,
            height: 1200,
          },
          thumbnail: {
            mimeType: "image/webp",
            byteSize: 128,
            width: 480,
            height: 360,
          },
        },
      }).success,
    ).toBe(true);
    expect(
      artworkMediaCommitSchema.safeParse({
        sessionId: "33333333-3333-4333-8333-333333333333",
        image: {
          original: {
            path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/temp/33333333-3333-4333-8333-333333333333/original.webp",
            mimeType: "image/webp",
            byteSize: 1024,
            width: 2400,
            height: 1800,
          },
          display: {
            path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/temp/33333333-3333-4333-8333-333333333333/display.webp",
            mimeType: "image/webp",
            byteSize: 512,
            width: 1600,
            height: 1200,
          },
          thumbnail: {
            path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/temp/33333333-3333-4333-8333-333333333333/thumbnail.webp",
            mimeType: "image/webp",
            byteSize: 128,
            width: 480,
            height: 360,
          },
        },
      }).success,
    ).toBe(true);
    expect(
      patchArtworkRequestSchema.safeParse({
        mediaCommit: {
          sessionId: "33333333-3333-4333-8333-333333333333",
          audio: {
            path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/temp/33333333-3333-4333-8333-333333333333/audio.wav",
            mimeType: "audio/wav",
            byteSize: 2048,
            durationSeconds: 4,
          },
        },
      }).success,
    ).toBe(true);
  });
});
