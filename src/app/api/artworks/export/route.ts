import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  BACKUP_EXPORT_VERSION,
  BACKUP_MAX_BYTES,
  createBackupJsonFiles,
  createZipResponseStream,
  toBackupRelativeMediaPath,
  type BackupArtworkAsset,
} from "@/lib/museum-backup";

export const runtime = "nodejs";

const recordArraySchema = z.array(z.record(z.string(), z.unknown()));
const tagSchema = z.object({
  id: z.string().uuid(),
  museum_id: z.string().uuid(),
  name: z.string(),
});
const backupSnapshotSchema = z.object({
  museum: z.object({
    id: z.string().uuid(),
    name: z.string(),
    artist_nickname: z.string(),
    theme_id: z.string(),
    theme_version: z.number().int().positive(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  artworks: z.array(
    z.object({
      id: z.string().uuid(),
      museum_id: z.string().uuid(),
      title: z.string(),
      description: z.string(),
      status: z.string(),
      created_on: z.string().nullable(),
      age_label: z.string(),
      medium: z.string(),
      source_version: z.number().int().positive(),
      created_at: z.string(),
      updated_at: z.string(),
    }),
  ),
  artworkAssets: z.array(
    z.object({
      artwork_id: z.string().uuid(),
      kind: z.enum(["original", "display", "thumbnail", "audio"]),
      storage_path: z.string(),
      mime_type: z.string(),
      byte_size: z.number().nonnegative(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      duration_seconds: z.number().nullable(),
      created_at: z.string(),
    }),
  ),
  artworkNotes: recordArraySchema,
  tagCatalog: z.array(tagSchema),
  artworkTags: z.array(
    z.object({
      artwork_id: z.string().uuid(),
      tag_id: z.string().uuid(),
      tag: tagSchema,
    }),
  ),
  aiSuggestions: recordArraySchema,
  exhibitions: recordArraySchema,
  rooms: recordArraySchema,
  placements: recordArraySchema,
  exhibitionSuggestions: recordArraySchema,
  invitations: recordArraySchema,
  visitorSessions: recordArraySchema,
  auditEvents: recordArraySchema,
});

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "Supabase 尚未配置，无法导出私密数据。" },
      { status: 503 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
  }

  try {
    const { data, error } = await supabase.rpc(
      "export_museum_backup_metadata",
    );
    if (error) {
      if (error.message.includes("MUSEUM_NOT_FOUND")) {
        return NextResponse.json(
          { error: "当前账号尚未初始化博物馆，请先创建新的馆藏空间。" },
          { status: 409 },
        );
      }
      throw new Error(`备份快照读取失败：${error.message}`);
    }
    const snapshot = backupSnapshotSchema.parse(data);
    const sanitizedAssets = snapshot.artworkAssets.map<BackupArtworkAsset>(
      (asset) => ({
        ...asset,
        relative_path: toBackupRelativeMediaPath(asset.storage_path),
      }),
    );
    const totalRegisteredMediaBytes = sanitizedAssets.reduce(
      (total, asset) => total + asset.byte_size,
      0,
    );
    if (totalRegisteredMediaBytes > BACKUP_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `备份包登记媒体共 ${Math.ceil(totalRegisteredMediaBytes / 1024 / 1024)} MB，超过 ${Math.ceil(BACKUP_MAX_BYTES / 1024 / 1024)} MB 上限，请先精简馆藏媒体后再导出。`,
        },
        { status: 413 },
      );
    }

    const payload = {
      manifest: {
        exportVersion: BACKUP_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        museumId: snapshot.museum.id,
        containsPrivateContent: true as const,
        totalRegisteredMediaBytes,
        files: [
          "backup/manifest.v2.json",
          "backup/museum.v2.json",
          "backup/artworks.v2.json",
          "backup/exhibitions.v2.json",
          "backup/invitations.v2.json",
          "backup/audit-events.v2.json",
          ...sanitizedAssets.map((asset) => asset.relative_path),
        ],
        media: {
          bucket: "museum-private" as const,
          count: sanitizedAssets.length,
        },
      },
      museum: snapshot.museum,
      artworks: snapshot.artworks,
      artworkAssets: sanitizedAssets,
      artworkNotes: snapshot.artworkNotes,
      tags: [
        {
          catalog: snapshot.tagCatalog,
          links: snapshot.artworkTags.map((link) => ({
            artwork_id: link.artwork_id,
            tag: link.tag,
          })),
        },
      ],
      exhibitions: [
        {
          items: snapshot.exhibitions,
          rooms: snapshot.rooms,
          placements: snapshot.placements,
          aiSuggestions: snapshot.exhibitionSuggestions,
        },
      ],
      invitations: [
        {
          exportVersion: BACKUP_EXPORT_VERSION,
          invitations: snapshot.invitations,
          visitorSessions: snapshot.visitorSessions,
        },
      ],
      auditEvents: [
        ...snapshot.auditEvents,
        {
          exportVersion: BACKUP_EXPORT_VERSION,
          artworkAiSuggestions: snapshot.aiSuggestions,
        },
      ],
    };

    const admin = createAdminSupabaseClient();
    const { stream, completion } = createZipResponseStream(async (archive) => {
      for (const file of createBackupJsonFiles(payload)) {
        archive.append(file.body, { name: file.path });
      }

      for (const asset of sanitizedAssets) {
        const { data: fileBlob, error: downloadError } = await admin.storage
          .from("museum-private")
          .download(asset.storage_path);
        if (downloadError || !fileBlob) {
          throw new Error(
            `私密媒体下载失败：${asset.storage_path}：${downloadError?.message ?? "未知错误"}`,
          );
        }
        archive.append(Buffer.from(await fileBlob.arrayBuffer()), {
          name: asset.relative_path,
        });
      }
    });
    void completion.catch(() => undefined);
    const date = new Date().toISOString().slice(0, 10);

    return new Response(stream, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="kids-museum-backup-${date}.zip"`,
        "Content-Type": "application/zip",
        "X-Backup-Contains-Private-Content": "true",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "数据导出失败。" },
      { status: 500 },
    );
  }
}
