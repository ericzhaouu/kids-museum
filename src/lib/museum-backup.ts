import { Archiver, ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";

export const BACKUP_EXPORT_VERSION = 2;
export const BACKUP_MAX_BYTES = 256 * 1024 * 1024;

export type BackupMuseumProfile = {
  id: string;
  name: string;
  artist_nickname: string;
  theme_id: string;
  theme_version: number;
  created_at: string;
  updated_at: string;
};

export type BackupArtwork = {
  id: string;
  museum_id: string;
  title: string;
  description: string;
  status: string;
  created_on: string | null;
  age_label: string;
  medium: string;
  source_version: number;
  created_at: string;
  updated_at: string;
};

export type BackupArtworkAsset = {
  artwork_id: string;
  kind: "original" | "display" | "thumbnail" | "audio";
  storage_path: string;
  relative_path: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string;
};

export type BackupArtworkTag = {
  artwork_id: string;
  tag: {
    id: string;
    museum_id: string;
    name: string;
  } | null;
};

export type BackupTagCatalogEntry = NonNullable<BackupArtworkTag["tag"]>;

export type BackupPayload = {
  manifest: {
    exportVersion: number;
    exportedAt: string;
    museumId: string;
    containsPrivateContent: true;
    totalRegisteredMediaBytes: number;
    files: string[];
    media: {
      bucket: "museum-private";
      count: number;
    };
  };
  museum: BackupMuseumProfile;
  artworks: BackupArtwork[];
  artworkAssets: BackupArtworkAsset[];
  artworkNotes: Array<Record<string, unknown>>;
  tags: Array<{
    catalog: BackupTagCatalogEntry[];
    links: BackupArtworkTag[];
  }>;
  exhibitions: Array<Record<string, unknown>>;
  invitations: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
};

export const BACKUP_PAGINATION_ORDER = {
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
} as const;

type OrderableQuery<T> = {
  order(column: string, options: { ascending: boolean }): T;
};

export function applyStableAscendingOrder<T extends OrderableQuery<T>>(
  query: T,
  columns: readonly string[],
) {
  let orderedQuery = query;
  for (const column of columns) {
    orderedQuery = orderedQuery.order(column, { ascending: true });
  }
  return orderedQuery;
}

export function serializeBackupArtworkTag(input: {
  artwork_id: string;
  tags:
    | {
        id: string;
        museum_id: string;
        name: string;
      }
    | Array<{
        id: string;
        museum_id: string;
        name: string;
      } | null>
    | null;
  tag_id?: string;
}) {
  const tag = Array.isArray(input.tags) ? input.tags[0] ?? null : input.tags;
  return {
    artwork_id: input.artwork_id,
    tag: tag ? { ...tag } : null,
  } satisfies BackupArtworkTag;
}

export function toBackupRelativeMediaPath(storagePath: string) {
  const normalized = storagePath.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("备份媒体路径无效。");
  }
  return `media/${normalized}`;
}

export function sanitizeBackupPayload(payload: BackupPayload) {
  const json = JSON.stringify(payload);
  if (/token_hash|session_hash|signedUrl|signature/i.test(json)) {
    throw new Error("备份内容包含不允许导出的访问凭证字段。");
  }
  return payload;
}

export function createBackupJsonFiles(payload: BackupPayload) {
  const sanitized = sanitizeBackupPayload(payload);
  return [
    {
      path: "backup/manifest.v2.json",
      body: JSON.stringify(sanitized.manifest, null, 2),
    },
    {
      path: "backup/museum.v2.json",
      body: JSON.stringify(
        {
          exportVersion: BACKUP_EXPORT_VERSION,
          museum: sanitized.museum,
        },
        null,
        2,
      ),
    },
    {
      path: "backup/artworks.v2.json",
      body: JSON.stringify(
        {
          exportVersion: BACKUP_EXPORT_VERSION,
          artworks: sanitized.artworks,
          assets: sanitized.artworkAssets,
          notes: sanitized.artworkNotes,
          tags: sanitized.tags,
        },
        null,
        2,
      ),
    },
    {
      path: "backup/exhibitions.v2.json",
      body: JSON.stringify(
        {
          exportVersion: BACKUP_EXPORT_VERSION,
          exhibitions: sanitized.exhibitions,
        },
        null,
        2,
      ),
    },
    {
      path: "backup/invitations.v2.json",
      body: JSON.stringify(
        {
          exportVersion: BACKUP_EXPORT_VERSION,
          invitations: sanitized.invitations,
        },
        null,
        2,
      ),
    },
    {
      path: "backup/audit-events.v2.json",
      body: JSON.stringify(
        {
          exportVersion: BACKUP_EXPORT_VERSION,
          auditEvents: sanitized.auditEvents,
        },
        null,
        2,
      ),
    },
  ];
}

export function createZipResponseStream(
  populate: (archive: Archiver) => Promise<void>,
) {
  const output = new PassThrough();
  const archive = new ZipArchive({
    zlib: { level: 9 },
  });
  const completion = (async () => {
    archive.on("warning", (error: Error & { code?: string }) => {
      if (error.code !== "ENOENT") {
        output.destroy(error);
      }
    });
    archive.on("error", (error: Error) => {
      output.destroy(error);
    });
    archive.pipe(output);
    try {
      await populate(archive);
      await archive.finalize();
    } catch (error) {
      archive.abort();
      output.destroy(
        error instanceof Error ? error : new Error("备份流生成失败。"),
      );
      throw error;
    }
  })();
  return {
    stream: Readable.toWeb(output) as ReadableStream<Uint8Array>,
    completion,
  };
}
