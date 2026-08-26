import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as visitInvitation } from "@/app/visit/[token]/route";
import {
  authorizeArtworkUploads,
  cleanupArtworkUploadSession,
  commitArtworkUpdate,
} from "@/lib/artworks/server";
import { processPendingMediaCleanupJobs } from "@/lib/media-cleanup";
import {
  attachArtworkAsset,
  createAdminClient,
  createCurator,
  createVisitInvitation,
  insertArtwork,
  uploadPrivateObject,
} from "../support/supabase-local";

let admin = createAdminClient();

function createSilentWav(seconds: number) {
  const sampleRate = 1;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

beforeAll(() => {
  admin = createAdminClient();
});

describe("local Supabase integration", () => {
  it("isolates curator data and private storage by museum", async () => {
    const curatorA = await createCurator("alpha");
    const curatorB = await createCurator("beta");

    const artworkA = await insertArtwork(admin, curatorA.museumId, { title: "Alpha artwork" });
    const artworkB = await insertArtwork(admin, curatorB.museumId, { title: "Beta artwork" });

    const pathA = `${curatorA.museumId}/${artworkA}/integration/display.webp`;
    const pathB = `${curatorB.museumId}/${artworkB}/integration/display.webp`;
    await uploadPrivateObject(admin, pathA, Uint8Array.from([1, 2, 3, 4]), "image/webp");
    await uploadPrivateObject(admin, pathB, Uint8Array.from([4, 3, 2, 1]), "image/webp");
    await attachArtworkAsset(admin, artworkA, "display", pathA);
    await attachArtworkAsset(admin, artworkB, "display", pathB);

    const { data: invisibleArtwork } = await curatorA.userClient
      .from("artworks")
      .select("id, title")
      .eq("id", artworkB)
      .maybeSingle();
    expect(invisibleArtwork).toBeNull();

    const { data: updateAttempt, error: updateError } = await curatorA.userClient
      .from("artworks")
      .update({ title: "hacked" })
      .eq("id", artworkB)
      .select("id, title");
    expect(updateError).toBeNull();
    expect(updateAttempt).toEqual([]);

    const { data: ownDownload, error: ownDownloadError } = await curatorA.userClient.storage
      .from("museum-private")
      .download(pathA);
    expect(ownDownloadError).toBeNull();
    expect(ownDownload).toBeTruthy();

    const { error: foreignDownloadError } = await curatorA.userClient.storage
      .from("museum-private")
      .download(pathB);
    expect(foreignDownloadError).toBeTruthy();
  });

  it("enforces valid, expired, and revoked invitation access", async () => {
    const curator = await createCurator("visit");
    const validInvite = await createVisitInvitation(admin, curator.museumId);

    const validResponse = await visitInvitation(
      new Request(`http://localhost:3000/visit/${validInvite.token}`),
      { params: Promise.resolve({ token: validInvite.token }) },
    );
    expect(validResponse.headers.get("location")).toBe("http://localhost:3000/");
    expect(validResponse.headers.get("set-cookie")).toContain("museum_visitor=");

    const expiredInvite = await createVisitInvitation(admin, curator.museumId, -1);
    const expiredResponse = await visitInvitation(
      new Request(`http://localhost:3000/visit/${expiredInvite.token}`),
      { params: Promise.resolve({ token: expiredInvite.token }) },
    );
    expect(expiredResponse.headers.get("location")).toContain("/login?invite=expired");

    const revokedInvite = await createVisitInvitation(admin, curator.museumId);
    await admin
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", revokedInvite.invitationId);
    const revokedResponse = await visitInvitation(
      new Request(`http://localhost:3000/visit/${revokedInvite.token}`),
      { params: Promise.resolve({ token: revokedInvite.token }) },
    );
    expect(revokedResponse.headers.get("location")).toContain("/login?invite=expired");
  });

  it("handles artwork AI review accept, repeated reject, and stale transitions", async () => {
    const curator = await createCurator("art-ai");
    const artworkId = await insertArtwork(admin, curator.museumId, {
      title: "Original artwork",
      source_version: 1,
    });

    const { data: acceptedSuggestion } = await admin
      .from("ai_suggestions")
      .insert({
        artwork_id: artworkId,
        suggestion_type: "title",
        input_version: 1,
        content: { value: "Accepted title" },
        status: "pending",
      })
      .select("id")
      .single();
    const { data: acceptedResult, error: acceptedError } = await curator.userClient.rpc(
      "review_ai_suggestion",
      {
        p_suggestion_id: acceptedSuggestion?.id,
        p_action: "accept",
      },
    );
    expect(acceptedError).toBeNull();
    expect(acceptedResult).toMatchObject({ status: "accepted" });

    const { data: updatedArtwork } = await admin
      .from("artworks")
      .select("title")
      .eq("id", artworkId)
      .single();
    expect(updatedArtwork?.title).toBe("Accepted title");

    const { data: rejectSuggestion } = await admin
      .from("ai_suggestions")
      .insert({
        artwork_id: artworkId,
        suggestion_type: "description",
        input_version: 1,
        content: { value: "Rejected description" },
        status: "pending",
      })
      .select("id")
      .single();
    const firstReject = await curator.userClient.rpc("review_ai_suggestion", {
      p_suggestion_id: rejectSuggestion?.id,
      p_action: "reject",
    });
    expect(firstReject.error).toBeNull();
    const secondReject = await curator.userClient.rpc("review_ai_suggestion", {
      p_suggestion_id: rejectSuggestion?.id,
      p_action: "reject",
    });
    expect(secondReject.error?.message).toContain("SUGGESTION_NOT_PENDING");

    const { data: staleSuggestion } = await admin
      .from("ai_suggestions")
      .insert({
        artwork_id: artworkId,
        suggestion_type: "title",
        input_version: 1,
        content: { value: "Stale title" },
        status: "pending",
      })
      .select("id")
      .single();
    await admin.from("artworks").update({ source_version: 2 }).eq("id", artworkId);
    const staleResult = await curator.userClient.rpc("review_ai_suggestion", {
      p_suggestion_id: staleSuggestion?.id,
      p_action: "accept",
    });
    expect(staleResult.error).toBeNull();
    expect(staleResult.data).toMatchObject({ status: "stale" });
  });

  it("validates exhibition publishing and keeps exhibition review atomic", async () => {
    const curator = await createCurator("exhibition");
    const artworkOne = await insertArtwork(admin, curator.museumId, { status: "published" });
    const artworkTwo = await insertArtwork(admin, curator.museumId, { status: "published" });

    const invalidPublish = await curator.userClient.rpc("save_exhibition_curation", {
      p_exhibition_id: null,
      p_title: "Bad exhibition",
      p_subtitle: "",
      p_introduction: "Need more rooms before publish.",
      p_status: "published",
      p_theme_id: "warm-gallery",
      p_rooms: [
        {
          name: "Only room",
          subtitle: "",
          introduction: "",
          artworks: [{ artworkId: artworkOne }],
        },
      ],
    });
    expect(invalidPublish.error?.message).toContain("PUBLISH_ROOM_MINIMUM");

    const draftSave = await curator.userClient.rpc("save_exhibition_curation", {
      p_exhibition_id: null,
      p_title: "Draft exhibition",
      p_subtitle: "",
      p_introduction: "A valid draft exhibition.",
      p_status: "draft",
      p_theme_id: "warm-gallery",
      p_rooms: [
        {
          name: "Room one",
          subtitle: "",
          introduction: "",
          artworks: [{ artworkId: artworkOne }],
        },
        {
          name: "Room two",
          subtitle: "",
          introduction: "",
          artworks: [{ artworkId: artworkTwo }],
        },
      ],
    });
    expect(draftSave.error).toBeNull();
    const exhibitionId = draftSave.data as unknown as string;

    const { data: exhibitionSuggestion } = await admin
      .from("exhibition_ai_suggestions")
      .insert({
        exhibition_id: exhibitionId,
        museum_id: curator.museumId,
        suggestion_type: "title",
        target_room_order: null,
        input_version: 1,
        content: { value: "Accepted exhibition title" },
        status: "pending",
      })
      .select("id")
      .single();
    const accepted = await curator.userClient.rpc("review_exhibition_ai_suggestion", {
      p_suggestion_id: exhibitionSuggestion?.id,
      p_action: "accept",
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toMatchObject({ status: "accepted" });

    const { data: exhibitionRow } = await admin
      .from("exhibitions")
      .select("title, curation_version")
      .eq("id", exhibitionId)
      .single();
    expect(exhibitionRow?.title).toBe("Accepted exhibition title");
    expect(exhibitionRow?.curation_version).toBeGreaterThan(1);
  });

  it("creates and processes cleanup jobs for artwork deletion", async () => {
    const curator = await createCurator("cleanup");
    const artworkId = await insertArtwork(admin, curator.museumId, { status: "draft" });
    const mediaPath = `${curator.museumId}/${artworkId}/${randomUUID()}/audio.wav`;
    await uploadPrivateObject(admin, mediaPath, Uint8Array.from([0x52, 0x49, 0x46, 0x46]), "audio/wav");
    await attachArtworkAsset(admin, artworkId, "audio", mediaPath);

    const deletion = await curator.userClient.rpc("delete_artwork", {
      p_artwork_id: artworkId,
    });
    expect(deletion.error).toBeNull();

    const { data: jobs } = await admin
      .from("media_cleanup_jobs")
      .select("id, status, object_paths")
      .eq("museum_id", curator.museumId)
      .eq("scope", "artwork.delete");
    expect(jobs?.[0]?.object_paths).toContain(mediaPath);

    const processed = await processPendingMediaCleanupJobs(20);
    expect(processed.completed).toBeGreaterThanOrEqual(1);

    const { data: remainingAsset } = await admin
      .from("artwork_assets")
      .select("artwork_id")
      .eq("artwork_id", artworkId)
      .maybeSingle();
    expect(remainingAsset).toBeNull();
  });

  it("rejects forged cleanup jobs and foreign storage paths", async () => {
    const curatorA = await createCurator("cleanup-owner");
    const curatorB = await createCurator("cleanup-foreign");
    const foreignPath = `${curatorB.museumId}/${randomUUID()}/display.webp`;

    const foreignMuseumAttempt = await curatorA.userClient.rpc(
      "enqueue_media_cleanup_job",
      {
        p_museum_id: curatorB.museumId,
        p_owner_id: curatorA.userId,
        p_scope: "forged",
        p_object_paths: [foreignPath],
        p_tombstone_museum_id: null,
      },
    );
    expect(foreignMuseumAttempt.error?.message).toContain(
      "MEDIA_CLEANUP_FORBIDDEN",
    );

    const foreignPathAttempt = await curatorA.userClient.rpc(
      "enqueue_media_cleanup_job",
      {
        p_museum_id: curatorA.museumId,
        p_owner_id: curatorA.userId,
        p_scope: "forged",
        p_object_paths: [foreignPath],
        p_tombstone_museum_id: null,
      },
    );
    expect(foreignPathAttempt.error?.message).toContain(
      "INVALID_MEDIA_CLEANUP_PATH",
    );
  });

  it("rejects direct user asset bypasses while allowing the validated server flow", async () => {
    const curator = await createCurator("artwork-commit");
    const artworkId = await insertArtwork(admin, curator.museumId, {
      status: "draft",
      source_version: 1,
    });
    const forgedPath = `${curator.museumId}/${artworkId}/v-bad/audio.wav`;
    await uploadPrivateObject(
      admin,
      forgedPath,
      Uint8Array.from([1, 2, 3]),
      "audio/wav",
    );

    const directRpc = await curator.userClient.rpc("apply_artwork_update", {
      p_artwork_id: artworkId,
      p_status: "draft",
      p_update_title: false,
      p_update_description: false,
      p_update_created_on: false,
      p_update_age_label: false,
      p_update_medium: false,
      p_update_child_quote: false,
      p_update_parent_note: false,
      p_update_status: false,
      p_assets: [
        {
          kind: "audio",
          storage_path: forgedPath,
          mime_type: "audio/wav",
          byte_size: 3,
        },
      ],
      p_remove_audio: false,
      p_bump_source_version: false,
    });
    expect(directRpc.error).toBeTruthy();

    const directInsert = await curator.userClient.from("artwork_assets").insert({
      artwork_id: artworkId,
      kind: "audio",
      storage_path: forgedPath,
      mime_type: "audio/wav",
      byte_size: 3,
    });
    expect(directInsert.error).toBeTruthy();

    const wav = createSilentWav(2);
    const uploads = await authorizeArtworkUploads(curator.userClient, artworkId, {
      audio: {
        mimeType: "audio/wav",
        byteSize: wav.byteLength,
        durationSeconds: 2,
      },
    });
    expect(uploads.audio).toBeTruthy();
    const uploadResult = await curator.userClient.storage
      .from("museum-private")
      .uploadToSignedUrl(
        uploads.audio!.path,
        uploads.audio!.token,
        new Blob([wav], { type: "audio/wav" }),
        {
          contentType: "audio/wav",
          upsert: false,
        },
      );
    expect(uploadResult.error).toBeNull();

    const committed = await commitArtworkUpdate(curator.userClient, artworkId, {
      mediaCommit: {
        sessionId: uploads.sessionId,
        audio: {
          path: uploads.audio!.path,
          mimeType: "audio/wav",
          byteSize: wav.byteLength,
          durationSeconds: 2,
        },
      },
    });
    expect(committed.warning).toBeUndefined();

    const { data: assetRow } = await admin
      .from("artwork_assets")
      .select("kind, storage_path, mime_type")
      .eq("artwork_id", artworkId)
      .eq("kind", "audio")
      .single();
    expect(assetRow?.storage_path).toContain(`/${artworkId}/`);
    expect(assetRow?.storage_path).not.toContain("/temp/");
    expect(assetRow?.mime_type).toBe("audio/wav");

    const { data: sessionRow } = await admin
      .from("media_upload_sessions")
      .select("status, cleanup_queued_at")
      .eq("id", uploads.sessionId)
      .single();
    expect(sessionRow).toMatchObject({
      status: "committed",
    });
    expect(sessionRow?.cleanup_queued_at).toBeTruthy();

    const { data: cleanupJobs } = await admin
      .from("media_cleanup_jobs")
      .select("scope, object_paths")
      .eq("museum_id", curator.museumId);
    expect(
      cleanupJobs?.some(
        (job: { scope: string; object_paths: string[] }) =>
          job.scope === "artwork.temp.cleanup" &&
          Array.isArray(job.object_paths) &&
          job.object_paths.includes(uploads.audio!.path),
      ),
    ).toBe(true);
  });

  it("creates artwork drafts atomically with child and parent notes", async () => {
    const curator = await createCurator("draft-rpc");
    const title = `Atomic ${randomUUID()}`;
    const failed = await curator.userClient.rpc("create_artwork_draft", {
      p_museum_id: curator.museumId,
      p_owner_id: curator.userId,
      p_title: title,
      p_description: "",
      p_created_on: null,
      p_age_label: "",
      p_medium: "",
      p_child_quote: "太".repeat(2100),
      p_parent_note: "",
    });
    expect(failed.error).toBeTruthy();

    const { data: failedArtwork } = await admin
      .from("artworks")
      .select("id")
      .eq("museum_id", curator.museumId)
      .eq("title", title)
      .maybeSingle();
    expect(failedArtwork).toBeNull();

    const created = await curator.userClient.rpc("create_artwork_draft", {
      p_museum_id: curator.museumId,
      p_owner_id: curator.userId,
      p_title: "完整草稿",
      p_description: "带备注",
      p_created_on: "2024-01-02",
      p_age_label: "7 岁",
      p_medium: "水彩",
      p_child_quote: "孩子的话",
      p_parent_note: "家长的话",
    });
    expect(created.error).toBeNull();

    const createdArtworkId = (created.data as { id: string }[] | null)?.[0]?.id;
    expect(createdArtworkId).toBeTruthy();

    const { data: notes } = await admin
      .from("artwork_notes")
      .select("source, content")
      .eq("artwork_id", createdArtworkId);
    expect(notes).toEqual(
      expect.arrayContaining([
        { source: "child", content: "孩子的话" },
        { source: "parent", content: "家长的话" },
      ]),
    );
  });

  it("prevents foreign session cleanup and queues expired upload sessions", async () => {
    const curatorA = await createCurator("upload-owner");
    const curatorB = await createCurator("upload-foreign");
    const artworkId = await insertArtwork(admin, curatorA.museumId, {
      status: "draft",
    });
    const wav = createSilentWav(1);
    const uploads = await authorizeArtworkUploads(curatorA.userClient, artworkId, {
      audio: {
        mimeType: "audio/wav",
        byteSize: wav.byteLength,
        durationSeconds: 1,
      },
    });

    await expect(
      cleanupArtworkUploadSession(curatorB.userClient, artworkId, uploads.sessionId),
    ).rejects.toThrow("无权操作");

    await uploadPrivateObject(admin, uploads.audio!.path, Uint8Array.from(wav), "audio/wav");
    await admin
      .from("media_upload_sessions")
      .update({
        created_at: new Date(Date.now() - 120_000).toISOString(),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", uploads.sessionId);

    const processed = await processPendingMediaCleanupJobs(20);
    expect(processed.completed).toBeGreaterThanOrEqual(1);

    const { data: sessionRow } = await admin
      .from("media_upload_sessions")
      .select("status, cleanup_queued_at")
      .eq("id", uploads.sessionId)
      .single();
    expect(sessionRow).toMatchObject({
      status: "cleanup_queued",
    });
    expect(sessionRow?.cleanup_queued_at).toBeTruthy();

    const { data: cleanupJobs } = await admin
      .from("media_cleanup_jobs")
      .select("scope, object_paths")
      .eq("museum_id", curatorA.museumId);
    expect(
      cleanupJobs?.some(
        (job: { scope: string; object_paths: string[] }) =>
          job.scope === "artwork.upload.session.recovery" &&
          Array.isArray(job.object_paths) &&
          job.object_paths.includes(uploads.audio!.path),
      ),
    ).toBe(true);
  });

  it("creates museum tombstones within owner-only RLS when deleting a museum", async () => {
    const curator = await createCurator("museum-delete");

    const deletion = await curator.userClient.rpc("delete_museum_permanently");
    expect(deletion.error).toBeNull();

    const { data: tombstone } = await admin
      .from("museum_tombstones")
      .select("museum_id, owner_id, cleanup_status")
      .eq("museum_id", curator.museumId)
      .single();
    expect(tombstone).toMatchObject({
      museum_id: curator.museumId,
      owner_id: curator.userId,
      cleanup_status: "pending",
    });
  });
});
