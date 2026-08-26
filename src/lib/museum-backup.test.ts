import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  applyStableAscendingOrder,
  BACKUP_PAGINATION_ORDER,
  createBackupJsonFiles,
  sanitizeBackupPayload,
  serializeBackupArtworkTag,
  toBackupRelativeMediaPath,
} from "@/lib/museum-backup";

describe("museum backup helpers", () => {
  it("maps storage paths to stable relative media paths", () => {
    expect(
      toBackupRelativeMediaPath(
        "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/v1/audio.wav",
      ),
    ).toBe(
      "media/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/v1/audio.wav",
    );
  });

  it("rejects media paths that could escape the backup directory", () => {
    expect(() => toBackupRelativeMediaPath("../foreign/file.webp")).toThrow(
      "路径无效",
    );
    expect(() => toBackupRelativeMediaPath("/absolute/file.webp")).toThrow(
      "路径无效",
    );
  });

  it("rejects backup payloads containing tokens or signatures", () => {
    expect(() =>
      sanitizeBackupPayload({
        manifest: {
          exportVersion: 2,
          exportedAt: new Date().toISOString(),
          museumId: crypto.randomUUID(),
          containsPrivateContent: true,
          totalRegisteredMediaBytes: 0,
          files: [],
          media: { bucket: "museum-private", count: 0 },
        },
        museum: {
          id: crypto.randomUUID(),
          name: "museum",
          artist_nickname: "artist",
          theme_id: "warm-gallery",
          theme_version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        artworks: [],
        artworkAssets: [],
        artworkNotes: [],
        tags: [],
        exhibitions: [{ signedUrl: "https://example.com?signature=secret" }],
        invitations: [],
        auditEvents: [],
      }),
    ).toThrow("访问凭证");
  });

  it("creates versioned JSON backup files without hashes", async () => {
    const tag = serializeBackupArtworkTag({
      artwork_id: crypto.randomUUID(),
      tags: {
        id: crypto.randomUUID(),
        museum_id: crypto.randomUUID(),
        name: "太阳",
      },
    });
    const files = createBackupJsonFiles(
      sanitizeBackupPayload({
        manifest: {
          exportVersion: 2,
          exportedAt: new Date().toISOString(),
          museumId: crypto.randomUUID(),
          containsPrivateContent: true,
          totalRegisteredMediaBytes: 123,
          files: ["backup/manifest.v2.json"],
          media: { bucket: "museum-private", count: 1 },
        },
        museum: {
          id: crypto.randomUUID(),
          name: "museum",
          artist_nickname: "artist",
          theme_id: "warm-gallery",
          theme_version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        artworks: [],
        artworkAssets: [],
        artworkNotes: [],
        tags: [
          {
            catalog: tag.tag ? [tag.tag] : [],
            links: [tag],
          },
        ],
        exhibitions: [],
        invitations: [{ id: crypto.randomUUID(), label: "invite" }],
        auditEvents: [],
      }),
    );

    const zip = new JSZip();
    files.forEach((file) => {
      zip.file(file.path, file.body);
    });

    const generated = await zip.generateAsync({ type: "nodebuffer" });
    expect(generated.byteLength).toBeGreaterThan(0);
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "backup/manifest.v2.json",
        "backup/museum.v2.json",
        "backup/artworks.v2.json",
      ]),
    );
    expect(JSON.stringify(files)).not.toMatch(/token_hash|session_hash|signature/i);
    expect(
      JSON.parse(
        files.find((file) => file.path === "backup/artworks.v2.json")?.body ?? "{}",
      ),
    ).toMatchObject({
      tags: [
        {
          catalog: tag.tag ? [tag.tag] : [],
          links: [
            {
              artwork_id: tag.artwork_id,
              tag: tag.tag,
            },
          ],
        },
      ],
    });
  });

  it("preserves the real embedded tag object shape", () => {
    expect(
      serializeBackupArtworkTag({
        artwork_id: "art-1",
        tags: {
          id: "tag-1",
          museum_id: "museum-1",
          name: "海洋",
        },
      }),
    ).toEqual({
      artwork_id: "art-1",
      tag: {
        id: "tag-1",
        museum_id: "museum-1",
        name: "海洋",
      },
    });
  });

  it("applies stable unique backup ordering contracts", () => {
    const calls: string[] = [];
    const query = {
      order(column: string) {
        calls.push(column);
        return query;
      },
    };

    applyStableAscendingOrder(query, BACKUP_PAGINATION_ORDER.roomArtworks);
    applyStableAscendingOrder(query, BACKUP_PAGINATION_ORDER.artworkTags);

    expect(BACKUP_PAGINATION_ORDER).toMatchObject({
      artworks: ["created_at", "id"],
      artworkAssets: ["created_at", "id"],
      artworkNotes: ["created_at", "id"],
      artworkTags: ["artwork_id", "tag_id"],
      aiSuggestions: ["created_at", "id"],
      exhibitions: ["created_at", "id"],
      exhibitionRooms: ["sort_order", "id"],
      roomArtworks: ["room_id", "sort_order", "artwork_id"],
      exhibitionSuggestions: ["created_at", "id"],
      invitations: ["created_at", "id"],
      visitorSessions: ["created_at", "id"],
      auditEvents: ["created_at", "id"],
    });
    expect(calls).toEqual([
      "room_id",
      "sort_order",
      "artwork_id",
      "artwork_id",
      "tag_id",
    ]);
  });
});
