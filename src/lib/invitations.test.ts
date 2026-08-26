import { describe, expect, it } from "vitest";
import {
  createInvitationToken,
  hashInvitationToken,
} from "@/lib/invitations";

describe("invitation tokens", () => {
  it("creates URL-safe tokens with enough entropy", () => {
    const token = createInvitationToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createInvitationToken()).not.toBe(token);
  });

  it("stores only a deterministic SHA-256 hash", async () => {
    const token = createInvitationToken();

    const firstHash = await hashInvitationToken(token);
    const secondHash = await hashInvitationToken(token);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toBe(token);
    expect(firstHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects empty tokens", async () => {
    await expect(hashInvitationToken("")).rejects.toThrow("邀请令牌不能为空");
  });
});
