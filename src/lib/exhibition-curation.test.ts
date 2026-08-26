import { describe, expect, it } from "vitest";
import {
  buildEditableExhibitionFromFeatured,
  normalizeRoomArtworkDisplayConfig,
  summarizeEditableExhibition,
  validateExhibitionForPublish,
} from "@/lib/exhibition-curation";

describe("editable exhibition helpers", () => {
  it("builds the featured exhibition into an editable draft", () => {
    const exhibition = buildEditableExhibitionFromFeatured();

    expect(exhibition.title).toBe("想象力有翅膀");
    expect(exhibition.rooms).toHaveLength(2);
    expect(exhibition.rooms[0]?.subtitle).toBe("飞起来以后，一切都有了新的名字。");
    expect(exhibition.rooms[0]?.artworks.map((artwork) => artwork.artworkId)).toEqual([
      "flying-whale",
      "rainbow-city",
      "moon-garden",
    ]);
  });

  it("counts unique artworks across rooms", () => {
    const exhibition = buildEditableExhibitionFromFeatured();
    exhibition.rooms[1]?.artworks.push({
      artworkId: "flying-whale",
      displayConfig: normalizeRoomArtworkDisplayConfig({ size: "small" }),
    });

    expect(summarizeEditableExhibition(exhibition)).toEqual({
      roomCount: 2,
      artworkCount: 6,
    });
  });

  it("normalizes display config defaults", () => {
    expect(normalizeRoomArtworkDisplayConfig({ featured: true })).toEqual({
      featured: true,
      size: "medium",
      framePreset: "classic",
    });
  });

  it("requires 2 rooms and published artworks before publish", () => {
    const exhibition = buildEditableExhibitionFromFeatured();
    exhibition.rooms[1]!.artworks = [];

    const validation = validateExhibitionForPublish(exhibition, [
      { id: "flying-whale", status: "published" },
      { id: "rainbow-city", status: "draft" },
      { id: "moon-garden", status: "published" },
      { id: "family-table", status: "published" },
      { id: "blue-cat", status: "published" },
      { id: "paper-forest", status: "published" },
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("展室 01"),
        expect.stringContaining("展室 02"),
      ]),
    );
  });
});
