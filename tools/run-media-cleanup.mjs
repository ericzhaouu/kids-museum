import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readEnvFile() {
  const path = resolve(".env.local");
  if (!existsSync(path)) {
    return {};
  }
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return index < 1 ? [] : [line.slice(0, index), line.slice(index + 1)];
      })
      .filter((entry) => entry.length === 2),
  );
}

const fileEnv = readEnvFile();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const DELETE_BATCH_SIZE = 1000;
const { error: sessionCleanupError } = await admin.rpc(
  "queue_expired_media_upload_session_cleanups",
  {
    p_limit: 50,
  },
);
if (sessionCleanupError) {
  throw new Error(`上传会话清理队列读取失败：${sessionCleanupError.message}`);
}
const { data: jobs, error } = await admin
  .rpc("claim_media_cleanup_jobs", {
    p_limit: 50,
    p_lease_seconds: 300,
  });
if (error) {
  throw new Error(`媒体清理队列读取失败：${error.message}`);
}

let completed = 0;
let failed = 0;
for (const job of jobs ?? []) {
  try {
    if ((job.object_paths ?? []).length > 0) {
      for (let index = 0; index < job.object_paths.length; index += DELETE_BATCH_SIZE) {
        const batch = job.object_paths.slice(index, index + DELETE_BATCH_SIZE);
        const { error: storageError } = await admin.storage
          .from(job.bucket_id)
          .remove(batch);
        if (storageError) {
          throw new Error(storageError.message);
        }
      }
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
  } catch (cleanupError) {
    const message =
      cleanupError instanceof Error ? cleanupError.message : "未知媒体清理错误。";
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

console.log(`Processed ${jobs?.length ?? 0} cleanup jobs (${completed} completed, ${failed} failed).`);
