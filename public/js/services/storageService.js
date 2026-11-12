/**
 * ============================================================================
 * STORAGE SERVICE - SUPABASE STORAGE IMPLEMENTATION
 * ============================================================================
 * Handles file uploads and asset management across Supabase Storage buckets:
 *   - profile_pictures
 *   - jewelry-catalog
 *   - studio-gallery
 *   - site-images
 *   - custom-requests
 *
 * All buckets are public, returning public HTTPS URLs via getPublicUrl().
 */

import { getSupabaseClient, getSupabaseConfig } from "./supabaseClient.js";

const DEFAULT_BUCKETS = {
  profilePictures: "profile_pictures",
  catalogue: "jewelry-catalog",
  gallery: "studio-gallery",
  siteImages: "site-images",
  customRequests: "custom-requests"
};

function sanitizeExtension(file) {
  const name = typeof file === "string" ? file : file?.name;
  const extension = (name?.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return extension || "jpg";
}

function sanitizeFileName(name) {
  return String(name || "image")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

/**
 * Uploads a file/blob to any specified Supabase Storage bucket and returns its public HTTPS URL.
 */
export async function uploadImageToBucket(file, bucketName, path) {
  if (!file) throw new Error("A file or blob is required for storage upload.");
  if (!bucketName) throw new Error("A target bucket is required for storage upload.");

  const client = await getSupabaseClient();
  const filePath = String(path || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${sanitizeExtension(file)}`);

  const contentType = file.type || undefined;

  const { error } = await client.storage.from(bucketName).upload(filePath, file, {
    upsert: true,
    cacheControl: "3600",
    contentType
  });

  if (error) {
    const wrapped = new Error(`Could not upload to ${bucketName}: ${error.message}`);
    wrapped.code = error.name || "storage_upload_failed";
    wrapped.cause = error;
    throw wrapped;
  }

  const { data } = client.storage.from(bucketName).getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Uploads a profile picture and returns its public URL.
 */
export async function uploadProfilePicture(file, uid) {
  if (!uid) throw new Error("uploadProfilePicture requires a user id.");
  const config = getSupabaseConfig();
  const bucket = config?.storage?.profilePicturesBucket || DEFAULT_BUCKETS.profilePictures;
  const path = `${uid}/profile.${sanitizeExtension(file)}`;
  return uploadImageToBucket(file, bucket, path);
}

/**
 * Uploads an image for the jewelry catalogue.
 */
export async function uploadCatalogueImage(file, itemId = "item") {
  const ext = sanitizeExtension(file);
  const safeId = sanitizeFileName(itemId);
  const path = `items/${safeId}-${Date.now()}.${ext}`;
  return uploadImageToBucket(file, DEFAULT_BUCKETS.catalogue, path);
}

/**
 * Uploads an artwork image for the studio portfolio gallery.
 */
export async function uploadGalleryImage(file, title = "work") {
  const ext = sanitizeExtension(file);
  const safeTitle = sanitizeFileName(title);
  const path = `gallery/${safeTitle}-${Date.now()}.${ext}`;
  return uploadImageToBucket(file, DEFAULT_BUCKETS.gallery, path);
}

/**
 * Uploads a site content or banner image.
 */
export async function uploadSiteImage(file, section = "general", label = "banner") {
  const ext = sanitizeExtension(file);
  const safeSection = sanitizeFileName(section);
  const safeLabel = sanitizeFileName(label);
  const path = `${safeSection}/${safeLabel}-${Date.now()}.${ext}`;
  return uploadImageToBucket(file, DEFAULT_BUCKETS.siteImages, path);
}

/**
 * Uploads custom request references or payment proofs.
 */
export async function uploadCustomRequestImage(file, reference = "ref", type = "reference") {
  const ext = sanitizeExtension(file);
  const safeRef = sanitizeFileName(reference);
  const safeType = sanitizeFileName(type);
  const path = `${safeRef}/${safeType}-${Date.now()}.${ext}`;
  return uploadImageToBucket(file, DEFAULT_BUCKETS.customRequests, path);
}

/**
 * Extracts the storage object path from a public Supabase URL.
 */
export function extractStoragePath(url, bucketName) {
  if (!url || !bucketName) return "";
  const markers = [
    `/storage/v1/object/public/${bucketName}/`,
    `/storage/v1/object/sign/${bucketName}/`
  ];

  for (const marker of markers) {
    const index = url.indexOf(marker);
    if (index === -1) continue;
    return decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
  }
  return "";
}

/**
 * Deletes a file in a Supabase Storage bucket by its public URL.
 */
export async function deleteStorageFileByUrl(url, bucketName) {
  const path = extractStoragePath(url, bucketName);
  if (!path) return false;

  const client = await getSupabaseClient();
  const { error } = await client.storage.from(bucketName).remove([path]);

  if (error) {
    console.warn(`[storage] Could not remove object ${path} from ${bucketName}:`, error.message);
    return false;
  }
  return true;
}

/**
 * Returns true when a URL points at this project's profile-picture bucket.
 */
export function isProfilePictureUrl(url) {
  if (!url) return false;
  const bucket = getSupabaseConfig()?.storage?.profilePicturesBucket || DEFAULT_BUCKETS.profilePictures;
  return (
    url.includes(`/storage/v1/object/public/${bucket}/`) ||
    url.includes(`/storage/v1/object/sign/${bucket}/`)
  );
}

/**
 * Deletes a profile picture referenced by its public URL.
 */
export async function deleteProfilePictureByUrl(url) {
  const bucket = getSupabaseConfig()?.storage?.profilePicturesBucket || DEFAULT_BUCKETS.profilePictures;
  return deleteStorageFileByUrl(url, bucket);
}
