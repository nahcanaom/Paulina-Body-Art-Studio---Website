'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LOCAL_CATALOGUE_FILE = path.join(DATA_DIR, 'catalogue.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads', 'catalogue');

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
      console.warn('[catalogueStore] Listener notification error:', err?.message || err);
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
  console.warn(`[catalogueStore] Supabase marked unavailable for ${SUPABASE_RETRY_AFTER_MS / 1000}s: ${reason}`);
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

async function readLocalCatalogue() {
  try {
    const raw = await fs.readFile(LOCAL_CATALOGUE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(LOCAL_CATALOGUE_FILE, '[]\n', 'utf8');
      return [];
    }
    console.warn('[catalogueStore] Error reading local catalogue file:', err.message);
    return [];
  }
}

async function writeLocalCatalogue(items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LOCAL_CATALOGUE_FILE, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

/**
 * Normalise row mapping between DB (snake_case) and App (camelCase)
 */
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
    imageUrl: img,
    thumbnailUrl: thumb,
    images,
    isPublished: row.isPublished !== undefined ? Boolean(row.isPublished) : (row.is_published !== undefined ? Boolean(row.is_published) : true),
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

  if (client) {
    try {
      const query = client.from('jewelry_catalogue').select('*').order('created_at', { ascending: false });
      const { data, error } = await withTimeout(query, SUPABASE_TIMEOUT_MS, 'Supabase catalogue fetch');
      if (error) throw error;
      list = (data || []).map(normalizeItem);
    } catch (err) {
      markSupabaseUnavailable(err?.message || 'Query failed');
      list = (await readLocalCatalogue()).map(normalizeItem);
    }
  } else {
    list = (await readLocalCatalogue()).map(normalizeItem);
  }

  // Summary counts
  const total = list.length;
  const published = list.filter((i) => i.isPublished).length;
  const draft = total - published;
  const ear = list.filter((i) => (i.category || '').toLowerCase() === 'ear').length;
  const facial = list.filter((i) => (i.category || '').toLowerCase() === 'facial').length;
  const oral = list.filter((i) => (i.category || '').toLowerCase() === 'oral').length;
  const body = list.filter((i) => (i.category || '').toLowerCase() === 'body').length;

  let filtered = [...list];

  // Category filter
  if (filters.category && filters.category !== 'all') {
    const cat = filters.category.toLowerCase().trim();
    filtered = filtered.filter((i) => (i.category || '').toLowerCase().includes(cat));
  }

  // Visibility filter
  if (filters.visibility && filters.visibility !== 'all') {
    const isPub = filters.visibility === 'published';
    filtered = filtered.filter((i) => i.isPublished === isPub);
  }

  // Search filter
  if (filters.search) {
    const term = filters.search.toLowerCase().trim();
    filtered = filtered.filter(
      (i) =>
        i.name.toLowerCase().includes(term) ||
        i.title.toLowerCase().includes(term) ||
        i.subcategory.toLowerCase().includes(term) ||
        i.category.toLowerCase().includes(term) ||
        i.material.toLowerCase().includes(term)
    );
  }

  // Sorting
  if (filters.sort === 'oldest') {
    filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else if (filters.sort === 'name' || filters.sort === 'title' || filters.sort === 'az') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else if (filters.sort === 'za') {
    filtered.sort((a, b) => b.name.localeCompare(a.name));
  } else if (filters.sort === 'price-low') {
    filtered.sort((a, b) => a.price - b.price);
  } else if (filters.sort === 'price-high') {
    filtered.sort((a, b) => b.price - a.price);
  } else {
    // Default newest first
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return {
    items: filtered,
    stats: { total, published, draft, ear, facial, oral, body }
  };
}

/**
 * Get published catalogue items for user-facing website
 */
async function getPublishedCatalogue(category) {
  const client = getSupabase();
  let list = [];

  if (client) {
    try {
      let query = client
        .from('jewelry_catalogue')
        .select('*')
        .eq('is_published', true)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (category && category !== 'all') {
        query = query.ilike('category', `%${category}%`);
      }
      const { data, error } = await withTimeout(query, SUPABASE_TIMEOUT_MS, 'Supabase published catalogue');
      if (error) throw error;
      list = (data || []).map(normalizeItem);
    } catch (err) {
      markSupabaseUnavailable(err?.message || 'Query failed');
      const all = await readLocalCatalogue();
      list = all.filter((i) => i.isPublished).map(normalizeItem);
    }
  } else {
    const all = await readLocalCatalogue();
    list = all.filter((i) => i.isPublished).map(normalizeItem);
  }

  if (category && category !== 'all') {
    const cat = category.toLowerCase().trim();
    list = list.filter((i) => (i.category || '').toLowerCase().includes(cat));
  }

  return list;
}

/**
 * Get item by ID
 */
async function getCatalogueItemById(id) {
  if (!id) return null;
  const items = await readLocalCatalogue();
  const found = items.find((i) => String(i.id) === String(id));
  return found ? normalizeItem(found) : null;
}

/**
 * Create a new catalogue item
 */
async function createCatalogueItem(payload) {
  const name = (payload.name || payload.title || 'New Studio Work').trim();
  const item = {
    id: payload.id || `cat-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    name,
    title: name,
    category: payload.category || 'Ear',
    subcategory: payload.subcategory || 'Helix',
    material: payload.material || 'ASTM F136 Titanium',
    price: Number(payload.price ?? 600),
    sizes: Array.isArray(payload.sizes) && payload.sizes.length > 0 ? payload.sizes : ['4mm', '3mm', '2mm'],
    activeSize: payload.activeSize || (Array.isArray(payload.sizes) && payload.sizes[0]) || '4mm',
    socialMedia: payload.socialMedia || 'Instagram',
    imageUrl: payload.imageUrl || '',
    thumbnailUrl: payload.thumbnailUrl || payload.imageUrl || '',
    images: Array.isArray(payload.images) && payload.images.length > 0 ? payload.images : [payload.imageUrl || ''],
    isPublished: payload.isPublished !== undefined ? Boolean(payload.isPublished) : true,
    displayOrder: Number(payload.displayOrder || 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await enqueue(async () => {
    const list = await readLocalCatalogue();
    list.unshift(item);
    await writeLocalCatalogue(list);
  });

  const client = getSupabase();
  if (client) {
    try {
      await client.from('jewelry_catalogue').insert({
        id: item.id,
        title: item.name,
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        material: item.material,
        price: item.price,
        sizes: item.sizes,
        social_media: item.socialMedia,
        image_url: item.imageUrl,
        is_published: item.isPublished,
        display_order: item.displayOrder,
        created_at: item.createdAt,
        updated_at: item.updatedAt
      });
    } catch (err) {
      console.warn('[catalogueStore] Supabase insert failed (saved locally):', err?.message);
    }
  }

  notifyChangeListeners('create', item);
  return item;
}

/**
 * Update an existing catalogue item
 */
async function updateCatalogueItem(id, updates) {
  let updated = null;

  await enqueue(async () => {
    const list = await readLocalCatalogue();
    const idx = list.findIndex((i) => String(i.id) === String(id));
    if (idx === -1) return;

    const current = list[idx];
    const newName = updates.name !== undefined ? updates.name.trim() : (updates.title !== undefined ? updates.title.trim() : current.name);

    list[idx] = {
      ...current,
      ...updates,
      id: current.id, // preserve ID
      name: newName,
      title: newName,
      updatedAt: new Date().toISOString()
    };

    if (updates.sizes !== undefined) {
      list[idx].sizes = Array.isArray(updates.sizes) ? updates.sizes : [updates.sizes];
    }
    if (updates.isPublished !== undefined) {
      list[idx].isPublished = Boolean(updates.isPublished);
    }

    updated = normalizeItem(list[idx]);
    await writeLocalCatalogue(list);
  });

  if (!updated) return null;

  const client = getSupabase();
  if (client) {
    try {
      const dbPayload = { updated_at: updated.updatedAt };
      if (updates.name !== undefined) {
        dbPayload.title = updates.name;
        dbPayload.name = updates.name;
      }
      if (updates.category !== undefined) dbPayload.category = updates.category;
      if (updates.subcategory !== undefined) dbPayload.subcategory = updates.subcategory;
      if (updates.material !== undefined) dbPayload.material = updates.material;
      if (updates.price !== undefined) dbPayload.price = updates.price;
      if (updates.sizes !== undefined) dbPayload.sizes = updates.sizes;
      if (updates.socialMedia !== undefined) dbPayload.social_media = updates.socialMedia;
      if (updates.imageUrl !== undefined) dbPayload.image_url = updates.imageUrl;
      if (updates.isPublished !== undefined) dbPayload.is_published = Boolean(updates.isPublished);
      if (updates.displayOrder !== undefined) dbPayload.display_order = Number(updates.displayOrder);

      await client.from('jewelry_catalogue').update(dbPayload).eq('id', id);
    } catch (err) {
      console.warn('[catalogueStore] Supabase update failed (updated locally):', err?.message);
    }
  }

  notifyChangeListeners('update', updated);
  return updated;
}

/**
 * Delete a catalogue item and backing file
 */
async function deleteCatalogueItem(id) {
  let deletedItem = null;

  await enqueue(async () => {
    const list = await readLocalCatalogue();
    const idx = list.findIndex((i) => String(i.id) === String(id));
    if (idx === -1) return;

    deletedItem = list.splice(idx, 1)[0];
    await writeLocalCatalogue(list);
  });

  if (!deletedItem) return false;

  // Clean up uploaded image file if stored locally in catalogue uploads
  if (deletedItem.imageUrl && deletedItem.imageUrl.startsWith('/uploads/catalogue/')) {
    const filename = path.basename(deletedItem.imageUrl);
    const filePath = path.join(UPLOADS_DIR, filename);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[catalogueStore] Could not unlink file:', filePath, err.message);
      }
    }
  }

  const client = getSupabase();
  if (client) {
    try {
      await client.from('jewelry_catalogue').delete().eq('id', id);
    } catch (err) {
      console.warn('[catalogueStore] Supabase delete failed:', err?.message);
    }
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

