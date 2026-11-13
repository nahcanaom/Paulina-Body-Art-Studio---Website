'use strict';
const demo = require('./demoContent');

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_URL = 'https://celusvfynfnszmhjgqwj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_NlHs6PG9x_HHfCDUKOlArQ_pM41Bn7g';
const CATALOGUE_TABLE = 'jewelry_catalogue';

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
      console.warn('[catalogueStore] Listener notification error:', err?.message || err);
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

function normalizeItem(row) {
  if (!row) return null;

  const rawSizes = row.sizes || row.available_sizes;
  let parsedSizes = ['4mm', '3mm', '2mm'];
  if (Array.isArray(rawSizes)) {
    parsedSizes = rawSizes.map(String);
  } else if (typeof rawSizes === 'string') {
    try {
      const parsed = JSON.parse(rawSizes);
      if (Array.isArray(parsed)) parsedSizes = parsed.map(String);
      else parsedSizes = rawSizes.split(',').map((s) => s.trim()).filter(Boolean);
    } catch {
      parsedSizes = rawSizes.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  const name = row.name || row.title || 'Untitled Piercing';
  const img = row.imageUrl || row.image_url || row.image || '';
  const thumb = row.thumbnailUrl || row.thumbnail_url || row.thumbnail || img;

  let images = row.images;
  if (!Array.isArray(images) || images.length === 0) {
    images = img ? [img] : [];
  }

  return {
    id: String(row.id),
    name,
    title: name,
    category: row.category || 'Ear',
    subcategory: row.subcategory || 'Helix',
    material: row.material || 'ASTM F136 Titanium',
    price: Number(row.price ?? 600),
    sizes: parsedSizes.length > 0 ? parsedSizes : ['4mm', '3mm', '2mm'],
    activeSize: row.activeSize || row.active_size || parsedSizes[0] || '4mm',
    socialMedia: row.socialMedia || row.social_media || 'Instagram',
    socialOrderUrl: row.socialOrderUrl || row.social_order_url || '',
    imageUrl: img,
    thumbnailUrl: thumb,
    images,
    isPublished: row.isPublished !== undefined
      ? Boolean(row.isPublished)
      : (row.is_published !== undefined ? Boolean(row.is_published) : (row.is_active !== undefined ? Boolean(row.is_active) : true)),
    displayOrder: Number(row.displayOrder ?? row.display_order ?? 0),
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    updatedAt: row.updatedAt || row.updated_at || new Date().toISOString()
  };
}

/**
 * Get all catalogue items (Admin view) with filter stats
 */
async function getAllCatalogueAdmin(filters = {}) {
  const client = getSupabase();
  let list = [];

  const { data, error } = await client
    .from(CATALOGUE_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[catalogueStore] Supabase fetch error:', error.message);
  } else {
    list = (data || []).map(normalizeItem);
  }

  const category = (filters.category || 'all').toLowerCase();
  const visibility = (filters.visibility || 'all').toLowerCase();
  const search = (filters.search || '').trim().toLowerCase();
  const sort = filters.sort || 'newest';

  const total = list.length;
  const publishedCount = list.filter((i) => i.isPublished).length;
  const hiddenCount = total - publishedCount;

  let filtered = list.filter((item) => {
    if (category !== 'all' && item.category.toLowerCase() !== category) return false;
    if (visibility === 'published' && !item.isPublished) return false;
    if (visibility === 'hidden' && item.isPublished) return false;
    if (search) {
      const matchName = item.name.toLowerCase().includes(search);
      const matchCat = item.category.toLowerCase().includes(search);
      const matchSub = (item.subcategory || '').toLowerCase().includes(search);
      const matchMat = (item.material || '').toLowerCase().includes(search);
      if (!matchName && !matchCat && !matchSub && !matchMat) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (sort === 'title') return a.name.localeCompare(b.name);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return {
    items: filtered,
    stats: { total, published: publishedCount, hidden: hiddenCount }
  };
}

/**
 * Get only published items for public catalogue page
 */
async function getPublishedCatalogue(category = 'all') {
  if (demo.isDemo()) return demo.filter(demo.catalogue(), category);
  const client = getSupabase();
  let query = client
    .from(CATALOGUE_TABLE)
    .select('*')
    .eq('is_published', true)
    .order('display_order', { ascending: true });

  if (category && category !== 'all') {
    query = query.ilike('category', category);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[catalogueStore] Published items error:', error.message);
    return [];
  }

  return (data || []).map(normalizeItem);
}

/**
 * Get a single catalogue item by ID
 */
async function getCatalogueItemById(id) {
  const client = getSupabase();
  const { data, error } = await client
    .from(CATALOGUE_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeItem(data);
}

/**
 * Create a new catalogue item in Supabase
 */
async function createCatalogueItem(data) {
  const client = getSupabase();
  const id = data.id || crypto.randomUUID();
  const name = (data.name || data.title || 'Untitled Piercing').trim();
  const rawSizes = Array.isArray(data.sizes) ? data.sizes : ['4mm', '3mm', '2mm'];
  const activeSize = data.activeSize || rawSizes[0] || '4mm';
  const img = data.imageUrl || data.image || '';

  const dbPayload = {
    id,
    name,
    title: name,
    category: data.category || 'Ear',
    subcategory: data.subcategory || 'Helix',
    material: data.material || 'ASTM F136 Titanium',
    price: Number(data.price ?? 600),
    sizes: rawSizes,
    active_size: activeSize,
    social_media: data.socialMedia || 'Instagram',
    social_order_url: data.socialOrderUrl || '',
    image_url: img,
    thumbnail_url: data.thumbnailUrl || img,
    images: Array.isArray(data.images) && data.images.length > 0 ? data.images : [img],
    is_published: data.isPublished !== undefined ? Boolean(data.isPublished) : true,
    is_active: data.isPublished !== undefined ? Boolean(data.isPublished) : true,
    display_order: Number(data.displayOrder ?? 0),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data: created, error } = await client
    .from(CATALOGUE_TABLE)
    .insert([dbPayload])
    .select()
    .single();

  if (error) {
    console.error('[catalogueStore] Insert to Supabase error:', error.message);
    throw new Error(`Failed to save catalogue item to Supabase: ${error.message}`);
  }

  const normalized = normalizeItem(created || dbPayload);
  notifyChangeListeners('create', normalized);
  return normalized;
}

/**
 * Update an existing catalogue item
 */
async function updateCatalogueItem(id, updates) {
  const client = getSupabase();
  const dbPayload = { updated_at: new Date().toISOString() };

  if (updates.name !== undefined || updates.title !== undefined) {
    const val = (updates.name ?? updates.title).trim();
    dbPayload.title = val;
    dbPayload.name = val;
  }
  if (updates.category !== undefined) dbPayload.category = updates.category;
  if (updates.subcategory !== undefined) dbPayload.subcategory = updates.subcategory;
  if (updates.material !== undefined) dbPayload.material = updates.material;
  if (updates.price !== undefined) dbPayload.price = Number(updates.price);
  if (updates.sizes !== undefined) {
    dbPayload.sizes = Array.isArray(updates.sizes) ? updates.sizes : [updates.sizes];
  }
  if (updates.activeSize !== undefined) dbPayload.active_size = updates.activeSize;
  if (updates.socialMedia !== undefined) dbPayload.social_media = updates.socialMedia;
  if (updates.socialOrderUrl !== undefined) dbPayload.social_order_url = updates.socialOrderUrl;
  if (updates.imageUrl !== undefined) {
    dbPayload.image_url = updates.imageUrl;
    dbPayload.thumbnail_url = updates.thumbnailUrl || updates.imageUrl;
    dbPayload.images = [updates.imageUrl];
  }
  if (updates.isPublished !== undefined) {
    dbPayload.is_published = Boolean(updates.isPublished);
    dbPayload.is_active = Boolean(updates.isPublished);
  }
  if (updates.displayOrder !== undefined) dbPayload.display_order = Number(updates.displayOrder);

  const { data: updated, error } = await client
    .from(CATALOGUE_TABLE)
    .update(dbPayload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(`[catalogueStore] Supabase update failed for ${id}:`, error.message);
    throw new Error(`Failed to update catalogue item: ${error.message}`);
  }

  const normalized = normalizeItem(updated || { id, ...dbPayload });
  notifyChangeListeners('update', normalized);
  return normalized;
}

/**
 * Delete a catalogue item
 */
async function deleteCatalogueItem(id) {
  const client = getSupabase();
  const { error } = await client
    .from(CATALOGUE_TABLE)
    .delete()
    .eq('id', id);

  if (error) {
    console.error(`[catalogueStore] Supabase delete failed for ${id}:`, error.message);
    return false;
  }

  notifyChangeListeners('delete', { id });
  return true;
}

module.exports = {
  getAllCatalogueAdmin,
  getPublishedCatalogue,
  getCatalogueItemById,
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem,
  registerChangeListener
};
