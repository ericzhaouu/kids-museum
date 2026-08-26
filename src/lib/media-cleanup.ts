import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const cleanupJobSchema = z.object({
  id: z.string().uuid(),
  museum_id: z.string().uuid(),
  tombstone_museum_id: z.string().uuid().nullable(),
  bucket_id: z.string(),
  object_paths: z.array(z.string()).default([]),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  attempt_count: z.number().int().nonnegative(),
});

const STORAGE_DELETE_BATCH_SIZE = 1000;

export type CleanupProcessingResult = {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
};

export async function deleteObjectPathsInBatches(
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>,
  objectPaths: string[],
  batchSize = STORAGE_DELETE_BATCH_SIZE,
) {
  for (let index = 0; index < objectPaths.length; index += batchSize) {
    const batch = objectPaths.slice(index, index + batchSize);
    const { error } = await remove(batch);
    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function processPendingMediaCleanupJobs(
  limit = 20,
): Promise<CleanupProcessingResult> {
  const admin = createAdminSupabaseClient();
  const { error: sessionCleanupError } = await admin.rpc(
    "queue_expired_media_upload_session_cleanups",
    {
      p_limit: limit,
    },
  );
  if (sessionCleanupError) {
    throw new Error(`上传会话清理队列读取失败：${sessionCleanupError.message}`);
  }

  const { data, error } = await admin
    .rpc("claim_media_cleanup_jobs", {
      p_limit: limit,
      p_lease_seconds: 300,
    });
  if (error) {
    throw new Error(`媒体清理队列读取失败：${error.message}`);
  }

  const jobs = z.array(cleanupJobSchema).parse(data ?? []);
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      if (job.object_paths.length > 0) {
        await deleteObjectPathsInBatches(
          async (paths) =>
            admin.storage
              .from(job.bucket_id)
              .remove(paths)
              .then(({ error: storageError }) => ({ error: storageError })),
          job.object_paths,
        );
      }

      await admin
        .from("media_cleanup_jobs")
        .update({
          status: "completed",
          last_error: null,
          last_processed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (job.tombstone_museum_id) {
        await admin
          .from("museum_tombstones")
          .update({
            cleanup_status: "completed",
            last_error: null,
            last_processed_at: new Date().toISOString(),
          })
          .eq("museum_id", job.tombstone_museum_id);
      }
      completed += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "未知媒体清理错误。";
      await admin
        .from("media_cleanup_jobs")
        .update({
          status: "failed",
          last_error: message,
          last_processed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (job.tombstone_museum_id) {
        await admin
          .from("museum_tombstones")
          .update({
            cleanup_status: "failed",
            last_error: message,
            last_processed_at: new Date().toISOString(),
          })
          .eq("museum_id", job.tombstone_museum_id);
      }
      failed += 1;
    }
  }

  return {
    processed: jobs.length,
    completed,
    failed,
    skipped: Math.max(limit - jobs.length, 0),
  };
}
