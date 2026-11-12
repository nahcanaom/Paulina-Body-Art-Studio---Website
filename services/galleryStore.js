'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LOCAL_GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads', 'gallery');

let supabaseClient = null;
const SUPABASE_TIMEOUT_MS = 3000;
const SUPABASE_RETRY_AFTER_MS = 60000;
let supabaseUnavailableUntil = 0;

// SSE or event listeners for real-time synchronization
const changeListeners = new Set();

function registerChangeListener(callback) {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

function notifyChangeListeners(action, data) {
  for (const listener of changeListeners) {
    try {
      listener(action, data);
    } catch (err) {
      console.warn('[galleryStore] Listener notification error:', err?.message || err);
    }
  }
}

const SUPABASE_PLACEHOLDER_PATTERN =
  /your[_-]?project[_-]?ref|your[_-]?supabase|your[_-]?service[_-]?role|placeholder|changeme|example\.(com|org)/i;

function isRealSupabaseConfigured() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return false;
  if (SUPABASE_PLACEHOLDER_PATTERN.test(url) || SUPABASE_PLACEHOLDER_PATTERN.test(key)) {
    return false;
  }
  try {
    new URL(url);
  } catch {
    return false;
  }
  return true;
}

function getSupabase() {
  if (!isRealSupabaseConfigured()) return null;
  if (supabaseUnavailableUntil > Date.now()) return null;

  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
    supabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return supabaseClient;
}

function markSupabaseUnavailable(reason) {
  supabaseUnavailableUntil = Date.now() + SUPABASE_RETRY_AFTER_MS;
  console.warn(`[galleryStore] Supabase marked unavailable for ${SUPABASE_RETRY_AFTER_MS / 1000}s: ${reason}`);
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// Write queue for local atomic file writes
let writeQueue = Promise.resolve();
function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

async function readLocalGallery() {
  try {
    const raw = await fs.readFile(LOCAL_GALLERY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(LOCAL_GALLERY_FILE, '[]\n', 'utf8');
      return [];
    }
    console.warn('[galleryStore] Error reading local gallery file:', err.message);
    return [];
  }
}

async function writeLocalGallery(items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LOCAL_GALLERY_FILE, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_PATTERN.test(String(value || ''));
}

// The four public gallery sections, grouped under two tabs on the gallery page:
//   PIERCING -> Face Piercing, Body Piercing
//   TATTOOS  -> Face Tattoo, Body Tattoo
// New rows store one of these in both the category and subcategory columns so
// legacy "Face tattoos" / "Ear piercing" labels can never resurface.
const GALLERY_CATEGORIES = ['Face Tattoo', 'Body Tattoo', 'Face Piercing', 'Body Piercing'];

// Head and face placements belong to the face section. Word boundaries keep
// "forearm" from matching "ear".
const FACE_AREA_PATTERN =
  /\b(face|facial|head|forehead|temple|eyebrow|eyelid|eye|nose|nostril|septum|bridge|cheek|lip|labret|philtrum|medusa|chin|jaw|tongue|smiley|dimple|ear|helix|lobe|conch|tragus|daith|rook|industrial|snug)\b/i;

/**
 * Coerces any stored category/subcategory pair to one of the four sections.
 * Older rows may still say "Tattoos", "Piercing", "Face tattoos" or
 * "Ear piercing", so the stored subcategory and body part decide the section.
 */
function resolveGalleryCategory(row = {}) {
  const raw = String(row.category || '').trim().toLowerCase();
  const subcategory = String(row.subcategory || row.sub_category || '').trim().toLowerCase();
  const bodyPart = String(row.bodyPart || row.body_part || '').trim();
  const hint = `${raw} ${subcategory}`;

  if (/face\s*tattoo/.test(hint)) return 'Face Tattoo';
  if (/body\s*tattoo/.test(hint)) return 'Body Tattoo';
  if (/face\s*pierc|ear\s*pierc/.test(hint)) return 'Face Piercing';
  if (/body\s*pierc/.test(hint)) return 'Body Piercing';

  if (/tattoo/.test(hint)) {
    const areaHint = `${bodyPart} ${row.title || ''} ${subcategory}`;
    return FACE_AREA_PATTERN.test(areaHint) ? 'Face Tattoo' : 'Body Tattoo';
  }

  if (/pierc/.test(hint)) return /\bbody\b/.test(hint) ? 'Body Piercing' : 'Face Piercing';
  if (/\bbody\b/.test(hint)) return 'Body Piercing';
  return 'Face Piercing';
}

/**
 * Normalise row mapping between DB (snake_case) and App (camelCase)
 */
function normalizeImage(row) {
  if (!row) return null;
  const category = resolveGalleryCategory(row);
  return {
    id: row.id,
    title: row.title || 'Untitled Work',
    category,
    subcategory: category,
    bodyPart: row.bodyPart || row.body_part || '',
    imageUrl: row.imageUrl || row.image_url || '',
    thumbnailUrl: row.thumbnailUrl || row.thumbnail_url || row.imageUrl || row.image_url || '',
    altText: row.altText || row.alt_text || '',
    isPublished: row.isPublished !== undefined ? Boolean(row.isPublished) : Boolean(row.is_published),
    displayOrder: Number(row.displayOrder ?? row.display_order ?? 0),
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    updatedAt: row.updatedAt || row.updated_at || new Date().toISOString()
  };
}

/**
 * Only files below data/uploads/gallery may be deleted by the store. The URL
 * may be relative or absolute (the public page resolves uploads against the
 * API origin), so compare the parsed pathname instead of the raw string.
 */
function localUploadFilename(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return '';
    }
  }

  if (!pathname.startsWith('/uploads/gallery/')) return '';

  const fileName = path.basename(pathname);
  return fileName && fileName !== '.' && fileName !== '..' ? fileName : '';
}

async function removeLocalUpload(imageUrl) {
  const fileName = localUploadFilename(imageUrl);
  if (!fileName) return;

  const filePath = path.join(UPLOADS_DIR, fileName);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[galleryStore] Could not unlink file:', filePath, err.message);
    }
  }
}

/**
 * Fetch a single row straight from Supabase. Used when a record exists only
 * in the hosted database (for example rows created before local-json mirroring
 * was added) and when a write needs to confirm the remote row is gone.
 */
async function fetchRemoteImageRow(id) {
  const client = getSupabase();
  if (!client || !isUuid(id)) return null;

  try {
    const { data, error } = await withTimeout(
      client.from('gallery_images').select('*').eq('id', id).maybeSingle(),
      SUPABASE_TIMEOUT_MS,
      'Supabase image fetch'
    );
    if (error) throw error;
    return data || null;
  } catch (err) {
    markSupabaseUnavailable(err?.message || 'Query failed');
    return null;
  }
}

/**
 * Get all gallery images (Admin view) with stats
 */
async function getAllImagesAdmin(filters = {}) {
  const client = getSupabase();
  let list = [];

  if (client) {
    try {
      const query = client.from('gallery_images').select('*').order('created_at', { ascending: false });
      const { data, error } = await withTimeout(query, SUPABASE_TIMEOUT_MS, 'Supabase gallery fetch');
      if (error) throw error;
      list = (data || []).map(normalizeImage);
    } catch (err) {
      markSupabaseUnavailable(err?.message || 'Query failed');
      list = (await readLocalGallery()).map(normalizeImage);
    }
  } else {
    list = (await readLocalGallery()).map(normalizeImage);
  }

  // Calculate summary counts
  const total = list.length;
  const published = list.filter((i) => i.isPublished).length;
  const draft = total - published;
  const faceTattoo = list.filter((i) => i.category === 'Face Tattoo').length;
  const bodyTattoo = list.filter((i) => i.category === 'Body Tattoo').length;
  const facePiercing = list.filter((i) => i.category === 'Face Piercing').length;
  const bodyPiercing = list.filter((i) => i.category === 'Body Piercing').length;
  // `tattoo` stays the combined total for older dashboards.
  const tattoo = faceTattoo + bodyTattoo;

  let filtered = [...list];

  // Apply filters if provided
  if (filters.category && filters.category !== 'all') {
    const cat = filters.category.toLowerCase();
    filtered = filtered.filter((i) => i.category.toLowerCase().includes(cat));
  }
  if (filters.visibility && filters.visibility !== 'all') {
    const isPub = filters.visibility === 'published';
    filtered = filtered.filter((i) => i.isPublished === isPub);
  }
  if (filters.search) {
    const term = filters.search.toLowerCase().trim();
    filtered = filtered.filter(
      (i) =>
        i.title.toLowerCase().includes(term) ||
        i.subcategory.toLowerCase().includes(term) ||
        (i.bodyPart || '').toLowerCase().includes(term) ||
        i.altText.toLowerCase().includes(term)
    );
  }

  // Sorting
  if (filters.sort === 'oldest') {
    filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else if (filters.sort === 'title') {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    // Default newest first
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return {
    images: filtered,
    stats: { total, published, draft, tattoo, faceTattoo, bodyTattoo, facePiercing, bodyPiercing }
  };
}

/**
 * Get published gallery images for user-facing website
 */
async function getPublishedImages(category) {
  const client = getSupabase();
  let list = [];

  if (client) {
    try {
      let query = client.from('gallery_images').select('*').eq('is_published', true).order('display_order', { ascending: true }).order('created_at', { ascending: false });
      if (category && category !== 'all') {
        query = query.ilike('category', `%${category}%`);
      }
      const { data, error } = await withTimeout(query, SUPABASE_TIMEOUT_MS, 'Supabase published gallery');
      if (error) throw error;
      list = (data || []).map(normalizeImage);
    } catch (err) {
      markSupabaseUnavailable(err?.message || 'Query failed');
      const all = await readLocalGallery();
      list = all.filter((i) => i.isPublished).map(normalizeImage);
    }
  } else {
    const all = await readLocalGallery();
    list = all.filter((i) => i.isPublished).map(normalizeImage);
  }

  if (category && category !== 'all') {
    const cat = category.toLowerCase();
    list = list.filter((i) => i.category.toLowerCase().includes(cat));
  }

  return list;
}

/**
 * Get image by ID. Prefer the hosted row so the admin always reads the same
 * record the public gallery uses, then fall back to the local mirror.
 */
async function getImageById(id) {
  if (!id) return null;

  const remote = await fetchRemoteImageRow(id);
  if (remote) return normalizeImage(remote);

  const items = await readLocalGallery();
  const found = items.find((i) => String(i.id) === String(id));
  return found ? normalizeImage(found) : null;
}

/**
 * Create a new gallery image entry
 */
async function createImage(payload) {
  const item = {
    // gallery_images.id is a UUID column in Supabase. Generating a matching
    // UUID here keeps the local mirror and the hosted table interchangeable.
    id: isUuid(payload.id) ? payload.id : crypto.randomUUID(),
    title: (payload.title || 'New Studio Work').trim(),
    category: resolveGalleryCategory(payload),
    subcategory: resolveGalleryCategory(payload),
    bodyPart: (payload.bodyPart || '').trim(),
    imageUrl: payload.imageUrl,
    thumbnailUrl: payload.thumbnailUrl || payload.imageUrl,
    altText: payload.altText || '',
    isPublished: payload.isPublished !== undefined ? Boolean(payload.isPublished) : true,
    displayOrder: Number(payload.displayOrder || 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await enqueue(async () => {
    const list = await readLocalGallery();
    list.unshift(item);
    await writeLocalGallery(list);
  });

  const client = getSupabase();
  if (client) {
    try {
      // Supabase resolves with { error } instead of throwing, so the result
      // must be inspected or a failed write looks successful.
      const { error } = await client.from('gallery_images').insert({
        id: item.id,
        title: item.title,
        category: item.category,
        subcategory: item.subcategory,
        body_part: item.bodyPart,
        image_url: item.imageUrl,
        thumbnail_url: item.thumbnailUrl,
        alt_text: item.altText,
        is_published: item.isPublished,
        display_order: item.displayOrder,
        created_at: item.createdAt,
        updated_at: item.updatedAt
      });
      if (error) throw error;
    } catch (err) {
      // The local JSON write already succeeded. Temporarily prefer that mirror
      // so the new photo is visible everywhere instead of disappearing behind
      // a stale hosted read.
      markSupabaseUnavailable(`insert failed: ${err?.message || err}`);
    }
  }

  notifyChangeListeners('create', item);
  return item;
}

/**
 * Update an existing gallery image
 */
async function updateImage(id, updates) {
  let updated = null;
  let previous = null;

  // A partial update (for example a PUT that only toggles visibility) must not
  // overwrite stored fields with undefined and blank out the photo record.
  const safeUpdates = Object.fromEntries(
    Object.entries(updates || {}).filter(([, value]) => value !== undefined)
  );

  await enqueue(async () => {
    const list = await readLocalGallery();
    let idx = list.findIndex((i) => String(i.id) === String(id));

    // Rows created before local mirroring existed may only be in Supabase.
    if (idx === -1) {
      const remote = await fetchRemoteImageRow(id);
      if (remote) {
        list.unshift(normalizeImage(remote));
        idx = 0;
      }
    }

    if (idx === -1) return;

    previous = { ...list[idx] };

    list[idx] = {
      ...list[idx],
      ...safeUpdates,
      id: list[idx].id, // preserve ID
      updatedAt: new Date().toISOString()
    };
    if (safeUpdates.isPublished !== undefined) {
      list[idx].isPublished = Boolean(safeUpdates.isPublished);
    }
    if (safeUpdates.displayOrder !== undefined) {
      list[idx].displayOrder = Number(safeUpdates.displayOrder) || 0;
    }

    updated = normalizeImage(list[idx]);
    await writeLocalGallery(list);
  });

  if (!updated) return null;

  // A replacement upload creates a new file name; remove the file it replaced
  // so data/uploads/gallery does not accumulate unreferenced photos.
  if (
    previous?.imageUrl &&
    safeUpdates.imageUrl !== undefined &&
    previous.imageUrl !== updated.imageUrl
  ) {
    await removeLocalUpload(previous.imageUrl);
  }
  if (
    previous?.thumbnailUrl &&
    safeUpdates.thumbnailUrl !== undefined &&
    previous.thumbnailUrl !== updated.thumbnailUrl &&
    previous.thumbnailUrl !== previous.imageUrl
  ) {
    await removeLocalUpload(previous.thumbnailUrl);
  }

  const client = getSupabase();
  if (client && isUuid(id)) {
    try {
      const dbPayload = { updated_at: updated.updatedAt };
      if (safeUpdates.title !== undefined) dbPayload.title = safeUpdates.title;
      if (safeUpdates.category !== undefined) dbPayload.category = safeUpdates.category;
      if (safeUpdates.subcategory !== undefined) dbPayload.subcategory = safeUpdates.subcategory;
      if (safeUpdates.bodyPart !== undefined) dbPayload.body_part = safeUpdates.bodyPart;
      if (safeUpdates.altText !== undefined) dbPayload.alt_text = safeUpdates.altText;
      if (safeUpdates.imageUrl !== undefined) dbPayload.image_url = safeUpdates.imageUrl;
      if (safeUpdates.thumbnailUrl !== undefined) dbPayload.thumbnail_url = safeUpdates.thumbnailUrl;
      if (safeUpdates.isPublished !== undefined) {
        dbPayload.is_published = Boolean(safeUpdates.isPublished);
      }
      if (safeUpdates.displayOrder !== undefined) {
        dbPayload.display_order = Number(safeUpdates.displayOrder);
      }

      const { error } = await client.from('gallery_images').update(dbPayload).eq('id', id);
      if (error) throw error;
    } catch (err) {
      markSupabaseUnavailable(`update failed: ${err?.message || err}`);
    }
  }

  notifyChangeListeners('update', updated);
  return updated;
}

/**
 * Delete a gallery image and backing file
 */
async function deleteImage(id) {
  let deletedItem = null;

  await enqueue(async () => {
    const list = await readLocalGallery();
    const idx = list.findIndex((i) => String(i.id) === String(id));
    if (idx === -1) return;

    deletedItem = list.splice(idx, 1)[0];
    await writeLocalGallery(list);
  });

  // Support rows that only exist in the hosted database.
  if (!deletedItem) {
    const remote = await fetchRemoteImageRow(id);
    if (!remote) return false;
    deletedItem = normalizeImage(remote);
  }

  // Delete every backing file this record references, not just imageUrl.
  for (const url of new Set([deletedItem.imageUrl, deletedItem.thumbnailUrl])) {
    await removeLocalUpload(url);
  }

  const client = getSupabase();
  if (client && isUuid(id)) {
    try {
      const { error } = await client.from('gallery_images').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      markSupabaseUnavailable(`delete failed: ${err?.message || err}`);
    }
  }

  notifyChangeListeners('delete', { id, imageUrl: deletedItem.imageUrl });
  return true;
}

module.exports = {
  GALLERY_CATEGORIES,
  resolveGalleryCategory,
  getAllImagesAdmin,
  getPublishedImages,
  getImageById,
  createImage,
  updateImage,
  deleteImage,
  registerChangeListener
};

