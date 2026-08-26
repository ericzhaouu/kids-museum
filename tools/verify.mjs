import { spawnSync } from "node:child_process";

const steps = [
  ["lint", ["run", "lint"]],
  ["typecheck", ["run", "typecheck"]],
  ["unit", ["run", "test:unit"]],
  ["integration", ["run", "test:integration"]],
  ["e2e-preview", ["run", "e2e:preview"]],
  ["e2e-supabase", ["run", "e2e:supabase"]],
  ["build", ["run", "build"]],
];

const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";

for (const [label, args] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(npmCommand, npmCli ? [npmCli, ...args] : args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
