import { z } from "zod";
import {
  EnvConfigError,
  getSupabaseConfig,
  isSupabaseKeyLike,
} from "@/lib/supabase/config";

const serverKeySchema = z
  .string()
  .trim()
  .min(20, "SUPABASE_SERVICE_ROLE_KEY 不能为空。")
  .refine(
    (value) => isSupabaseKeyLike(value),
    "SUPABASE_SERVICE_ROLE_KEY 格式无效，请提供真实的 service role key。",
  );

const aiBaseUrlSchema = z
  .url("OPENAI_BASE_URL 必须是有效的 URL。")
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "OPENAI_BASE_URL 必须使用 http:// 或 https://。",
  );

const aiModelSchema = z
  .string()
  .trim()
  .min(1, "AI 模型名称不能为空。");

const transcriptionModelSchema = z
  .string()
  .trim()
  .min(1, "转写模型名称不能为空。");

export function getSupabaseAdminConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  const { url } = getSupabaseServerConfig(environment);
  const parsed = serverKeySchema.safeParse(
    environment.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
  );
  if (!parsed.success) {
    throw new EnvConfigError(
      parsed.error.issues[0]?.message ??
        "服务端缺少 SUPABASE_SERVICE_ROLE_KEY。",
    );
  }

  return {
    url,
    serviceRoleKey: parsed.data,
  };
}

export function getSupabaseServerConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  const publicConfig = getSupabaseConfig(environment);
  const internalUrl = environment.SUPABASE_INTERNAL_URL?.trim();
  if (!internalUrl) {
    return publicConfig;
  }

  const parsed = aiBaseUrlSchema.safeParse(internalUrl);
  if (!parsed.success) {
    throw new EnvConfigError(
      parsed.error.issues[0]?.message ?? "SUPABASE_INTERNAL_URL 配置无效。",
    );
  }
  return {
    ...publicConfig,
    url: parsed.data.replace(/\/$/, ""),
  };
}

export function getAiVisionConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new EnvConfigError(
      "AI 馆长助手尚未配置。请在服务端设置 OPENAI_API_KEY 后重试。",
    );
  }

  const baseUrl =
    environment.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const model = environment.OPENAI_VISION_MODEL?.trim() || "gpt-4.1-mini";
  const parsed = z
    .object({
      baseUrl: aiBaseUrlSchema,
      model: aiModelSchema,
    })
    .safeParse({ baseUrl, model });
  if (!parsed.success) {
    throw new EnvConfigError(parsed.error.issues[0]?.message ?? "AI 配置无效。");
  }

  return {
    apiKey,
    baseUrl: parsed.data.baseUrl.replace(/\/$/, ""),
    model: parsed.data.model,
  };
}

export function getAiTranscriptionConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  const visionConfig = getAiVisionConfig(environment);
  const model =
    environment.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe";
  const parsed = transcriptionModelSchema.safeParse(model);
  if (!parsed.success) {
    throw new EnvConfigError(
      parsed.error.issues[0]?.message ?? "转写模型配置无效。",
    );
  }

  return {
    ...visionConfig,
    model: parsed.data,
  };
}
