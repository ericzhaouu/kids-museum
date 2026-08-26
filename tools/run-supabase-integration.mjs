import { spawnSync } from "node:child_process";
import { ensureLocalSupabaseReady } from "./bootstrap-local.mjs";

const setup = ensureLocalSupabaseReady({ skipOnMissingDocker: !process.env.CI });
if (setup.skipped) {
  console.log(`SKIPPED: ${setup.reason}`);
  process.exit(0);
}

const npmCli = process.env.npm_execpath;
const npmCommand = npmCli
  ? process.execPath
  : process.platform === "win32"
    ? "npm.cmd"
    : "npm";
const npmArgs = npmCli
  ? [npmCli, "exec", "--", "vitest", "run", "--config", "vitest.integration.config.ts"]
  : ["exec", "--", "vitest", "run", "--config", "vitest.integration.config.ts"];
const result = spawnSync(
  npmCommand,
  npmArgs,
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: setup.apiUrl,
      SUPABASE_URL: setup.apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: setup.anonKey,
      SUPABASE_ANON_KEY: setup.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: setup.serviceRoleKey,
    },
  },
);
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
