import { describe, expect, it } from "vitest";
import {
  getAiTranscriptionConfig,
  getAiVisionConfig,
  getSupabaseAdminConfig,
  getSupabaseServerConfig,
} from "@/lib/server-env";
import {
  EnvConfigError,
  getSupabaseConfig,
  hasSupabaseConfig,
  resolvePublicSupabaseConfig,
} from "@/lib/supabase/config";

const ENV: Record<string, string | undefined> = {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon.signature",
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service.signature",
  OPENAI_API_KEY: "local-mock-only",
  OPENAI_BASE_URL: "http://127.0.0.1:4010/v1",
  OPENAI_VISION_MODEL: "kids-museum-local-mock",
  OPENAI_TRANSCRIPTION_MODEL: "kids-museum-transcribe-mock",
};

describe("Supabase env validation", () => {
  it("allows local preview when all public variables are absent", () => {
    expect(resolvePublicSupabaseConfig({})).toEqual({ enabled: false });
    expect(hasSupabaseConfig({})).toBe(false);
  });

  it("allows test runners to force isolated preview mode", () => {
    expect(
      resolvePublicSupabaseConfig({
        ...ENV,
        KIDS_MUSEUM_FORCE_PREVIEW: "1",
      }),
    ).toEqual({ enabled: false });
  });

  it("rejects half-configured public env", () => {
    expect(() =>
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ).toThrow(EnvConfigError);
  });

  it("validates URL and anon key shape", () => {
    expect(() =>
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "notaurl",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }),
    ).toThrow("URL");
    expect(() =>
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "short",
      }),
    ).toThrow("Supabase key");
  });

  it("returns normalized public config when fully configured", () => {
    expect(getSupabaseConfig(ENV)).toEqual({
      enabled: true,
      url: ENV.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  });
});

describe("server-only env validation", () => {
  it("validates service role key without exposing it to client callers", () => {
    expect(getSupabaseAdminConfig(ENV)).toEqual({
      url: ENV.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: ENV.SUPABASE_SERVICE_ROLE_KEY,
    });
    expect(() =>
      getSupabaseAdminConfig({
        NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: "bad",
      }),
    ).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("uses a private container URL only for server-side Supabase clients", () => {
    const containerEnv = {
      ...ENV,
      SUPABASE_INTERNAL_URL: "http://host.docker.internal:54321",
    };
    expect(getSupabaseServerConfig(containerEnv)).toEqual({
      enabled: true,
      url: "http://host.docker.internal:54321",
      anonKey: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    expect(getSupabaseAdminConfig(containerEnv)).toEqual({
      url: "http://host.docker.internal:54321",
      serviceRoleKey: ENV.SUPABASE_SERVICE_ROLE_KEY,
    });
  });

  it("validates AI vision and transcription settings", () => {
    expect(getAiVisionConfig(ENV)).toEqual({
      apiKey: ENV.OPENAI_API_KEY,
      baseUrl: ENV.OPENAI_BASE_URL,
      model: ENV.OPENAI_VISION_MODEL,
    });
    expect(getAiTranscriptionConfig(ENV)).toEqual({
      apiKey: ENV.OPENAI_API_KEY,
      baseUrl: ENV.OPENAI_BASE_URL,
      model: ENV.OPENAI_TRANSCRIPTION_MODEL,
    });
  });

  it("requires an API key for server-side AI features", () => {
    expect(() => getAiVisionConfig({})).toThrow("OPENAI_API_KEY");
  });
});
