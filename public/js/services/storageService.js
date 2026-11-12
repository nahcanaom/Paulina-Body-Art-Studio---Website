/**
 * ============================================================================
 * PROFILE PICTURE STORAGE - SUPABASE STORAGE IMPLEMENTATION
 * ============================================================================
 *
 * Replaces the Firebase Storage helpers used by account settings.
 *
 * Bucket layout:
 *   profile_pictures/<user-id>/profile.<extension>
 *
 * The bucket must be public for `getPublicUrl()` images to render without
 * signed URLs. Upload/update/delete are still restricted to the owning user by
 * Supabase Storage policies (see docs/supabase-auth-migration.md).
 */

import { getSupabaseClient, getSupabaseConfig } from "./supabaseClient.js";

function sanitizeExtension(file) {
  const extension = (file?.name?.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return extension || "jpg";
}

/**
 * Uploads a profile picture and returns its public URL.
 */
export async function uploadProfilePicture(file, uid) {
  if (!uid) throw new Error("uploadProfilePicture requires a user id.");

  const client = await getSupabaseClient();
  const config = getSupabaseConfig();
  const bucket = config.storage.profilePicturesBucket;
  const path = `${uid}/profile.${sanitizeExtension(file)}`;

  const { error } = await client.storage.from(bucket).upload(path, file, {
    upsert: true,
    cacheControl: "3600",
    contentType: file.type || undefined
  });

  if (error) {
    const wrapped = new Error(`Could not upload the profile picture: ${error.message}`);
    wrapped.code = error.name || "storage_upload_failed";
    wrapped.cause = error;
    throw wrapped;
  }

  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Returns true when a URL points at this project's profile-picture bucket.
 */
export function isProfilePictureUrl(url) {
  if (!url) return false;

  const bucket = getSupabaseConfig().storage.profilePicturesBucket;
  return (
    url.includes(`/storage/v1/object/public/${bucket}/`) ||
    url.includes(`/storage/v1/object/sign/${bucket}/`)
  );
}

function storagePathFromUrl(url) {
  if (!url) return "";

  const bucket = getSupabaseConfig().storage.profilePicturesBucket;
  const markers = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`
  ];

  for (const marker of markers) {
    const index = url.indexOf(marker);
    if (index === -1) continue;

    return decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
  }

  return "";
}

/**
 * Deletes a profile picture referenced by its public URL.
 * Missing objects are treated as success so UI cleanup never gets stuck.
 */
export async function deleteProfilePictureByUrl(url) {
  const path = storagePathFromUrl(url);
  if (!path) return false;

  const client = await getSupabaseClient();
  const bucket = getSupabaseConfig().storage.profilePicturesBucket;
  const { error } = await client.storage.from(bucket).remove([path]);

  if (error) {
    const wrapped = new Error(`Could not delete the profile picture: ${error.message}`);
    wrapped.code = error.name || "storage_delete_failed";
    wrapped.cause = error;
    throw wrapped;
  }

  return true;
}
