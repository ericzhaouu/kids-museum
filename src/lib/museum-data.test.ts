import { describe, expect, it } from "vitest";
import { featuredExhibition } from "@/lib/museum-data";

describe("featured exhibition", () => {
  it("contains uniquely addressable rooms and artworks", () => {
    const roomIds = featuredExhibition.rooms.map((room) => room.id);
    const artworks = featuredExhibition.rooms.flatMap((room) => room.artworks);
    const artworkIds = artworks.map((artwork) => artwork.id);

    expect(new Set(roomIds).size).toBe(roomIds.length);
    expect(new Set(artworkIds).size).toBe(artworkIds.length);
    expect(artworks.length).toBeGreaterThan(0);
  });

  it("keeps the child's words separate from the curated description", () => {
    const artworks = featuredExhibition.rooms.flatMap((room) => room.artworks);

    artworks.forEach((artwork) => {
      expect(artwork.childQuote.trim()).not.toBe("");
      expect(artwork.description.trim()).not.toBe("");
      expect(artwork.childQuote).not.toBe(artwork.description);
    });
  });
});
