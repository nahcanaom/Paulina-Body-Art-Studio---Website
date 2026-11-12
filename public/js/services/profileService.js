/**
 * ============================================================================
 * PROFILE SERVICE - SUPABASE DATABASE IMPLEMENTATION
 * ============================================================================
 *
 * Drop-in replacement for the profile helpers that previously lived in
 * js/firestore.js. The exported names and return shape are intentionally the
 * same so account settings and auth code can stay almost unchanged.
 *
 * Required tables (see docs/supabase-auth-migration.md):
 *   - public.profiles          private profile data (one row per auth user)
 *   - public.public_profiles   display name + avatar visible beside reviews
 */

import { getSupabaseClient, getSupabaseConfig } from "./supabaseClient.js";

function profileId(userOrId) {
  return typeof userOrId === "string" ? userOrId : userOrId?.uid || userOrId?.id || "";
}

function wrapError(error, action) {
  const wrapped = new Error(
    `Could not ${action}${error?.message ? `: ${error.message}` : "."}`
  );
  wrapped.code = error?.code || "profile_error";
  wrapped.cause = error;
  return wrapped;
}

function toProfile(row) {
  if (!row) return null;

  return {
    // Compatibility fields expected by account settings
    uid: row.id,
    displayName: row.display_name || "",
    photoURL: row.photo_url || "",

    // Native fields
    id: row.id,
    email: row.email || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",

    raw: row
  };
}

/**
 * Creates or updates a private profile row for the authenticated user.
 * Mirrors the previous Firestore `saveUserProfile(user, displayName)` API.
 */
export async function saveUserProfile(user, displayName = user?.displayName || "") {
  const id = profileId(user);
  if (!id) throw new Error("saveUserProfile requires an authenticated user.");

  const client = await getSupabaseClient();
  const config = getSupabaseConfig();

  const payload = {
    id,
    email: user?.email || "",
    display_name: displayName || user?.displayName || "",
    photo_url: user?.photoURL || "",
    updated_at: new Date().toISOString()
  };

  const { error } = await client
    .from(config.tables.profiles)
    .upsert(payload, { onConflict: "id" });

  if (error) throw wrapError(error, "save your profile");
}

/**
 * Reads the signed-in user's private profile.
 * Mirrors the previous Firestore `getUserProfile(uid)` API.
 */
export async function getUserProfile(uid) {
  const id = profileId(uid);
  if (!id) return null;

  const client = await getSupabaseClient();
  const config = getSupabaseConfig();

  const { data, error } = await client
    .from(config.tables.profiles)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw wrapError(error, "load your profile");
  return toProfile(data);
}

/**
 * Reads a user's public profile (display name + avatar only).
 * Mirrors the previous Firestore `getPublicProfile(uid)` API.
 */
export async function getPublicProfile(uid) {
  const id = profileId(uid);
  if (!id) return null;

  const client = await getSupabaseClient();
  const config = getSupabaseConfig();

  const { data, error } = await client
    .from(config.tables.publicProfiles)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw wrapError(error, "load the public profile");
  return toProfile(data);
}

/**
 * Saves publicly-visible profile fields so they can appear beside reviews.
 * Mirrors the previous Firestore `savePublicProfile(uid, values)` API.
 */
export async function savePublicProfile(uid, { displayName, photoURL } = {}) {
  const id = profileId(uid);
  if (!id) throw new Error("savePublicProfile requires a user id.");

  const client = await getSupabaseClient();
  const config = getSupabaseConfig();

  const { error } = await client.from(config.tables.publicProfiles).upsert(
    {
      id,
      display_name: displayName || "",
      photo_url: photoURL || "",
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );

  if (error) throw wrapError(error, "save the public profile");
}
