import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const localEmail = "curator@kids-museum.local";
const localPassword = "MuseumLocal123!";
const artworkId = "00000000-0000-4000-8000-000000000101";
const noteId = "00000000-0000-4000-8000-000000000102";
const tagId = "00000000-0000-4000-8000-000000000103";

function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) {
          return [];
        }
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
      .filter((entry) => entry.length === 2),
  );
}

function readSupabaseStatus() {
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", "npm.cmd exec -- supabase status -o env"],
          { encoding: "utf8", windowsHide: true },
        )
      : spawnSync("npm", ["exec", "--", "supabase", "status", "-o", "env"], {
          encoding: "utf8",
        });

  if (result.status !== 0) {
    return {};
  }

  return Object.fromEntries(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => {
        const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
        if (!match) {
          return [];
        }
        let value = match[2].trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        return [match[1], value];
      })
      .filter((entry) => entry.length === 2),
  );
}

function firstNonEmpty(...values) {
  return (
    values.find(
      (value) => typeof value === "string" && value.trim().length > 0,
    )?.trim() ?? ""
  );
}

const fileEnv = readEnvFile(resolve(".env.local"));
const configuredApiUrl = firstNonEmpty(
  process.env.LOCAL_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  fileEnv.NEXT_PUBLIC_SUPABASE_URL,
);
const configuredServiceRoleKey = firstNonEmpty(
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  fileEnv.SUPABASE_SERVICE_ROLE_KEY,
);
const hasConfiguredServiceRoleKey =
  configuredServiceRoleKey && !configuredServiceRoleKey.startsWith("<");
const statusEnv =
  configuredApiUrl && hasConfiguredServiceRoleKey
    ? {}
    : readSupabaseStatus();
const apiUrl = firstNonEmpty(configuredApiUrl, statusEnv.API_URL).replace(/\/$/, "");
const serviceRoleKey = hasConfiguredServiceRoleKey
  ? configuredServiceRoleKey
  : firstNonEmpty(statusEnv.SERVICE_ROLE_KEY, statusEnv.SECRET_KEY);

let parsedApiUrl;
try {
  parsedApiUrl = new URL(apiUrl);
} catch {
  throw new Error(
    "Local Supabase status is unavailable. Start Supabase or run npm.cmd run local:bootstrap first.",
  );
}
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(parsedApiUrl.hostname) ||
  parsedApiUrl.port !== "54321"
) {
  throw new Error(
    "Refusing to provision data outside the local Supabase API on loopback port 54321.",
  );
}
if (!serviceRoleKey || serviceRoleKey.startsWith("<")) {
  throw new Error(
    "Local service-role key is missing. Run npm.cmd run local:bootstrap first.",
  );
}

async function request(path, { method = "GET", body, prefer } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${method} ${path} failed (${response.status}): ${detail}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const userPage = await request("/auth/v1/admin/users?page=1&per_page=1000");
let user = userPage.users?.find(
  (candidate) => candidate.email?.toLowerCase() === localEmail,
);

if (!user) {
  user = await request("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email: localEmail,
      password: localPassword,
      email_confirm: true,
      user_metadata: { display_name: "Local Curator", synthetic: true },
    },
  });
} else {
  user = await request(`/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    body: {
      password: localPassword,
      email_confirm: true,
      user_metadata: { display_name: "Local Curator", synthetic: true },
    },
  });
}

const profiles = await request(
  `/rest/v1/museum_profiles?owner_id=eq.${user.id}&select=id`,
);
const museumId = profiles[0]?.id;
if (!museumId) {
  throw new Error("The new-user trigger did not create a local museum profile.");
}

await request(`/rest/v1/museum_profiles?owner_id=eq.${user.id}`, {
  method: "PATCH",
  body: {
    name: "本地开发博物馆",
    artist_nickname: "本地馆长",
    theme_id: "warm-gallery",
  },
});

await request("/rest/v1/artworks?on_conflict=id", {
  method: "POST",
  prefer: "resolution=merge-duplicates,return=minimal",
  body: {
    id: artworkId,
    museum_id: museumId,
    title: "本地测试：颜色旅行",
    description: "完全虚构、无真实儿童信息的本地开发占位作品。",
    status: "draft",
    created_on: "2024-01-01",
    age_label: "本地占位",
    medium: "数字占位内容",
    source_version: 1,
  },
});

await request("/rest/v1/artwork_notes?on_conflict=id", {
  method: "POST",
  prefer: "resolution=merge-duplicates,return=minimal",
  body: {
    id: noteId,
    artwork_id: artworkId,
    source: "parent",
    content: "这是仅用于本地开发的虚构作品记录。",
    is_ai_input: false,
  },
});

await request("/rest/v1/tags?on_conflict=id", {
  method: "POST",
  prefer: "resolution=merge-duplicates,return=minimal",
  body: {
    id: tagId,
    museum_id: museumId,
    name: "本地测试",
  },
});

await request("/rest/v1/artwork_tags?on_conflict=artwork_id,tag_id", {
  method: "POST",
  prefer: "resolution=ignore-duplicates,return=minimal",
  body: { artwork_id: artworkId, tag_id: tagId },
});

console.log(`Local resources ready for ${localEmail}.`);
