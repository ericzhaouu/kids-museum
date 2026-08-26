import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const isWindows = process.platform === "win32";
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);
const browserUse = isWindows
  ? {
      ...devices["Desktop Chrome"],
      channel: "msedge" as const,
    }
  : {
      ...devices["Desktop Chrome"],
    };

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: isWindows
      ? `npm.cmd exec -- next dev --webpack --hostname 127.0.0.1 --port ${port}`
      : `npm exec -- next dev --webpack --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    env:
      process.env.PLAYWRIGHT_MODE === "supabase"
        ? inheritedEnvironment
        : {
            ...inheritedEnvironment,
            KIDS_MUSEUM_FORCE_PREVIEW: "1",
          },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "preview",
      grepInvert: /@supabase/,
      use: browserUse,
    },
    {
      name: "supabase",
      grep: /@supabase/,
      use: browserUse,
    },
  ],
});
