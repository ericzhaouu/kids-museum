import { z } from "zod";

const RATE_LIMIT_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

const requestSchema = z
  .object({
    artworkId: z.string().uuid(),
  })
  .strict();

const suggestionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  tags: z.array(z.string().trim().min(1).max(20)).min(1).max(5),
});

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
};

const aiRateLimits = new Map<string, RateLimitEntry>();

export function parseSuggestionRequest(input: unknown) {
  return requestSchema.safeParse(input);
}

export function parseProviderSuggestion(input: string) {
  try {
    return suggestionSchema.safeParse(
      JSON.parse(input.replace(/^```json\s*|\s*```$/g, "")),
    );
  } catch {
    return suggestionSchema.safeParse(undefined);
  }
}

export function consumeAiRateLimit(
  key: string,
  now = Date.now(),
  entries: Map<string, RateLimitEntry> = aiRateLimits,
) {
  const existing = entries.get(key);
  if (!existing || now - existing.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    entries.set(key, { count: 1, windowStartedAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= RATE_LIMIT_REQUESTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (RATE_LIMIT_WINDOW_MS - (now - existing.windowStartedAt)) / 1000,
        ),
      ),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
