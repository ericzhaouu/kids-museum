import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isMuseumArtworkAssetPath } from "@/lib/exhibitions.server";

describe("museum artwork asset paths", () => {
  const museumId = "11111111-1111-4111-8111-111111111111";
  const artworkId = "22222222-2222-4222-8222-222222222222";

  it("accepts only non-empty paths under the exact museum and artwork", () => {
    expect(
      isMuseumArtworkAssetPath(
        `${museumId}/${artworkId}/display.webp`,
        museumId,
        artworkId,
      ),
    ).toBe(true);
    expect(
      isMuseumArtworkAssetPath(`${museumId}/${artworkId}/`, museumId, artworkId),
    ).toBe(false);
  });

  it("rejects paths owned by another museum or artwork", () => {
    expect(
      isMuseumArtworkAssetPath(
        `33333333-3333-4333-8333-333333333333/${artworkId}/display.webp`,
        museumId,
        artworkId,
      ),
    ).toBe(false);
    expect(
      isMuseumArtworkAssetPath(
        `${museumId}/44444444-4444-4444-8444-444444444444/display.webp`,
        museumId,
        artworkId,
      ),
    ).toBe(false);
  });
});
