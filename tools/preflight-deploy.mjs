import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const requiredEnvKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_VISION_MODEL",
  "OPENAI_TRANSCRIPTION_MODEL",
];

function readEnvFile() {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) {
    return {};
  }
  return Object.fromEntries(
    readFileSync(envPath, "utf8")
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

function validateMigrationSequence() {
  const files = readdirSync(resolve("supabase", "migrations"))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  files.forEach((file, index) => {
    const expected = String(index + 1).padStart(4, "0");
    if (!file.startsWith(`${expected}_`)) {
      throw new Error(`迁移编号断档：期望 ${expected}_*.sql，实际为 ${file}`);
    }
  });
  return files;
}

const fileEnv = readEnvFile();
const missingKeys = requiredEnvKeys.filter((key) => {
  const value = process.env[key] || fileEnv[key];
  return !value || /^<.+>$/.test(value);
});
if (missingKeys.length > 0) {
  throw new Error(`缺少部署环境变量：${missingKeys.join(", ")}`);
}

const migrationFiles = validateMigrationSequence();
console.log(`Migrations ready: ${migrationFiles.length} files (${migrationFiles.at(-1) ?? "none"}).`);

const dockerCheck = spawnSync("docker", ["info"], { stdio: "ignore" });
if (dockerCheck.status === 0) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const status = spawnSync(npm, ["exec", "--", "supabase", "status"], {
    encoding: "utf8",
  });
  if (status.status === 0) {
    console.log("Local Supabase status available.");
  } else {
    console.log("Local Supabase not running; run npm run local:bootstrap before final deployment checks.");
  }
} else {
  console.log("Docker unavailable; skipped local Supabase runtime status check.");
}

console.log("Preflight passed. No secrets were printed.");
