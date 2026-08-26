export type InvitationState = "active" | "expired" | "revoked";

export type InvitationRow = {
  id: string;
  label: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type VisitorSessionRow = {
  id: string;
  invitation_id: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string;
};

export function getInvitationState(
  invitation: Pick<InvitationRow, "expires_at" | "revoked_at">,
  now = new Date(),
): InvitationState {
  if (invitation.revoked_at) {
    return "revoked";
  }
  return new Date(invitation.expires_at) <= now ? "expired" : "active";
}

export function serializeInvitation(
  invitation: InvitationRow,
  sessions: VisitorSessionRow[],
  now = new Date(),
) {
  const invitationSessions = sessions.filter(
    (session) => session.invitation_id === invitation.id,
  );
  const latestVisitAt = invitationSessions.reduce<string | null>(
    (latest, session) =>
      !latest || new Date(session.last_seen_at) > new Date(latest)
        ? session.last_seen_at
        : latest,
    null,
  );

  return {
    id: invitation.id,
    label: invitation.label,
    createdAt: invitation.created_at,
    expiresAt: invitation.expires_at,
    revokedAt: invitation.revoked_at,
    status: getInvitationState(invitation, now),
    visitorSessionCount: invitationSessions.length,
    activeVisitorSessionCount: invitationSessions.filter(
      (session) =>
        !session.revoked_at && new Date(session.expires_at) > now,
    ).length,
    latestVisitAt,
  };
}
