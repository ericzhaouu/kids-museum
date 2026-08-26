import { describe, expect, it } from "vitest";
import {
  consumeAiRateLimit,
  parseProviderSuggestion,
  parseSuggestionRequest,
} from "@/app/api/ai/suggest/route-helpers";

describe("AI suggestion request validation", () => {
  it("requires an artwork id instead of raw image or parent notes", () => {
    expect(parseSuggestionRequest({ artworkId: crypto.randomUUID() }).success).toBe(
      true,
    );
    expect(
      parseSuggestionRequest({
        artworkId: crypto.randomUUID(),
        parentNote: "不得发送给 AI",
      }).success,
    ).toBe(false);
    expect(parseSuggestionRequest({ imageDataUrl: "data:image/webp;base64,AA==" }).success).toBe(
      false,
    );
  });
});

describe("AI suggestion parsing", () => {
  it("accepts valid JSON suggestions and strips fenced blocks", () => {
    const parsed = parseProviderSuggestion(
      '```json\n{"title":"会唱歌的树","description":"一幅会在晚上轻轻发光的树。","tags":["夜晚","树"]}\n```',
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tags).toEqual(["夜晚", "树"]);
    }
  });

  it("rejects malformed or incomplete provider payloads", () => {
    expect(parseProviderSuggestion("{").success).toBe(false);
    expect(
      parseProviderSuggestion('{"title":"","description":"ok","tags":["a"]}').success,
    ).toBe(false);
  });
});

describe("AI per-user rate limiting", () => {
  it("limits each user independently and resets after the window", () => {
    const entries = new Map();
    for (let index = 0; index < 5; index += 1) {
      expect(consumeAiRateLimit("curator-a", 1_000, entries).allowed).toBe(true);
    }
    expect(consumeAiRateLimit("curator-a", 1_000, entries).allowed).toBe(false);
    expect(consumeAiRateLimit("curator-b", 1_000, entries).allowed).toBe(true);
    expect(consumeAiRateLimit("curator-a", 61_000, entries).allowed).toBe(true);
  });
});
