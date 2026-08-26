import { describe, expect, it } from "vitest";
import {
  getInvitationState,
  serializeInvitation,
  type InvitationRow,
} from "@/app/api/invitations/invitation-state";

const NOW = new Date("2026-04-01T12:00:00.000Z");
const invitation: InvitationRow = {
  id: "invite-1",
  label: "爷爷奶奶",
  created_at: "2026-03-30T12:00:00.000Z",
  expires_at: "2026-04-08T12:00:00.000Z",
  revoked_at: null,
};

describe("invitation state helpers", () => {
  it("distinguishes active, expired, and revoked invitations", () => {
    expect(getInvitationState(invitation, NOW)).toBe("active");
    expect(
      getInvitationState(
        { ...invitation, expires_at: "2026-04-01T11:59:59.000Z" },
        NOW,
      ),
    ).toBe("expired");
    expect(
      getInvitationState(
        { ...invitation, revoked_at: "2026-04-01T10:00:00.000Z" },
        NOW,
      ),
    ).toBe("revoked");
  });

  it("reports real visitor-session counts and latest activity", () => {
    expect(
      serializeInvitation(
        invitation,
        [
          {
            id: "session-1",
            invitation_id: invitation.id,
            expires_at: "2026-04-02T12:00:00.000Z",
            revoked_at: null,
            last_seen_at: "2026-03-31T12:00:00.000Z",
          },
          {
            id: "session-2",
            invitation_id: invitation.id,
            expires_at: "2026-03-31T12:00:00.000Z",
            revoked_at: null,
            last_seen_at: "2026-04-01T10:00:00.000Z",
          },
        ],
        NOW,
      ),
    ).toMatchObject({
      visitorSessionCount: 2,
      activeVisitorSessionCount: 1,
      latestVisitAt: "2026-04-01T10:00:00.000Z",
    });
  });
});
