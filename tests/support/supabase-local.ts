/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitations";

export function requireSupabaseEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { url, anonKey, serviceRoleKey };
}

export function createAdminClient() {
  const { url, serviceRoleKey } = requireSupabaseEnv();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

export function createAnonClient() {
  const { url, anonKey } = requireSupabaseEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

export async function createCurator(label: string) {
  const admin = createAdminClient();
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1_000)}@kids-museum.local`;
  const password = `Museum!${Math.floor(Math.random() * 100_000)}Aa`;
  const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { synthetic: true, label },
  });
  if (createError || !createdUser.user) {
    throw new Error(`Failed to create local curator: ${createError?.message ?? "unknown"}`);
  }

  const userClient = createAnonClient();
  const { error: loginError } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (loginError) {
    throw new Error(`Failed to sign in local curator: ${loginError.message}`);
  }

  const museumId = await waitForMuseumProfile(admin, createdUser.user.id);
  await admin
    .from("museum_profiles")
    .update({
      name: `${label} 博物馆`,
      artist_nickname: `${label} 馆长`,
      theme_id: "warm-gallery",
    })
    .eq("id", museumId);

  return {
    userId: createdUser.user.id,
    email,
    password,
    museumId,
    userClient: userClient as any,
    admin,
  };
}

export async function waitForMuseumProfile(
  admin: any,
  ownerId: string,
  attempts = 20,
) {
  for (let index = 0; index < attempts; index += 1) {
    const { data } = await admin
      .from("museum_profiles")
      .select("id")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (data?.id) {
      return data.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Museum profile trigger did not finish in time.");
}

export async function insertArtwork(
  admin: any,
  museumId: string,
  overrides: Partial<{
    id: string;
    title: string;
    status: "draft" | "published" | "archived";
    source_version: number;
  }> = {},
) {
  const id = overrides.id ?? randomUUID();
  const { error } = await admin.from("artworks").insert({
    id,
    museum_id: museumId,
    title: overrides.title ?? `作品 ${id.slice(0, 8)}`,
    description: "integration test artwork",
    status: overrides.status ?? "published",
    created_on: "2024-01-01",
    age_label: "6 岁",
    medium: "测试媒材",
    source_version: overrides.source_version ?? 1,
  });
  if (error) {
    throw new Error(`Failed to insert artwork: ${error.message}`);
  }
  return id;
}

export async function uploadPrivateObject(
  admin: any,
  path: string,
  bytes: Uint8Array,
  contentType: string,
) {
  const { error } = await admin.storage.from("museum-private").upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`Failed to upload private object: ${error.message}`);
  }
}

export async function attachArtworkAsset(
  admin: any,
  artworkId: string,
  kind: "original" | "display" | "thumbnail" | "audio",
  storagePath: string,
) {
  const isAudio = kind === "audio";
  const { error } = await admin.from("artwork_assets").insert({
    artwork_id: artworkId,
    kind,
    storage_path: storagePath,
    mime_type: isAudio ? "audio/wav" : "image/webp",
    byte_size: isAudio ? 128 : 96,
    width: isAudio ? null : 8,
    height: isAudio ? null : 8,
    duration_seconds: isAudio ? 1 : null,
  });
  if (error) {
    throw new Error(`Failed to attach artwork asset: ${error.message}`);
  }
}

export async function createVisitInvitation(admin: any, museumId: string, hours = 24) {
  const token = createInvitationToken();
  const tokenHash = await hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const createdAt =
    hours < 0
      ? new Date(Date.now() + (hours - 1) * 60 * 60 * 1000).toISOString()
      : undefined;
  const { data, error } = await admin
    .from("invitations")
    .insert({
      museum_id: museumId,
      token_hash: tokenHash,
      label: "Integration invite",
      expires_at: expiresAt,
      ...(createdAt ? { created_at: createdAt } : {}),
    })
    .select("id, expires_at")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create invitation: ${error?.message ?? "unknown"}`);
  }
  return { token, invitationId: data.id, expiresAt: data.expires_at };
}

export async function createPublishedExhibition(
  admin: any,
  museumId: string,
  artworkIds: [string, string],
) {
  const exhibitionId = randomUUID();
  const roomOneId = randomUUID();
  const roomTwoId = randomUUID();
  const { error: exhibitionError } = await admin.from("exhibitions").insert({
    id: exhibitionId,
    museum_id: museumId,
    title: "Integration Exhibition",
    subtitle: "",
    introduction: "A published exhibition for invite e2e.",
    status: "draft",
    theme_id: "warm-gallery",
    theme_version: 1,
  });
  const { error: roomOneError } = await admin.from("exhibition_rooms").insert({
    id: roomOneId,
    exhibition_id: exhibitionId,
    museum_id: museumId,
    name: "Room One",
    subtitle: "",
    introduction: "Room one",
    sort_order: 0,
    room_style: {},
  });
  const { error: roomTwoError } = await admin.from("exhibition_rooms").insert({
    id: roomTwoId,
    exhibition_id: exhibitionId,
    museum_id: museumId,
    name: "Room Two",
    subtitle: "",
    introduction: "Room two",
    sort_order: 1,
    room_style: {},
  });
  if (exhibitionError || roomOneError || roomTwoError) {
    throw new Error(
      exhibitionError?.message || roomOneError?.message || roomTwoError?.message || "Failed to seed exhibition.",
    );
  }

  const [{ error: artworkOneError }, { error: artworkTwoError }] = await Promise.all([
    admin.from("room_artworks").insert({
      room_id: roomOneId,
      artwork_id: artworkIds[0],
      museum_id: museumId,
      sort_order: 0,
      display_config: { featured: true, size: "large", framePreset: "classic" },
    }),
    admin.from("room_artworks").insert({
      room_id: roomTwoId,
      artwork_id: artworkIds[1],
      museum_id: museumId,
      sort_order: 0,
      display_config: { featured: false, size: "medium", framePreset: "classic" },
    }),
  ]);
  if (artworkOneError || artworkTwoError) {
    throw new Error(artworkOneError?.message || artworkTwoError?.message || "Failed to seed room artworks.");
  }

  const { error: publishError } = await admin
    .from("exhibitions")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
    })
    .eq("id", exhibitionId);
  if (publishError) {
    throw new Error(`Failed to publish seeded exhibition: ${publishError.message}`);
  }

  return { exhibitionId, roomIds: [roomOneId, roomTwoId] as const };
}
