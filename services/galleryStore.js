'use strict';

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_URL = 'https://celusvfynfnszmhjgqwj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_NlHs6PG9x_HHfCDUKOlArQ_pM41Bn7g';
const GALLERY_TABLE = 'gallery_images';

let supabaseClient = null;

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

function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

  const finalUrl = url && !url.includes('YOUR_PROJECT_REF') ? url : DEFAULT_SUPABASE_URL;
  const finalKey = key && !key.includes('YOUR_') && !key.includes('placeholder') ? key : DEFAULT_SUPABASE_ANON_KEY;

  supabaseClient = createClient(finalUrl, finalKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  return supabaseClient;
}

const GALLERY_CATEGORIES = ['Face Tattoo', 'Body Tattoo', 'Face Piercing', 'Body Piercing'];

const FACE_AREA_PATTERN =
  /\b(face|facial|head|forehead|temple|eyebrow|eyelid|eye|nose|nostril|septum|bridge|cheek|lip|labret|philtrum|medusa|chin|jaw|tongue|smiley|dimple|ear|helix|lobe|conch|tragus|daith|rook|industrial|snug)\b/i;

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

function normalizeImage(row) {
  if (!row) return null;
  const category = resolveGalleryCategory(row);
  return {
    id: String(row.id),
    title: row.title || 'Untitled Work',
    category,
    subcategory: category,
    bodyPart: row.bodyPart || row.body_part || '',
    imageUrl: row.imageUrl || row.image_url || '',
    thumbnailUrl: row.thumbnailUrl || row.thumbnail_url || row.imageUrl || row.image_url || '',
    altText: row.altText || row.alt_text || '',
    isPublished: row.isPublished !== undefined
      ? Boolean(row.isPublished)
      : (row.is_published !== undefined ? Boolean(row.is_published) : true),
    displayOrder: Number(row.displayOrder ?? row.display_order ?? 0),
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    updatedAt: row.updatedAt || row.updated_at || new Date().toISOString()
  };
}

/**
 * Get all gallery images (Admin view) with filter stats
 */
async function getAllImagesAdmin(filters = {}) {
  const client = getSupabase();
  let list = [];

  const { data, error } = await client
    .from(GALLERY_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[galleryStore] Supabase fetch error:', error.message);
  } else {
    list = (data || []).map(normalizeImage);
  }

  const category = (filters.category || 'all').toLowerCase();
  const visibility = (filters.visibility || 'all').toLowerCase();
  const sort = filters.sort || 'newest';

  const total = list.length;
  const publishedCount = list.filter((i) => i.isPublished).length;
  const hiddenCount = total - publishedCount;

  let filtered = list.filter((img) => {
    if (category !== 'all' && img.category.toLowerCase() !== category) return false;
    if (visibility === 'published' && !img.isPublished) return false;
    if (visibility === 'hidden' && img.isPublished) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (sort === 'title') return a.title.localeCompare(b.title);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return {
    images: filtered,
    stats: { total, published: publishedCount, hidden: hiddenCount }
  };
}

/**
 * Get published images for public gallery
 */
async function getPublishedImages(category = 'all') {
  const client = getSupabase();
  let query = client
    .from(GALLERY_TABLE)
    .select('*')
    .eq('is_published', true)
    .order('display_order', { ascending: true });

  if (category && category !== 'all') {
    query = query.ilike('category', `%${category}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[galleryStore] Published gallery fetch error:', error.message);
    return [];
  }

  return (data || []).map(normalizeImage);
}

/**
 * Get a single image by ID
 */
async function getImageById(id) {
  const client = getSupabase();
  const { data, error } = await client
    .from(GALLERY_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeImage(data);
}

/**
 * Create a new gallery image in Supabase
 */
async function createImage(data) {
  const client = getSupabase();
  const id = data.id || crypto.randomUUID();
  const category = resolveGalleryCategory(data);

  const dbPayload = {
    id,
    title: (data.title || 'New Studio Work').trim(),
    category,
    subcategory: category,
    body_part: (data.bodyPart || data.body_part || '').trim(),
    image_url: data.imageUrl || data.image_url || '',
    thumbnail_url: data.thumbnailUrl || data.thumbnail_url || data.imageUrl || '',
    alt_text: (data.altText || data.alt_text || '').trim(),
    is_published: data.isPublished !== undefined ? Boolean(data.isPublished) : true,
    display_order: Number(data.displayOrder ?? data.display_order ?? 0),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data: created, error } = await client
    .from(GALLERY_TABLE)
    .insert([dbPayload])
    .select()
    .single();

  if (error) {
    console.error('[galleryStore] Supabase insert failed:', error.message);
    throw new Error(`Failed to save gallery work to Supabase: ${error.message}`);
  }

  const normalized = normalizeImage(created || dbPayload);
  notifyChangeListeners('create', normalized);
  return normalized;
}

/**
 * Update an existing gallery image
 */
async function updateImage(id, updates) {
  const client = getSupabase();
  const dbPayload = { updated_at: new Date().toISOString() };

  if (updates.title !== undefined) dbPayload.title = updates.title.trim();
  if (updates.category !== undefined) {
    const category = resolveGalleryCategory(updates);
    dbPayload.category = category;
    dbPayload.subcategory = category;
  }
  if (updates.bodyPart !== undefined || updates.body_part !== undefined) {
    dbPayload.body_part = (updates.bodyPart ?? updates.body_part).trim();
  }
  if (updates.imageUrl !== undefined || updates.image_url !== undefined) {
    const img = updates.imageUrl ?? updates.image_url;
    dbPayload.image_url = img;
    dbPayload.thumbnail_url = updates.thumbnailUrl ?? updates.thumbnail_url ?? img;
  }
  if (updates.altText !== undefined || updates.alt_text !== undefined) {
    dbPayload.alt_text = (updates.altText ?? updates.alt_text).trim();
  }
  if (updates.isPublished !== undefined || updates.is_published !== undefined) {
    dbPayload.is_published = Boolean(updates.isPublished ?? updates.is_published);
  }
  if (updates.displayOrder !== undefined || updates.display_order !== undefined) {
    dbPayload.display_order = Number(updates.displayOrder ?? updates.display_order);
  }

  const { data: updated, error } = await client
    .from(GALLERY_TABLE)
    .update(dbPayload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(`[galleryStore] Supabase update failed for ${id}:`, error.message);
    throw new Error(`Failed to update gallery image: ${error.message}`);
  }

  const normalized = normalizeImage(updated || { id, ...dbPayload });
  notifyChangeListeners('update', normalized);
  return normalized;
}

/**
 * Delete a gallery image
 */
async function deleteImage(id) {
  const client = getSupabase();
  const { error } = await client
    .from(GALLERY_TABLE)
    .delete()
    .eq('id', id);

  if (error) {
    console.error(`[galleryStore] Supabase delete failed for ${id}:`, error.message);
    return false;
  }

  notifyChangeListeners('delete', { id });
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
