import { z } from "zod";

const urlSchema = z
  .url("NEXT_PUBLIC_SUPABASE_URL 必须是有效的 http(s) URL。")
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "NEXT_PUBLIC_SUPABASE_URL 必须使用 http:// 或 https://。",
  );

const supabaseKeySchema = z
  .string()
  .trim()
  .min(20, "Supabase key 不能为空。")
  .refine(
    (value) =>
      /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(value) ||
      value.startsWith("sb_"),
    "Supabase key 格式无效，请提供真实的 anon / publishable key。",
  );

export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigError";
  }
}

export type PublicSupabaseConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      url: string;
      anonKey: string;
    };

type EnvironmentMap = Record<string, string | undefined>;

export function resolvePublicSupabaseConfig(
  environment: EnvironmentMap = process.env,
): PublicSupabaseConfig {
  if (environment.KIDS_MUSEUM_FORCE_PREVIEW === "1") {
    return { enabled: false };
  }

  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

  if (!url && !anonKey) {
    return { enabled: false };
  }

  const missing = [
    !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !anonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
  ].filter((value): value is string => value !== null);
  if (missing.length > 0) {
    throw new EnvConfigError(
      `Supabase 环境变量配置不完整：缺少 ${missing.join("、")}。要么全部留空以启用本地预览，要么完整提供 URL 与 anon key。`,
    );
  }

  const parsed = z
    .object({
      url: urlSchema,
      anonKey: supabaseKeySchema,
    })
    .safeParse({ url, anonKey });
  if (!parsed.success) {
    throw new EnvConfigError(parsed.error.issues[0]?.message ?? "Supabase 配置无效。");
  }

  return {
    enabled: true,
    url: parsed.data.url,
    anonKey: parsed.data.anonKey,
  };
}

export function hasSupabaseConfig(
  environment: EnvironmentMap = process.env,
): boolean {
  return resolvePublicSupabaseConfig(environment).enabled;
}

export function getSupabaseConfig(
  environment: EnvironmentMap = process.env,
) {
  const config = resolvePublicSupabaseConfig(environment);
  if (!config.enabled) {
    throw new EnvConfigError(
      "Supabase 尚未配置。请设置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY，或全部留空以启用本地预览。",
    );
  }
  return config;
}

export function getBrowserSupabaseConfig() {
  return getSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function isSupabaseKeyLike(value: string) {
  return supabaseKeySchema.safeParse(value).success;
}
