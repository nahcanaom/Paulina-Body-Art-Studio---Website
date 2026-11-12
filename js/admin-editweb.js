/**
 * PAULINA Body Art Studio — "Edit Website" controller
 * ===================================================
 *
 * One admin controller for every public content section:
 *   Hero & Home  -> site_settings('home') + hero banner cards
 *   Gallery      -> gallery_images + studio-gallery Storage bucket
 *   Catalogue    -> jewelry_catalogue + jewelry-catalog Storage bucket
 *   Artists      -> artist_profiles + studio-gallery/artists
 *                   Favorite Works are site_images rows (section
 *                   'artist-favorites') grouped by artist_id, so run
 *                   docs/migrations/add_favorite_works_artist_link.sql once.
 *   FAQs         -> faqs (general categories)
 *   Aftercare    -> faqs (Aftercare category) + site_images
 *   Booking Info -> site_settings('booking') + site_images
 *
 * Tab data is fetched lazily: the first time a tab becomes active, and again
 * only when a refresh button or a successful write asks for it.
 *
 * Required schema and storage policies live in:
 *   docs/migrations/create_admin_editweb_tables.sql
 */

import { supabase } from './supabase-config.js';

/* ==========================================================================
   CONFIGURATION
   ========================================================================== */

const TABLES = {
  gallery: 'gallery_images',
  galleryFallback: 'gallery_items',
  catalogue: 'jewelry_catalogue',
  artists: 'artist_profiles',
  faqs: 'faqs',
  siteImages: 'site_images',
  settings: 'site_settings'
};

const SITE_IMAGE_SECTIONS = [
  ['home-studio', 'Home \u2014 Studio photos'],
  ['home-services', 'Home \u2014 Best services'],
  ['home-artists', 'Home \u2014 Artist portraits'],
  ['artist-favorites', 'Artist page \u2014 Favorite Works'],
  ['pricelist', 'Home \u2014 Piercing price list'],
  ['booking-qr', 'Booking \u2014 GCash QR code'],
  ['booking-qr-maya', 'Booking \u2014 Maya QR code'],
  ['booking-qr-bpi', 'Booking \u2014 BPI QR code'],
  ['booking-qr-gotyme', 'Booking \u2014 GoTyme QR code'],
  ['booking-qr-maribank', 'Booking \u2014 Maribank QR code'],
  ['booking-side', 'Booking \u2014 Details sidebar image'],
  ['booking-payment-side', 'Booking \u2014 Payment sidebar image'],
  ['aftercare-hero-tattoo', 'Aftercare \u2014 Tattoo hero image'],
  ['aftercare-hero-piercing', 'Aftercare \u2014 Piercing hero image'],
  ['aftercare-guide', 'Aftercare \u2014 Piercing guide image'],
  ['aftercare-neilmed', 'Aftercare \u2014 NeilMed image'],
  ['aftercare-downsizing', 'Aftercare \u2014 Downsizing image']
];

/**
 * Sections whose public markup ships bundled artwork and keeps showing it until
 * an admin uploads a replacement (see data-site-image-fallback in the booking
 * page). The editor lists these built-in defaults so it reflects exactly what
 * visitors see instead of reporting the area as empty.
 */
const BUNDLED_SECTION_IMAGES = {
  'booking-qr': {
    imageUrl: '../../assets/images/qr-gcash.jpeg',
    title: 'GCash QR code',
    alt: 'GCash QR code',
    description: 'The built-in QR code is live on the booking page until you add your own image.'
  },
  'booking-qr-maya': {
    imageUrl: '../../assets/images/qr-maya.jpeg',
    title: 'Maya QR code',
    alt: 'Maya QR code',
    description: 'The built-in QR code is live on the booking page until you add your own image.'
  },
  'booking-qr-bpi': {
    imageUrl: '../../assets/images/qr-bpi.jpeg',
    title: 'BPI QR code',
    alt: 'BPI QR code',
    description: 'The built-in QR code is live on the booking page until you add your own image.'
  },
  'booking-qr-gotyme': {
    imageUrl: '../../assets/images/qr-gotyme.jpeg',
    title: 'GoTyme QR code',
    alt: 'GoTyme QR code',
    description: 'The built-in QR code is live on the booking page until you add your own image.'
  },
  'booking-qr-maribank': {
    imageUrl: '../../assets/images/qr-maribank.jpeg',
    title: 'Maribank QR code',
    alt: 'Maribank QR code',
    description: 'The built-in QR code is live on the booking page until you add your own image.'
  }
};

const BUCKETS = {
  gallery: 'studio-gallery',
  catalogue: 'jewelry-catalog'
};

// Gallery and catalogue media are managed by the Express API so the admin
// panel and the public pages always read and write the same store.
const GALLERY_API = window.paulinaApiUrl('/api/admin/gallery');
const CATALOGUE_API = window.paulinaApiUrl('/api/admin/catalogue');

// Six-dot handle used on every reorderable card and row. Order is changed by
// dragging these, so the editors no longer expose a numeric display order.
const ADMIN_CARD_DRAG_HANDLE = `
  <span class="admin-edit-card__drag" aria-hidden="true" title="Drag to reorder">
    <i class="ph ph-dots-six-vertical"></i>
  </span>`;

/**
 * Reorder a full list from the subset visible in a filtered grid: the dragged
 * items take the slots their group occupied, so hidden items keep their place.
 */
function applyPartialOrder(fullList, visibleIds) {
  const visible = new Set(visibleIds);
  if (!visible.size) return null;

  const slots = [];
  fullList.forEach((item, index) => {
    if (visible.has(item.id)) slots.push(index);
  });
  if (slots.length !== visible.size) return null;

  const byId = new Map(fullList.map((item) => [item.id, item]));
  const next = fullList.slice();
  slots.forEach((slot, index) => {
    next[slot] = byId.get(visibleIds[index]);
  });
  return next;
}

const TAB_IDS = [
  'hero-tab',
  'gallery-tab',
  'catalogue-tab',
  'reviews-tab',
  'artist-tab',
  'faqs-tab',
  'aftercare-tab',
  'booking-tab'
];

const TAB_SLUGS = {
  'hero-tab': 'home',
  'gallery-tab': 'gallery',
  'catalogue-tab': 'catalogue',
  'reviews-tab': 'reviews',
  'artist-tab': 'artist',
  'faqs-tab': 'faqs',
  'aftercare-tab': 'aftercare',
  'booking-tab': 'booking'
};

const PAGE_HEADERS = {
  'hero-tab': {
    title: 'Home Page',
    subtitle: 'Manage the homepage carousel, page copy, contact details and images.'
  },
  'gallery-tab': {
    title: 'Gallery',
    subtitle: 'Upload, tag and publish the work shown in the public gallery.'
  },
  'catalogue-tab': {
    title: 'Catalogue',
    subtitle: 'Manage the catalogue shown on the public site.'
  },
  'reviews-tab': {
    title: 'Reviews & Testimonials',
    subtitle: 'Read, edit, hide or delete the client reviews shown on the public site.'
  },
  'artist-tab': {
    title: 'Artists',
    subtitle: 'Manage resident profiles and the images shown on the artist page.'
  },
  'aftercare-tab': {
    title: 'Aftercare',
    subtitle: 'Manage the aftercare FAQs and the images shown on the tattoo and piercing guides.'
  },
  'faqs-tab': {
    title: 'FAQs',
    subtitle: 'Manage the questions and answers shown on the public FAQs page.'
  },
  'booking-tab': {
    title: 'Booking Info',
    subtitle: 'Manage booking guidance, policies and the images shown during booking.'
  }
};

// The gallery CMS offers exactly the four public sections, grouped under the two
// gallery tabs: TATTOOS -> Face Tattoo, Body Tattoo; PIERCING -> Face Piercing,
// Body Piercing. The subcategory column stores the same value, which keeps the
// API and older rows compatible.
const GALLERY_SECTIONS = ['Face Tattoo', 'Body Tattoo', 'Face Piercing', 'Body Piercing'];
const GALLERY_SUBCATEGORIES = Object.fromEntries(
  GALLERY_SECTIONS.map((section) => [section, [section]])
);

// Head and face placements belong to the face section. Word boundaries keep
// "forearm" from matching "ear".
const FACE_AREA_PATTERN =
  /\b(face|facial|head|forehead|temple|eyebrow|eyelid|eye|nose|nostril|septum|bridge|cheek|lip|labret|philtrum|medusa|chin|jaw|tongue|smiley|dimple|ear|helix|lobe|conch|tragus|daith|rook|industrial|snug)\b/i;

const GALLERY_BODY_PARTS = [
  {
    label: 'Head & face',
    options: [
      'Face', 'Forehead', 'Temple', 'Eyebrow', 'Eyelid', 'Nose', 'Nostril',
      'Septum', 'Septum & Nostril', 'Bridge', 'Cheek', 'Lip', 'Labret',
      'Philtrum', 'Medusa', 'Chin', 'Jaw', 'Tongue', 'Smiley', 'Dimples'
    ]
  },
  {
    label: 'Ear',
    options: [
      'Ear', 'Earlobe', 'Lobe', 'Helix', 'Forward helix', 'Flat', 'Conch',
      'Tragus', 'Daith', 'Rook', 'Industrial', 'Snug', 'Helix & Lobe',
      'Behind ear'
    ]
  },
  {
    label: 'Body',
    options: [
      'Neck', 'Nape', 'Throat', 'Collarbone', 'Chest', 'Sternum', 'Shoulder',
      'Upper arm', 'Forearm', 'Wrist', 'Hand', 'Finger', 'Upper back', 'Spine',
      'Lower back', 'Ribs', 'Waist', 'Stomach', 'Hip', 'Thigh', 'Calf', 'Ankle',
      'Foot', 'Navel', 'Navel piercing', 'Nipple', 'Dermal'
    ]
  }
];

// Predictions for the artist Specialties combobox. Suggestions from the
// existing artist rows are appended at runtime so the list grows with the studio.
const SPECIALTY_GROUPS = [
  {
    label: 'Piercing',
    options: [
      'Precision Body Piercing', 'Curated Ear Styling', 'Ear Curation',
      'Septum Piercing', 'Nostril Piercing', 'Lip Piercing', 'Navel Piercing',
      'Dermal Piercing', 'Surface Piercing', 'Cartilage Piercing',
      'Implant-grade Titanium', '14k Solid Gold Jewellery', 'Jewelry Styling',
      'Downsizing & Aftercare'
    ]
  },
  {
    label: 'Tattoo',
    options: [
      'Fine-line Tattoos', 'Custom Tattoo Artistry', 'Blackwork Tattoos',
      'Color Tattoos', 'Realism Tattoos', 'Minimalist Tattoos', 'Lettering Tattoos',
      'Floral Tattoos', 'Traditional Tattoos', 'Neo-traditional Tattoos',
      'Micro Tattoos', 'Cover-up Tattoos'
    ]
  },
  {
    label: 'Studio',
    options: [
      'Custom Design Consultation', 'Sterile Technique',
      'Body Modification', 'Piercing Consultation'
    ]
  }
];

const DEFAULT_CONFIRM_LABEL = 'Delete';
const AFTERCARE_FAQ_CATEGORY = 'aftercare';
const FAVORITE_WORKS_SECTION = 'artist-favorites';

/* ==========================================================================
   DEFAULTS
   ========================================================================== */

function homeDefaults() {
  return {
    announcement: '',
    eyebrow: 'Piercing & Tattoo Studio',
    headline1: 'INK',
    headline2: 'PIERCE',
    headline3: 'EXPRESS',
    description: '\u201cFearfully and wonderfully made.\u201d',
    quoteAttribution: 'Psalm 139:14',
    hours: {
      weekdays: '10:00 AM \u2013 8:00 PM',
      saturday: '10:00 AM \u2013 9:00 PM',
      sunday: 'By appointment only',
      note: 'Walk-ins are subject to availability.'
    },
    contact: {
      email: 'paulinabodyartstudio@gmail.com',
      phone: '0951 741 7630',
      address: 'Paulina Body Art Studio, P3R6+WCW, Ilang-ilang, Novaliches, Caloocan, Metro Manila',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Paulina%20Body%20Art%20Studio',
      instagram: 'https://www.instagram.com/paulinabodyart/',
      facebook: 'https://www.facebook.com/PaulinaBodyArtStudio',
      tiktok: 'https://www.tiktok.com/@paulinabodyart'
    },
    banners: []
  };
}

function bookingDefaults() {
  return {
    intro: 'Choose your service, date and time, then submit the form to request an appointment.',
    depositAmount: '500',
    leadTime: 'Up to 60 days in advance',
    depositNote: 'A reservation deposit is required to secure your appointment and is deducted from the final bill.',
    cancellationPolicy: 'Booking deposits are non-refundable. Cancellations made within 24 hours require a new deposit to rebook.',
    reschedulePolicy: 'Rescheduling requests must be sent at least 48 hours before your appointment. You may reschedule once.',
    paymentMethods: 'GCash, Maya, bank transfer, cash',
    arrivalInstructions: 'Please arrive 10 minutes early. Clients arriving 15 minutes late may be charged a late fee.',
    contactEmail: 'paulinabodyartstudio@gmail.com',
    contactPhone: '0951 741 7630'
  };
}

/* ==========================================================================
   STATE
   ========================================================================== */

const state = {
  loaded: {
    'hero-tab': false,
    'gallery-tab': false,
    'catalogue-tab': false,
    'artist-tab': false,
    'faqs-tab': false,
    'booking-tab': false
  },
  siteImagesLoaded: false,
  siteImagesAvailable: true,
  favoriteArtistLinkAvailable: true,
  home: homeDefaults(),
  booking: bookingDefaults(),
  gallery: [],
  catalogue: [],
  artists: [],
  faqs: [],
  siteImages: [],
  galleryTable: '',
  editing: {
    banner: null,
    gallery: null,
    catalogue: null,
    artist: null,
    faq: null,
    siteImage: null
  },
  filters: {
    gallery: { search: '', category: 'all', visibility: 'all' },
    catalogue: { search: '', category: 'all', visibility: 'all' }
  },
  confirmAction: null,
  gallerySearchTimer: null,
  catalogueSearchTimer: null,
  galleryBodyPart: {
    activeIndex: -1,
    options: [],
    legacy: ''
  },
  artistSpecialties: {
    activeIndex: -1,
    options: [],
    selected: []
  },
  toastTimer: null
};

/* ==========================================================================
   SMALL DOM / FORMAT HELPERS
   ========================================================================== */

const byId = (id) => document.getElementById(id);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const valueOf = (id) => byId(id)?.value ?? '';

function setValue(id, value) {
  const node = byId(id);
  if (node) node.value = value == null ? '' : String(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const escapeAttr = escapeHtml;

/**
 * Delay `fn` until the caller stops firing for `wait` milliseconds.
 * The returned function exposes `cancel()` so pending work can be dropped,
 * for example when a dropdown closes.
 */
function debounce(fn, wait = 160) {
  let timer = null;

  const debounced = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };

  debounced.cancel = () => {
    window.clearTimeout(timer);
    timer = null;
  };

  return debounced;
}

function nowIso() {
  return new Date().toISOString();
}

function cryptoId(prefix = 'item') {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function filenameToTitle(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'New studio work';
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return 'Price on request';
  return `\u20b1${price.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
}

function imageOrFallback(url, fallback = '../../assets/images/fave1.png') {
  const value = String(url || '').trim();
  if (!value) return fallback;
  return window.paulinaMediaUrl ? window.paulinaMediaUrl(value) : value;
}

function sortByOrder(items) {
  return [...items].sort((a, b) => {
    const orderA = Number(a.displayOrder ?? a.display_order ?? 0);
    const orderB = Number(b.displayOrder ?? b.display_order ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.title || a.name || a.question || a.id).localeCompare(
      String(b.title || b.name || b.question || b.id)
    );
  });
}

/* ==========================================================================
   FEEDBACK / BUSY / STATUS UI
   ========================================================================== */

function showToast(message, type = 'success') {
  const toast = byId('adminToast');
  if (!toast) return;

  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.className = `toast is-visible ${type === 'error' ? 'is-error' : ''}`.trim();

  state.toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 4600);
}

function setBusy(button, busy, busyLabel = 'Working...') {
  if (!button) return;

  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="ph ph-circle-notch ph-spin" aria-hidden="true"></i> ${escapeHtml(busyLabel)}`;
    return;
  }

  button.disabled = false;
  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

function setInlineStatus(id, message, type = 'success') {
  const node = byId(id);
  if (!node) return;

  node.textContent = message;
  node.className = `form-status ${type}`;

  window.setTimeout(() => {
    if (node.textContent === message) {
      node.textContent = '';
      node.className = 'form-status';
    }
  }, 4200);
}

function setContentStatus(mode) {
  const status = byId('contentStatus');
  if (!status) return;

  const labels = {
    connected: ['ph-cloud-check', 'Supabase connected'],
    connecting: ['ph-circle-notch is-spinning', 'Syncing with Supabase...'],
    error: ['ph-warning-circle', 'Supabase connection issue']
  };
  const [icon, label] = labels[mode] || labels.connected;

  status.className = `editweb-status${mode === 'error' ? ' is-error' : ''}${mode === 'connecting' ? ' is-syncing' : ''}`;
  status.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i> ${label}`;
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Something went wrong.');

  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'Could not reach the content service. Check your internet connection and that the site server is running, then try again.';
  }
  if (/relation .* does not exist|could not find the table|schema cache/i.test(message)) {
    return 'A required Supabase table is missing. Run docs/migrations/create_admin_editweb_tables.sql first.';
  }
  if (/row-level security|permission denied|violates row-level/i.test(message)) {
    return 'Supabase rejected that change. Sign in as an admin and check the table/storage RLS policies.';
  }
  if (/bucket .* not found|not found/i.test(message) && /storage|bucket/i.test(message)) {
    return 'The Storage bucket is missing. Create studio-gallery and jewelry-catalog, then apply the storage policies.';
  }
  if (/invalid api key|invalid jwt|jwt malformed|no api key|unauthorized/i.test(message)) {
    return 'Supabase rejected the anon API key. Update the key in js/supabase-config.js.';
  }
  return message;
}

function showGridLoading(containerId, message) {
  const container = byId(containerId);
  if (!container) return;
  container.innerHTML = `
    <div class="admin-loading">
      <i class="ph ph-circle-notch ph-spin" aria-hidden="true"></i>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function showGridError(containerId, message, retryTarget) {
  const container = byId(containerId);
  if (!container) return;
  container.innerHTML = `
    <div class="admin-loading admin-loading--error">
      <i class="ph ph-warning-circle" aria-hidden="true"></i>
      <span>${escapeHtml(message)}</span>
      <button type="button" class="btn-secondary" data-grid-retry="${escapeAttr(retryTarget)}">Retry</button>
    </div>
  `;
}

/* ==========================================================================
   SUPABASE DATA HELPERS
   ========================================================================== */

function missingColumnFrom(error) {
  const message = String(error?.message || '');
  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column ["']?([a-zA-Z0-9_]+)["']? does not exist/i
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match?.[1]) return match[1];
  }
  return '';
}

function isMissingTableError(error) {
  const message = String(error?.message || '');
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    /relation .* does not exist|could not find the table/i.test(message)
  );
}

/**
 * The project has two historical gallery table names. Prefer gallery_images
 * (used by the Express gallery API) and fall back to gallery_items if the
 * Supabase project was provisioned from the older public CMS docs.
 */
async function getGalleryTable() {
  if (state.galleryTable) return state.galleryTable;

  const candidates = [TABLES.gallery, TABLES.galleryFallback].filter(Boolean);

  for (const table of candidates) {
    const { error } = await supabase.from(table).select('id').limit(1);
    if (!error) {
      state.galleryTable = table;
      return table;
    }
    if (!isMissingTableError(error)) throw error;
  }

  state.galleryTable = TABLES.gallery;
  return state.galleryTable;
}

async function apiRequest(url, options = {}) {
  let res;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      res = await fetch(url, options);
      break;
    } catch (error) {
      if (attempt === 1) {
        throw new Error('Could not reach the site server. Start the local server with npm start, then try again.');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  }

  return data;
}

async function apiUpload(url, payload) {
  let body = payload;

  if (payload instanceof File) {
    body = new FormData();
    body.append('file', payload);
  }

  return apiRequest(url, { method: 'POST', body });
}

async function insertRow(table, payload) {
  let body = { ...payload };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabase.from(table).insert([body]).select();
    if (!error) return data?.[0] || null;

    const missing = missingColumnFrom(error);
    if (missing && Object.prototype.hasOwnProperty.call(body, missing)) {
      delete body[missing];
      continue;
    }
    throw error;
  }

  throw new Error('The Supabase table is missing required columns.');
}

async function updateRow(table, id, payload) {
  let body = { ...payload };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabase.from(table).update(body).eq('id', id).select();
    if (!error) return data?.[0] || null;

    const missing = missingColumnFrom(error);
    if (missing && Object.prototype.hasOwnProperty.call(body, missing)) {
      delete body[missing];
      continue;
    }
    throw error;
  }

  throw new Error('The Supabase table is missing required columns.');
}

async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

async function getSetting(key, fallback) {
  const { data, error } = await supabase
    .from(TABLES.settings)
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw error;

  if (!data?.value || typeof data.value !== 'object' || Array.isArray(data.value)) {
    return { ...fallback };
  }
  return { ...fallback, ...data.value };
}

async function saveSetting(key, value) {
  const { error } = await supabase.from(TABLES.settings).upsert(
    {
      key,
      value,
      updated_at: nowIso()
    },
    { onConflict: 'key' }
  );

  if (error) throw error;
}

/* ==========================================================================
   STORAGE HELPERS
   ========================================================================== */

async function uploadImage(file, bucket, folder) {
  if (!file) return '';

  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const extension = String(file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';

  if (!allowed.includes(String(file.type || '').toLowerCase()) && !/^(jpe?g|png|webp)$/i.test(extension)) {
    throw new Error('Choose a JPG, PNG or WebP image.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Images must be 10 MB or smaller.');
  }

  const safeBase = String(file.name.replace(/\.[^.]+$/, ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'upload';

  const path = `${folder}/${safeBase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || 'image/jpeg',
    upsert: false
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || '';
}

async function removeStorageObject(url, bucket) {
  if (!url) return;

  const marker = `/storage/v1/object/public/${bucket}/`;
  const index = String(url).indexOf(marker);
  if (index === -1) return;

  const path = decodeURIComponent(String(url).slice(index + marker.length).split('?')[0]);
  if (!path) return;

  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    console.warn('[admin-editweb] Could not remove storage object:', error.message);
  }
}

/* ==========================================================================
   NORMALISERS
   ========================================================================== */

function normalizeBanner(raw) {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: String(raw.id || cryptoId('banner')),
    title: String(raw.title || raw.name || 'Untitled banner'),
    alt: String(raw.alt || raw.altText || raw.alt_text || ''),
    imageUrl: String(raw.imageUrl || raw.image_url || ''),
    linkUrl: String(raw.linkUrl || raw.link_url || raw.link || ''),
    isPublished:
      raw.isPublished !== undefined
        ? Boolean(raw.isPublished)
        : raw.is_published !== undefined
          ? Boolean(raw.is_published)
          : true,
    displayOrder: Number(raw.displayOrder ?? raw.display_order ?? 0)
  };
}

/**
 * Coerces stored categories to one of the four public sections. Older rows may
 * still say "Face", "Body", "Tattoos", "Piercing" or "Ear piercing", so the
 * stored subcategory and body part are folded into the decision.
 */
function canonicalGalleryCategory(category, subcategory = '', bodyPart = '') {
  const hint = `${String(category || '')} ${String(subcategory || '')}`.toLowerCase();

  if (/face\s*tattoo/.test(hint)) return 'Face Tattoo';
  if (/body\s*tattoo/.test(hint)) return 'Body Tattoo';
  if (/face\s*pierc|ear\s*pierc/.test(hint)) return 'Face Piercing';
  if (/body\s*pierc/.test(hint)) return 'Body Piercing';

  if (/tattoo/.test(hint)) {
    const areaHint = `${String(bodyPart || '')} ${String(subcategory || '')}`;
    return FACE_AREA_PATTERN.test(areaHint) ? 'Face Tattoo' : 'Body Tattoo';
  }

  if (/pierc/.test(hint)) return /\bbody\b/.test(hint) ? 'Body Piercing' : 'Face Piercing';

  const raw = String(category || '').trim().toLowerCase();
  if (raw === 'body') return 'Body Piercing';
  if (raw === 'face') return 'Face Piercing';
  return 'Face Tattoo';
}

function normalizeGallery(row) {
  return {
    id: String(row.id ?? row.reference ?? ''),
    title: String(row.title || row.name || 'Untitled work'),
    category: canonicalGalleryCategory(
      row.category,
      row.subcategory || row.sub_category,
      row.body_part || row.bodyPart
    ),
    subcategory: String(row.subcategory || row.sub_category || ''),
    bodyPart: String(row.body_part || row.bodyPart || ''),
    imageUrl: String(row.image_url || row.imageUrl || row.thumbnail_url || row.thumbnailUrl || ''),
    altText: String(row.alt_text || row.altText || ''),
    isPublished:
      row.is_published !== undefined
        ? Boolean(row.is_published)
        : row.isPublished !== undefined
          ? Boolean(row.isPublished)
          : true,
    displayOrder: Number(row.display_order ?? row.displayOrder ?? 0),
    createdAt: row.created_at || row.createdAt || ''
  };
}

function normalizeCatalogue(row) {
  const name = String(row.name || row.title || 'Untitled catalogue item');
  const sizes = parseList(row.sizes ?? row.available_sizes);
  const image = String(
    row.image_url ||
      row.imageUrl ||
      row.image ||
      (Array.isArray(row.images) ? row.images[0] : '') ||
      ''
  );

  return {
    id: String(row.id ?? row.reference ?? ''),
    name,
    title: name,
    description: String(row.description || ''),
    category: String(row.category || 'Ear'),
    subcategory: String(row.subcategory || ''),
    material: String(row.material || ''),
    price: Number(row.price ?? 0),
    sizes: sizes.length ? sizes : ['4mm', '3mm', '2mm'],
    socialMedia: String(row.social_media || row.socialMedia || 'Instagram'),
    orderUrl: String(row.social_order_url || row.socialOrderUrl || row.order_url || ''),
    imageUrl: image,
    isPublished:
      row.is_published !== undefined
        ? Boolean(row.is_published)
        : row.isPublished !== undefined
          ? Boolean(row.isPublished)
          : true,
    displayOrder: Number(row.display_order ?? row.displayOrder ?? 0),
    createdAt: row.created_at || row.createdAt || ''
  };
}

function normalizeArtist(row) {
  const specialties = parseList(row.specialties ?? row.specialty);

  return {
    id: String(row.id ?? ''),
    name: String(row.name || row.display_name || row.title || 'Untitled artist'),
    role: String(row.role || row.title || ''),
    bio: String(row.bio || row.description || ''),
    specialties,
    avatarUrl: String(row.avatar_url || row.avatarUrl || row.photo_url || row.image_url || ''),
    instagramUrl: String(row.instagram_url || row.instagramUrl || row.instagram || ''),
    isPublished:
      row.is_published !== undefined
        ? Boolean(row.is_published)
        : row.isPublished !== undefined
          ? Boolean(row.isPublished)
          : true,
    displayOrder: Number(row.display_order ?? row.displayOrder ?? 0)
  };
}

function normalizeFaq(row) {
  return {
    id: String(row.id ?? ''),
    question: String(row.question || row.title || 'Untitled question'),
    answer: String(row.answer || row.content || row.body || ''),
    category: String(row.category || ''),
    isPublished:
      row.is_published !== undefined
        ? Boolean(row.is_published)
        : row.isPublished !== undefined
          ? Boolean(row.isPublished)
          : true,
    displayOrder: Number(row.display_order ?? row.displayOrder ?? 0)
  };
}

function normalizeSiteImage(row) {
  return {
    id: String(row.id ?? ''),
    section: String(row.section || 'home-studio'),
    title: String(row.title || ''),
    subtitle: String(row.subtitle || ''),
    alt: String(row.alt_text || row.alt || ''),
    description: String(row.description || ''),
    imageUrl: String(row.image_url || row.imageUrl || ''),
    artistId: String(row.artist_id || row.artistId || ''),
    isPublished:
      row.is_published !== undefined
        ? Boolean(row.is_published)
        : row.isPublished !== undefined
          ? Boolean(row.isPublished)
          : true,
    displayOrder: Number(row.display_order ?? row.displayOrder ?? 0),
    createdAt: row.created_at || row.createdAt || ''
  };
}

function siteImageSectionLabel(section) {
  return SITE_IMAGE_SECTIONS.find(([value]) => value === section)?.[1] || section;
}

function artistNameFor(artistId) {
  const id = String(artistId || '');
  if (!id) return 'Unassigned';
  return state.artists.find((artist) => artist.id === id)?.name || 'Unknown artist';
}

/* ==========================================================================
   TAB SWITCHING + LAZY LOADING
   ========================================================================== */

function tabFromHash() {
  const raw = decodeURIComponent(String(window.location.hash || '').replace(/^#/, '')).trim();
  if (!raw) return 'hero-tab';
  if (TAB_IDS.includes(raw)) return raw;
  if (raw === 'home' || raw === 'hero') return 'hero-tab';

  return TAB_IDS.find((id) => id === `${raw}-tab` || id.replace('-tab', '') === raw) || 'hero-tab';
}

function applyPageHeader(tabId) {
  const meta = PAGE_HEADERS[tabId] || PAGE_HEADERS['hero-tab'];
  const title = byId('editwebPageTitle');
  const subtitle = byId('editwebPageSubtitle');

  if (title) title.textContent = meta.title;
  if (subtitle) subtitle.textContent = meta.subtitle;
}

function activateTab(tabId, { updateHash = true } = {}) {
  const resolved = TAB_IDS.includes(tabId) ? tabId : 'hero-tab';

  all('[data-editweb-link]').forEach((link) => {
    const isActive = link.dataset.tab === resolved;
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  all('.tab-pane').forEach((pane) => pane.classList.add('hidden'));

  const pane = byId(resolved);
  if (pane) pane.classList.remove('hidden');

  applyPageHeader(resolved);

  if (updateHash) {
    const slug = TAB_SLUGS[resolved] || resolved.replace(/-tab$/, '');
    try {
      window.history.replaceState(null, '', `#${slug}`);
    } catch {
      // Ignore history restrictions on older browsers.
    }
  }

  switch (resolved) {
    case 'hero-tab':
      loadAdminHero();
      break;
    case 'gallery-tab':
      loadAdminGallery();
      break;
    case 'catalogue-tab':
      loadAdminCatalogue();
      break;
    case 'reviews-tab':
      // The reviews controller is a separate module (js/admin-reviews.js);
      // it exposes its loader once it has bound its controls.
      window.paulinaAdminReviews?.load?.();
      break;
    case 'artist-tab':
      loadAdminArtists();
      break;
    case 'faqs-tab':
      loadAdminFAQs();
      break;
    case 'aftercare-tab':
      loadAdminFAQs();
      loadAdminSiteImages();
      break;
    case 'booking-tab':
      loadAdminBooking();
      break;
    default:
      break;
  }
}

function bindTabs() {
  all('[data-editweb-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

      event.preventDefault();
      activateTab(link.dataset.tab);
      link.blur();
    });
  });

  window.addEventListener('hashchange', () => {
    activateTab(tabFromHash(), { updateHash: false });
  });
}

function activateSectionTab(group, target) {
  const buttons = all(`[data-subtab-group="${group}"][data-subtab-target]`);
  const panes = all(`[data-subtab-group="${group}"][data-subtab-pane]`);
  if (!buttons.length || !panes.length) return;

  buttons.forEach((button) => {
    const isActive = button.dataset.subtabTarget === target;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.tabIndex = isActive ? 0 : -1;
  });

  panes.forEach((pane) => {
    pane.classList.toggle('hidden', pane.dataset.subtabPane !== target);
  });
}

function bindSectionTabs() {
  all('.section-tabs').forEach((bar) => {
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-subtab-target]');
      if (!button || !bar.contains(button)) return;
      activateSectionTab(button.dataset.subtabGroup, button.dataset.subtabTarget);
    });

    bar.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...bar.querySelectorAll('[data-subtab-target]')];
      const current = buttons.indexOf(document.activeElement);
      if (current === -1) return;

      event.preventDefault();
      let next = current;
      if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
      if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;

      const button = buttons[next];
      activateSectionTab(button.dataset.subtabGroup, button.dataset.subtabTarget);
      button.focus();
    });
  });
}

/* ==========================================================================
   HERO & HOME TAB
   ========================================================================== */

async function loadAdminHero(force = false) {
  if (state.loaded['hero-tab'] && !force) return;
  state.loaded['hero-tab'] = true;
  setContentStatus('connecting');

  try {
    const saved = await getSetting('home', homeDefaults());
    const defaults = homeDefaults();

    state.home = {
      ...defaults,
      ...saved,
      hours: {
        ...defaults.hours,
        ...(saved.hours && typeof saved.hours === 'object' ? saved.hours : {})
      },
      contact: {
        ...defaults.contact,
        ...(saved.contact && typeof saved.contact === 'object' ? saved.contact : {})
      },
      banners: Array.isArray(saved.banners) ? saved.banners.map(normalizeBanner).filter(Boolean) : [],
      bannersInitialized: saved.bannersInitialized === true
    };

    populateHomeForm();
    renderBanners();
    loadAdminSiteImages();
    setContentStatus('connected');
  } catch (error) {
    state.loaded['hero-tab'] = false;
    populateHomeForm();
    renderBanners();
    setContentStatus('error');
    showToast(friendlyError(error), 'error');
  }
}

function populateHomeForm() {
  const home = state.home;

  setValue('homeAnnouncement', home.announcement);
  setValue('homeEyebrow', home.eyebrow);
  setValue('homeHeadline1', home.headline1);
  setValue('homeHeadline2', home.headline2);
  setValue('homeHeadline3', home.headline3);
  setValue('homeDescription', home.description);
  setValue('homeQuoteAttribution', home.quoteAttribution);

  setValue('homeHoursWeekdays', home.hours?.weekdays);
  setValue('homeHoursSaturday', home.hours?.saturday);
  setValue('homeHoursSunday', home.hours?.sunday);
  setValue('homeHoursNote', home.hours?.note);

  setValue('homeContactEmail', home.contact?.email);
  setValue('homeContactPhone', home.contact?.phone);
  setValue('homeContactAddress', home.contact?.address);
  setValue('homeMapsUrl', home.contact?.mapsUrl);
  setValue('homeInstagramUrl', home.contact?.instagram);
  setValue('homeFacebookUrl', home.contact?.facebook);
  setValue('homeTiktokUrl', home.contact?.tiktok);
}

async function saveHomeContent(event) {
  event.preventDefault();

  const button = byId('saveHomeBtn');
  setBusy(button, true, 'Saving...');

  const payload = {
    ...state.home,
    announcement: valueOf('homeAnnouncement').trim(),
    eyebrow: valueOf('homeEyebrow').trim(),
    headline1: valueOf('homeHeadline1').trim(),
    headline2: valueOf('homeHeadline2').trim(),
    headline3: valueOf('homeHeadline3').trim(),
    description: valueOf('homeDescription').trim(),
    quoteAttribution: valueOf('homeQuoteAttribution').trim(),
    hours: {
      weekdays: valueOf('homeHoursWeekdays').trim(),
      saturday: valueOf('homeHoursSaturday').trim(),
      sunday: valueOf('homeHoursSunday').trim(),
      note: valueOf('homeHoursNote').trim()
    },
    contact: {
      email: valueOf('homeContactEmail').trim(),
      phone: valueOf('homeContactPhone').trim(),
      address: valueOf('homeContactAddress').trim(),
      mapsUrl: valueOf('homeMapsUrl').trim(),
      instagram: valueOf('homeInstagramUrl').trim(),
      facebook: valueOf('homeFacebookUrl').trim(),
      tiktok: valueOf('homeTiktokUrl').trim()
    },
    banners: state.home.banners,
    bannersInitialized: true
  };

  try {
    state.home = payload;
    await saveSetting('home', payload);
    setInlineStatus('homeFormStatus', 'Home page content saved.', 'success');
    showToast('Home page content saved.', 'success');
  } catch (error) {
    setInlineStatus('homeFormStatus', friendlyError(error), 'error');
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function renderBanners() {
  const grid = byId('heroBannersGrid');
  const empty = byId('heroBannersEmpty');
  if (!grid || !empty) return;

  const banners = sortByOrder(state.home.banners || []);
  const currentId = state.editing.banner?.id || '';

  if (!currentId || !banners.some((banner) => banner.id === currentId)) {
    state.editing.banner = banners[0] || null;
  }

  grid.innerHTML = banners.map((banner, index) => bannerCardHtml(banner, index)).join('');
  empty.classList.toggle('hidden', banners.length > 0);
  renderBannerEditor();
}

function bannerCardHtml(banner, index) {
  const isSelected = state.editing.banner?.id === banner.id;
  const status = banner.isPublished ? 'Active' : 'Draft';

  // Same card design as Gallery, Catalogue and Artists: handle and status
  // badge over the image, then title, meta and actions.
  return `
    <article class="admin-edit-card admin-edit-card--slide hero-slide-card${isSelected ? ' is-selected' : ''}"
             data-id="${escapeAttr(banner.id)}" draggable="true">
      <div class="admin-edit-card__media">
        ${ADMIN_CARD_DRAG_HANDLE}
        <span class="badge-status ${banner.isPublished ? 'badge-published' : 'badge-draft'}">${status}</span>
        <img src="${escapeAttr(imageOrFallback(banner.imageUrl, '../../assets/images/promo_card1.png'))}"
             alt="${escapeAttr(banner.alt || banner.title)}" loading="lazy">
      </div>
      <div class="admin-edit-card__body">
        <h3 title="${escapeAttr(banner.title)}">${escapeHtml(banner.title)}</h3>
        <p>Slide ${index + 1}</p>
        <div class="admin-edit-card__actions">
          <button type="button" class="btn-card-action" data-action="edit-banner" data-id="${escapeAttr(banner.id)}">
            <i class="ph ph-pencil-simple" aria-hidden="true"></i> Edit
          </button>
          <button type="button" class="btn-card-action btn-card-action--danger" data-action="delete-banner" data-id="${escapeAttr(banner.id)}">
            <i class="ph ph-trash" aria-hidden="true"></i> Delete
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderBannerEditor() {
  const banner = state.editing.banner;
  const heading = byId('bannerEditorTitle');
  const selectedLabel = byId('bannerSelectedLabel');
  const statusPill = byId('bannerStatusPill');

  if (heading) heading.textContent = banner ? 'Edit hero slide' : 'Add hero slide';
  if (selectedLabel) {
    selectedLabel.textContent = banner
      ? `Selected \u2022 ${banner.title || 'Untitled slide'}`
      : 'No slide selected';
  }

  if (statusPill) {
    statusPill.classList.toggle('hidden', !banner);
    statusPill.classList.toggle('is-draft', Boolean(banner) && !banner.isPublished);
    statusPill.textContent = banner?.isPublished ? 'Active' : 'Draft';
  }

  setValue('bannerId', banner?.id || '');
  setValue('bannerTitle', banner?.title || '');
  setValue('bannerAlt', banner?.alt || '');
  setValue('bannerLink', banner?.linkUrl || '');
  const published = byId('bannerPublished');
  if (published) published.checked = banner ? banner.isPublished : true;

  setImagePreview(byId('bannerImagePreview'), banner?.imageUrl || '');
  resetFileInput('bannerImageInput');
}

function openBannerEditor(banner) {
  if (!banner) return;
  state.editing.banner = banner;
  renderBanners();
  openModal('bannerModal');
}

async function saveBanner(event) {
  event.preventDefault();

  const button = byId('saveBannerBtn');
  const title = valueOf('bannerTitle').trim();
  const file = byId('bannerImageInput')?.files?.[0] || null;
  const existing = state.editing.banner;

  if (!title) {
    showToast('Add a title for the banner.', 'error');
    byId('bannerTitle')?.focus();
    return;
  }
  if (!file && !existing?.imageUrl) {
    showToast('Choose a banner image.', 'error');
    return;
  }

  setBusy(button, true, 'Saving...');

  try {
    const imageUrl = file ? await uploadImage(file, BUCKETS.gallery, 'hero') : existing.imageUrl;
    const banner = {
      id: existing?.id || cryptoId('banner'),
      title,
      alt: valueOf('bannerAlt').trim(),
      imageUrl,
      linkUrl: valueOf('bannerLink').trim(),
      isPublished: byId('bannerPublished').checked,
      // Order comes from dragging the slide cards, so keep the saved position
      // (or append new slides to the end).
      displayOrder: existing?.displayOrder ?? (state.home.banners || []).length
    };

    const banners = sortByOrder([
      ...state.home.banners.filter((item) => item.id !== banner.id),
      banner
    ]);

    state.home = { ...state.home, banners, bannersInitialized: true };
    await saveSetting('home', state.home);

    state.editing.banner = banner;
    renderBanners();
    showToast(existing ? 'Banner updated.' : 'Banner added.', 'success');
    closeModal('bannerModal');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function handleHeroUpload(fileList) {
  const file = Array.from(fileList || []).filter(Boolean)[0];
  if (!file) return;

  const button = byId('heroUploadBtn');
  setBusy(button, true, 'Uploading...');

  try {
    const imageUrl = await uploadImage(file, BUCKETS.gallery, 'hero');
    const banner = {
      id: cryptoId('banner'),
      title: filenameToTitle(file.name),
      alt: '',
      imageUrl,
      linkUrl: '',
      isPublished: true,
      displayOrder: (state.home.banners || []).length
    };

    const banners = sortByOrder([...(state.home.banners || []), banner]);
    state.home = { ...state.home, banners, bannersInitialized: true };
    await saveSetting('home', state.home);

    state.editing.banner = banner;
    renderBanners();
    openModal('bannerModal');
    showToast('New hero slide added. Edit its details in the editor.', 'success');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
    resetFileInput('heroUploadInput');
  }
}

function deleteBanner(banner) {
  askConfirm({
    title: 'Delete promotional banner',
    message: `Remove \u201c${banner.title}\u201d from the home page carousel?`,
    confirmLabel: 'Delete banner',
    action: async () => {
      const banners = state.home.banners.filter((item) => item.id !== banner.id);
      state.home = { ...state.home, banners, bannersInitialized: true };
      await saveSetting('home', state.home);
      await removeStorageObject(banner.imageUrl, BUCKETS.gallery);

      if (state.editing.banner?.id === banner.id) {
        state.editing.banner = null;
      }

      renderBanners();
      showToast('Banner deleted.', 'success');
    }
  });
}

async function saveBannerOrder(ids) {
  const bannersById = new Map(state.home.banners.map((banner) => [banner.id, banner]));
  const ordered = ids
    .map((id, index) => {
      const banner = bannersById.get(id);
      return banner ? { ...banner, displayOrder: index } : null;
    })
    .filter(Boolean);

  if (ordered.length !== state.home.banners.length) return;

  const previous = state.home;
  state.home = { ...state.home, banners: ordered, bannersInitialized: true };
  renderBanners();

  try {
    await saveSetting('home', state.home);
    showToast('Promo order saved.', 'success');
  } catch (error) {
    state.home = previous;
    renderBanners();
    showToast(friendlyError(error), 'error');
  }
}

/* ==========================================================================
   GALLERY TAB
   ========================================================================== */

// Guards against a slow save/SSE refresh landing after a newer gallery read.
let galleryLoadRequest = 0;

async function loadAdminGallery(force = false) {
  if (state.loaded['gallery-tab'] && !force) return;
  state.loaded['gallery-tab'] = true;
  const requestId = ++galleryLoadRequest;
  setContentStatus('connecting');
  showGridLoading('adminGalleryGrid', 'Loading gallery...');

  try {
    const data = await apiRequest(GALLERY_API);
    if (requestId !== galleryLoadRequest) return;

    state.gallery = (data.images || [])
      .map(normalizeGallery)
      .filter((item) => item.id)
      .sort((a, b) => a.displayOrder - b.displayOrder || String(b.createdAt).localeCompare(String(a.createdAt)));
    renderGallery();
    setContentStatus('connected');
  } catch (error) {
    if (requestId !== galleryLoadRequest) return;
    state.loaded['gallery-tab'] = false;
    byId('galleryEmpty').classList.add('hidden');
    setContentStatus('error');
    showGridError('adminGalleryGrid', friendlyError(error), 'gallery');
  }
}

function galleryMatchesFilters(item) {
  const { search, category, visibility } = state.filters.gallery;
  const term = search.toLowerCase().trim();

  const categoryMatch =
    category === 'all' || String(item.category).toLowerCase().includes(category.toLowerCase());
  const visibilityMatch =
    visibility === 'all' || (visibility === 'published' ? item.isPublished : !item.isPublished);
  const textMatch =
    !term ||
    [item.title, item.category, item.subcategory, item.bodyPart, item.altText]
      .join(' ')
      .toLowerCase()
      .includes(term);

  return categoryMatch && visibilityMatch && textMatch;
}

function filteredGallery() {
  return state.gallery.filter(galleryMatchesFilters);
}

/**
 * A saved photo can fall outside the filters currently applied to the grid
 * (for example a published upload while the Draft filter is active). Clear
 * the filters in that case so the saved record is visibly confirmed.
 */
function revealGalleryItem(item) {
  if (!item || galleryMatchesFilters(item)) return;

  state.filters.gallery = { search: '', category: 'all', visibility: 'all' };
  setValue('gallerySearch', '');
  setValue('galleryCategoryFilter', 'all');
  setValue('galleryVisibilityFilter', 'all');
  renderGallery();
}

function renderGallery() {
  const grid = byId('adminGalleryGrid');
  const empty = byId('galleryEmpty');
  if (!grid || !empty) return;

  const items = filteredGallery();
  grid.innerHTML = items.map(galleryCardHtml).join('');
  empty.classList.toggle('hidden', items.length > 0);
}

function galleryCardHtml(item) {
  return `
    <article class="admin-edit-card" data-id="${escapeAttr(item.id)}" draggable="true">
      <div class="admin-edit-card__media">
        ${ADMIN_CARD_DRAG_HANDLE}
        <span class="badge-status ${item.isPublished ? 'badge-published' : 'badge-draft'}">
          ${item.isPublished ? 'Published' : 'Draft'}
        </span>
        <img src="${escapeAttr(imageOrFallback(item.imageUrl))}"
             alt="${escapeAttr(item.altText || item.title)}" loading="lazy">
      </div>
      <div class="admin-edit-card__body">
        <h3 title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.bodyPart ? `${item.bodyPart} \u00b7 ${item.subcategory || item.category}` : item.subcategory || item.category)}</p>
        <div class="admin-edit-card__actions">
          <button type="button" class="btn-card-action" data-action="edit-gallery" data-id="${escapeAttr(item.id)}">
            <i class="ph ph-pencil-simple" aria-hidden="true"></i> Edit
          </button>
          <button type="button" class="btn-card-action btn-card-action--danger" data-action="delete-gallery" data-id="${escapeAttr(item.id)}">
            <i class="ph ph-trash" aria-hidden="true"></i> Delete
          </button>
        </div>
      </div>
    </article>
  `;
}

function syncGallerySubcategories(selected = '') {
  const category = canonicalGalleryCategory(
    byId('galleryCategory').value,
    selected
  );

  // The section itself is the stored subcategory value.
  byId('gallerySubcategory').value = category;
}

const GALLERY_BODY_PART_BLANK_LABEL = 'Use subcategory';

function galleryBodyPartChoices() {
  return GALLERY_BODY_PARTS.flatMap((group) =>
    group.options.map((label, index) => ({ value: label, label, group: group.label, index }))
  );
}

function canonicalGalleryBodyPart(value) {
  const term = String(value || '').trim();
  if (!term) return '';

  return (
    galleryBodyPartChoices().find(
      (choice) => choice.label.toLowerCase() === term.toLowerCase()
    )?.label || ''
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lower rank = closer prediction. Prefix matches beat word starts, then substring. */
function galleryBodyPartRank(label, query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return 0;

  const text = String(label || '').toLowerCase();
  if (text.startsWith(term)) return 0;
  if (text.split(/[\s&/+-]+/).some((word) => word.startsWith(term))) return 1;
  if (text.includes(term)) return 2;
  return -1;
}

function highlightGalleryBodyPart(label, query) {
  const term = String(query || '').trim();
  if (!term) return escapeHtml(label);

  const pattern = new RegExp(`(${escapeRegExp(term)})`, 'gi');
  return String(label)
    .split(pattern)
    .map((part, index) =>
      index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)
    )
    .join('');
}

function collectGalleryBodyPartGroups(query) {
  const matches = GALLERY_BODY_PARTS.map((group, groupIndex) => {
    const options = group.options
      .map((label, index) => ({
        value: label,
        label,
        group: group.label,
        index,
        rank: galleryBodyPartRank(label, query)
      }))
      .filter((choice) => choice.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index);

    return {
      label: group.label,
      groupIndex,
      rank: options.length ? options[0].rank : Number.POSITIVE_INFINITY,
      options
    };
  }).filter((group) => group.options.length > 0);

  // Predict the most likely group first so the admin rarely needs to scroll.
  matches.sort((a, b) => a.rank - b.rank || a.groupIndex - b.groupIndex);

  const legacy = state.galleryBodyPart.legacy;
  if (legacy && !canonicalGalleryBodyPart(legacy)) {
    const legacyRank = galleryBodyPartRank(legacy, query);
    if (legacyRank >= 0) {
      matches.unshift({
        label: 'Current value',
        groupIndex: -1,
        rank: -1,
        options: [{ value: legacy, label: legacy, group: 'Current value', index: 0, rank: legacyRank }]
      });
    }
  }

  return matches;
}

function renderGalleryBodyPartOptions(queryOverride) {
  const list = byId('galleryBodyPartList');
  const input = byId('galleryBodyPartSearch');
  if (!list || !input) return;

  const query = String(queryOverride ?? input.value ?? '').trim();
  const selected = valueOf('galleryBodyPart').trim();
  const groups = collectGalleryBodyPartGroups(query);
  const showBlank = galleryBodyPartRank(GALLERY_BODY_PART_BLANK_LABEL, query) >= 0;
  let optionIndex = 0;
  let html = '';

  const optionHtml = (choice, extraClass = '') => {
    const id = `galleryBodyPartOption-${optionIndex}`;
    optionIndex += 1;
    const isSelected = choice.value === selected;

    return `
      <li class="combobox-option ${extraClass}"
          id="${id}"
          role="option"
          data-value="${escapeAttr(choice.value)}"
          aria-selected="${isSelected ? 'true' : 'false'}">
        <span>${highlightGalleryBodyPart(choice.label, query)}</span>
      </li>
    `;
  };

  if (showBlank) {
    html += optionHtml(
      { value: '', label: GALLERY_BODY_PART_BLANK_LABEL },
      'combobox-option--blank'
    );
  }

  groups.forEach((group) => {
    html += `<li class="combobox-group" role="presentation">${escapeHtml(group.label)}</li>`;
    group.options.forEach((choice) => {
      html += optionHtml(choice);
    });
  });

  if (!showBlank && groups.length === 0) {
    html += `<li class="combobox-empty" role="presentation">No body part matches \u201c${escapeHtml(query)}\u201d.</li>`;
  }

  list.innerHTML = html;
  state.galleryBodyPart.options = Array.from(list.querySelectorAll('[role="option"]'));
  state.galleryBodyPart.activeIndex = -1;
  input.removeAttribute('aria-activedescendant');

  // Highlight the top prediction so Enter accepts it immediately.
  if (query && state.galleryBodyPart.options.length) {
    setGalleryBodyPartActive(0);
  }
}

function setGalleryBodyPartActive(index) {
  const options = state.galleryBodyPart.options;
  const input = byId('galleryBodyPartSearch');
  if (!input || !options.length) return;

  const next = Math.max(0, Math.min(index, options.length - 1));
  options.forEach((option, position) => {
    option.classList.toggle('is-active', position === next);
  });

  state.galleryBodyPart.activeIndex = next;
  input.setAttribute('aria-activedescendant', options[next].id);
  options[next].scrollIntoView({ block: 'nearest' });
}

function positionGalleryBodyPartPanel() {
  const list = byId('galleryBodyPartList');
  const input = byId('galleryBodyPartSearch');
  if (!list || !input) return;

  const dialog = document.querySelector('#galleryModal .modal-dialog');
  const inputRect = input.getBoundingClientRect();
  const bounds = dialog ? dialog.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const spaceBelow = Math.min(bounds.bottom, window.innerHeight) - inputRect.bottom;
  const spaceAbove = inputRect.top - Math.max(bounds.top, 0);
  const needed = Math.min(list.scrollHeight || 236, 240) + 8;

  // Flip the panel upward when the lower part of the modal has no room left.
  list.classList.toggle(
    'combobox-panel--up',
    spaceBelow < needed && spaceAbove > spaceBelow
  );
}

function openGalleryBodyPartPanel(showAll = false) {
  const list = byId('galleryBodyPartList');
  const input = byId('galleryBodyPartSearch');
  if (!list || !input) return;

  renderGalleryBodyPartOptions(showAll ? '' : undefined);
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  positionGalleryBodyPartPanel();
}

function closeGalleryBodyPartPanel() {
  const list = byId('galleryBodyPartList');
  const input = byId('galleryBodyPartSearch');
  if (!list || !input) return;

  debouncedGalleryBodyPartFilter.cancel();
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  state.galleryBodyPart.activeIndex = -1;
  state.galleryBodyPart.options.forEach((option) => option.classList.remove('is-active'));
}

function updateGalleryBodyPartClear() {
  const clear = byId('galleryBodyPartClear');
  if (clear) clear.hidden = !valueOf('galleryBodyPart').trim();
}

function selectGalleryBodyPart(value) {
  const hidden = byId('galleryBodyPart');
  const input = byId('galleryBodyPartSearch');
  if (!hidden || !input) return;

  const next = String(value || '');
  hidden.value = next;
  input.value = next;
  state.galleryBodyPart.legacy = next && !canonicalGalleryBodyPart(next) ? next : '';

  updateGalleryBodyPartClear();
  closeGalleryBodyPartPanel();
}

function commitGalleryBodyPartInput() {
  const hidden = byId('galleryBodyPart');
  const input = byId('galleryBodyPartSearch');
  if (!hidden || !input) return;

  const term = input.value.trim();
  const canonical = canonicalGalleryBodyPart(term);
  const legacy = state.galleryBodyPart.legacy;

  if (!term) {
    hidden.value = '';
    input.value = '';
  } else if (canonical) {
    hidden.value = canonical;
    input.value = canonical;
  } else if (legacy && term.toLowerCase() === legacy.toLowerCase()) {
    hidden.value = legacy;
    input.value = legacy;
  } else {
    // Body parts are picked from the list; revert unmatched typing.
    input.value = hidden.value;
  }

  updateGalleryBodyPartClear();
}

const debouncedGalleryBodyPartFilter = debounce(() => {
  renderGalleryBodyPartOptions();
}, 160);

function syncGalleryBodyParts(selected = '') {
  const hidden = byId('galleryBodyPart');
  const input = byId('galleryBodyPartSearch');
  if (!hidden || !input) return;

  const desired = String(selected || '').trim();
  const canonical = canonicalGalleryBodyPart(desired);
  const current = canonical || desired;

  hidden.value = current;
  input.value = current;
  // Keep an older free-text value selectable instead of silently dropping it.
  state.galleryBodyPart.legacy = current && !canonical ? current : '';

  updateGalleryBodyPartClear();
  closeGalleryBodyPartPanel();
}

function bindGalleryBodyPartCombobox() {
  const input = byId('galleryBodyPartSearch');
  const list = byId('galleryBodyPartList');
  if (!input || !list) return;

  input.addEventListener('focus', () => {
    if (input.value) input.select();
    openGalleryBodyPartPanel(true);
  });

  input.addEventListener('input', () => {
    if (list.hidden) openGalleryBodyPartPanel(false);
    debouncedGalleryBodyPartFilter();
  });

  input.addEventListener('keydown', (event) => {
    const isOpen = !list.hidden;
    const { options, activeIndex } = state.galleryBodyPart;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        openGalleryBodyPartPanel(false);
        return;
      }
      setGalleryBodyPartActive(Math.max(0, activeIndex + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openGalleryBodyPartPanel(false);
        return;
      }
      setGalleryBodyPartActive(activeIndex <= 0 ? 0 : activeIndex - 1);
      return;
    }

    if (isOpen && event.key === 'Home') {
      event.preventDefault();
      setGalleryBodyPartActive(0);
      return;
    }

    if (isOpen && event.key === 'End') {
      event.preventDefault();
      setGalleryBodyPartActive(options.length - 1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen && activeIndex >= 0 && options[activeIndex]) {
        selectGalleryBodyPart(options[activeIndex].dataset.value || '');
      } else {
        commitGalleryBodyPartInput();
        closeGalleryBodyPartPanel();
      }
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      // Keep Escape for the dropdown first; a second press closes the modal.
      event.preventDefault();
      event.stopPropagation();
      commitGalleryBodyPartInput();
      closeGalleryBodyPartPanel();
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      const combobox = byId('galleryBodyPartCombobox');
      if (combobox?.contains(document.activeElement)) return;
      commitGalleryBodyPartInput();
      closeGalleryBodyPartPanel();
    }, 120);
  });

  // Keep focus in the search field while an option is clicked.
  list.addEventListener('mousedown', (event) => {
    if (event.target.closest('[role="option"]')) event.preventDefault();
  });

  list.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (!option) return;
    selectGalleryBodyPart(option.dataset.value || '');
  });

  byId('galleryBodyPartClear')?.addEventListener('click', (event) => {
    event.stopPropagation();
    selectGalleryBodyPart('');
    input.focus();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#galleryBodyPartCombobox')) {
      closeGalleryBodyPartPanel();
    }
  });
}

function openGalleryEditor(item) {
  state.editing.gallery = item || null;

  const activeCategory = GALLERY_SUBCATEGORIES[state.filters.gallery.category]
    ? state.filters.gallery.category
    : GALLERY_SECTIONS[0];

  byId('galleryModalTitle').textContent = item ? 'Edit gallery image' : 'Add gallery image';
  setValue('galleryItemId', item?.id || '');
  setValue('galleryTitle', item?.title || '');
  byId('galleryCategory').value = canonicalGalleryCategory(
    item?.category || activeCategory,
    item?.subcategory,
    item?.bodyPart
  );
  syncGallerySubcategories(item?.subcategory || '');
  syncGalleryBodyParts(item?.bodyPart || '');
  setValue('galleryAlt', item?.altText || '');
  byId('galleryPublished').checked = item ? item.isPublished : true;

  setImagePreview(byId('galleryImagePreview'), item?.imageUrl || '');
  resetFileInput('galleryImageInput');
  openModal('galleryModal');
}

async function saveGalleryItem(event) {
  event.preventDefault();

  // Accept an exact typed match before the form reads the hidden value.
  commitGalleryBodyPartInput();

  const button = byId('saveGalleryBtn');
  const id = valueOf('galleryItemId');
  const title = valueOf('galleryTitle').trim();
  const file = byId('galleryImageInput')?.files?.[0] || null;
  const existing = state.editing.gallery;

  if (!title) {
    showToast('Add a title for this image.', 'error');
    byId('galleryTitle')?.focus();
    return;
  }
  if (!id && !file) {
    showToast('Choose an image to upload.', 'error');
    return;
  }

  setBusy(button, true, 'Saving...');

  try {
    const fields = {
      title,
      category: byId('galleryCategory').value,
      subcategory: byId('gallerySubcategory').value,
      bodyPart: valueOf('galleryBodyPart').trim(),
      altText: valueOf('galleryAlt').trim(),
      isPublished: byId('galleryPublished').checked,
      displayOrder: existing?.displayOrder ?? state.gallery.length
    };

    let savedImage = null;

    if (id) {
      if (file) await apiUpload(`${GALLERY_API}/${encodeURIComponent(id)}/change-image`, file);
      const response = await apiRequest(`${GALLERY_API}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
      savedImage = response.image || null;
    } else {
      const form = new FormData();
      form.append('file', file);
      form.append('title', fields.title);
      form.append('category', fields.category);
      form.append('subcategory', fields.subcategory);
      form.append('bodyPart', fields.bodyPart);
      form.append('altText', fields.altText);
      form.append('isPublished', String(fields.isPublished));
      form.append('displayOrder', String(fields.displayOrder));
      const response = await apiUpload(`${GALLERY_API}/upload`, form);
      savedImage = response.image || null;
    }

    closeModal('galleryModal');
    await loadAdminGallery(true);
    revealGalleryItem(savedImage);
    showToast(id ? 'Gallery image updated.' : 'Gallery image uploaded.', 'success');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deleteGalleryItem(item) {
  await apiRequest(`${GALLERY_API}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
  await loadAdminGallery(true);
  showToast('Gallery image deleted.', 'success');
}

async function saveGalleryOrder(ids) {
  const ordered = applyPartialOrder(state.gallery, ids);
  if (!ordered) return;

  const previous = state.gallery;
  const previousOrder = new Map(previous.map((item) => [item.id, item.displayOrder]));
  state.gallery = ordered.map((item, index) => ({ ...item, displayOrder: index }));
  renderGallery();

  const changed = state.gallery.filter((item) => previousOrder.get(item.id) !== item.displayOrder);

  try {
    await Promise.all(
      changed.map((item) =>
        apiRequest(`${GALLERY_API}/${encodeURIComponent(item.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayOrder: item.displayOrder })
        })
      )
    );
    showToast('Gallery order saved.', 'success');
  } catch (error) {
    state.gallery = previous;
    renderGallery();
    showToast(friendlyError(error), 'error');
    await loadAdminGallery(true);
  }
}

/**
 * Keep the admin grid current when another admin tab or session changes the
 * same gallery. The public page listens on this stream too, so both views stay
 * on one source of truth.
 */
function initGalleryRealtime() {
  if (typeof EventSource !== 'function') return;

  try {
    const source = new EventSource(window.paulinaApiUrl('/api/gallery/stream'));

    source.addEventListener('gallery_change', () => {
      const tab = byId('gallery-tab');
      if (!tab || tab.classList.contains('hidden')) return;
      if (!state.loaded['gallery-tab']) return;
      // The editor refreshes the grid itself when it finishes.
      if (!byId('galleryModal')?.classList.contains('hidden')) return;

      loadAdminGallery(true);
    });

    source.onerror = () => {
      // EventSource reconnects automatically.
    };
  } catch (error) {
    console.warn('[admin-editweb] Gallery realtime stream unavailable:', error);
  }
}

/* ==========================================================================
   CATALOGUE TAB
   ========================================================================== */

async function loadAdminCatalogue(force = false) {
  if (state.loaded['catalogue-tab'] && !force) return;
  state.loaded['catalogue-tab'] = true;
  setContentStatus('connecting');
  showGridLoading('adminCatalogueGrid', 'Loading catalogue...');

  try {
    const data = await apiRequest(CATALOGUE_API);

    state.catalogue = (data.items || [])
      .map(normalizeCatalogue)
      .filter((item) => item.id)
      .sort((a, b) => a.displayOrder - b.displayOrder || String(b.createdAt).localeCompare(String(a.createdAt)));
    renderCatalogue();
    setContentStatus('connected');
  } catch (error) {
    state.loaded['catalogue-tab'] = false;
    byId('catalogueEmpty').classList.add('hidden');
    setContentStatus('error');
    showGridError('adminCatalogueGrid', friendlyError(error), 'catalogue');
  }
}

function filteredCatalogue() {
  const { search, category, visibility } = state.filters.catalogue;
  const term = search.toLowerCase().trim();

  return state.catalogue.filter((item) => {
    const categoryMatch =
      category === 'all' || String(item.category).toLowerCase() === category.toLowerCase();
    const visibilityMatch =
      visibility === 'all' || (visibility === 'published' ? item.isPublished : !item.isPublished);
    const textMatch =
      !term ||
      [item.name, item.description, item.category, item.subcategory, item.material]
        .join(' ')
        .toLowerCase()
        .includes(term);

    return categoryMatch && visibilityMatch && textMatch;
  });
}

function renderCatalogue() {
  const grid = byId('adminCatalogueGrid');
  const empty = byId('catalogueEmpty');
  if (!grid || !empty) return;

  const items = filteredCatalogue();
  grid.innerHTML = items.map(catalogueCardHtml).join('');
  empty.classList.toggle('hidden', items.length > 0);
}

function catalogueCardHtml(item) {
  return `
    <article class="admin-edit-card" data-id="${escapeAttr(item.id)}" draggable="true">
      <div class="admin-edit-card__media">
        ${ADMIN_CARD_DRAG_HANDLE}
        <span class="badge-status ${item.isPublished ? 'badge-published' : 'badge-draft'}">
          ${item.isPublished ? 'Published' : 'Draft'}
        </span>
        <img src="${escapeAttr(imageOrFallback(item.imageUrl, '../../assets/images/piercing1.png'))}"
             alt="${escapeAttr(item.name)}" loading="lazy">
      </div>
      <div class="admin-edit-card__body">
        <h3 title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.category)}${item.subcategory ? ` / ${escapeHtml(item.subcategory)}` : ''}</p>
        <strong class="admin-edit-card__price">${formatPrice(item.price)}</strong>
        <div class="admin-edit-card__actions">
          <button type="button" class="btn-card-action" data-action="edit-catalogue" data-id="${escapeAttr(item.id)}">
            <i class="ph ph-pencil-simple" aria-hidden="true"></i> Edit
          </button>
          <button type="button" class="btn-card-action btn-card-action--danger" data-action="delete-catalogue" data-id="${escapeAttr(item.id)}">
            <i class="ph ph-trash" aria-hidden="true"></i> Delete
          </button>
        </div>
      </div>
    </article>
  `;
}

function openCatalogueEditor(item) {
  state.editing.catalogue = item || null;

  byId('catalogueModalTitle').textContent = item ? 'Edit catalogue item' : 'Add catalogue item';
  setValue('catalogueItemId', item?.id || '');
  setValue('catalogueTitle', item?.name || '');
  setValue('catalogueDescription', item?.description || '');
  setValue('cataloguePrice', item?.price || '');
  byId('catalogueCategory').value = item?.category || 'Ear';
  setValue('catalogueSubcategory', item?.subcategory || '');
  setValue('catalogueMaterial', item?.material || 'ASTM F136 Titanium');
  setValue('catalogueSizes', (item?.sizes || ['4mm', '3mm', '2mm']).join(', '));
  byId('catalogueSocialMedia').value = item?.socialMedia || 'Instagram';
  setValue('catalogueOrderUrl', item?.orderUrl || '');
  byId('cataloguePublished').checked = item ? item.isPublished : true;

  setImagePreview(byId('catalogueImagePreview'), item?.imageUrl || '');
  resetFileInput('catalogueImageInput');
  openModal('catalogueModal');
}

async function saveCatalogueItem(event) {
  event.preventDefault();

  const button = byId('saveCatalogueBtn');
  const id = valueOf('catalogueItemId');
  const name = valueOf('catalogueTitle').trim();
  const file = byId('catalogueImageInput')?.files?.[0] || null;
  const existing = state.editing.catalogue;

  if (!name) {
    showToast('Add a title for the catalogue item.', 'error');
    byId('catalogueTitle')?.focus();
    return;
  }
  if (!id && !file) {
    showToast('Choose a catalogue photo.', 'error');
    return;
  }

  setBusy(button, true, 'Saving...');

  try {
    const sizes = parseList(valueOf('catalogueSizes'));
    const fields = {
      name,
      title: name,
      description: valueOf('catalogueDescription').trim(),
      category: byId('catalogueCategory').value,
      subcategory: valueOf('catalogueSubcategory').trim(),
      material: valueOf('catalogueMaterial').trim(),
      price: Number(valueOf('cataloguePrice')) || 0,
      sizes: sizes.length ? sizes : ['4mm', '3mm', '2mm'],
      activeSize: sizes[0] || '4mm',
      socialMedia: byId('catalogueSocialMedia').value,
      socialOrderUrl: valueOf('catalogueOrderUrl').trim(),
      isPublished: byId('cataloguePublished').checked,
      displayOrder: existing?.displayOrder ?? state.catalogue.length
    };

    if (id) {
      // A replacement photo is stored first, then the text fields are saved on
      // the same record so the public catalogue shows the new image at once.
      if (file) await apiUpload(`${CATALOGUE_API}/${encodeURIComponent(id)}/change-image`, file);
      await apiRequest(`${CATALOGUE_API}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
    } else {
      const form = new FormData();
      form.append('file', file);
      for (const [key, value] of Object.entries(fields)) {
        form.append(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
      }
      await apiUpload(`${CATALOGUE_API}/upload`, form);
    }

    closeModal('catalogueModal');
    await loadAdminCatalogue(true);
    showToast(id ? 'Catalogue item updated.' : 'Catalogue item added.', 'success');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deleteCatalogueItem(item) {
  await apiRequest(`${CATALOGUE_API}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
  await loadAdminCatalogue(true);
  showToast('Catalogue item deleted.', 'success');
}

async function saveCatalogueOrder(ids) {
  const ordered = applyPartialOrder(state.catalogue, ids);
  if (!ordered) return;

  const previous = state.catalogue;
  const previousOrder = new Map(previous.map((item) => [item.id, item.displayOrder]));
  state.catalogue = ordered.map((item, index) => ({ ...item, displayOrder: index }));
  renderCatalogue();

  const changed = state.catalogue.filter((item) => previousOrder.get(item.id) !== item.displayOrder);

  try {
    await Promise.all(
      changed.map((item) =>
        apiRequest(`${CATALOGUE_API}/${encodeURIComponent(item.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayOrder: item.displayOrder })
        })
      )
    );
    showToast('Catalogue order saved.', 'success');
  } catch (error) {
    state.catalogue = previous;
    renderCatalogue();
    showToast(friendlyError(error), 'error');
    await loadAdminCatalogue(true);
  }
}

/* ==========================================================================
   ARTIST TAB
   ========================================================================== */

async function loadAdminArtists(force = false) {
  if (state.loaded['artist-tab'] && !force) return;
  state.loaded['artist-tab'] = true;
  setContentStatus('connecting');
  showGridLoading('adminArtistGrid', 'Loading artist profiles...');

  try {
    const { data, error } = await supabase
      .from(TABLES.artists)
      .select('*');

    if (error) throw error;

    state.artists = (data || []).map(normalizeArtist).filter((artist) => artist.id);
    renderArtists();
    // Re-render Favorite Works so each row can show its linked artist name.
    if (state.siteImagesLoaded) renderSiteImagesAdmin();
    else loadAdminSiteImages();
    setContentStatus('connected');
  } catch (error) {
    state.loaded['artist-tab'] = false;
    byId('adminArtistGrid').innerHTML = '';
    byId('artistEmpty').classList.remove('hidden');
    setContentStatus('error');
    showToast(friendlyError(error), 'error');
  }
}

function renderArtists() {
  const grid = byId('adminArtistGrid');
  const empty = byId('artistEmpty');
  if (!grid || !empty) return;

  const artists = sortByOrder(state.artists);
  grid.innerHTML = artists.map(artistCardHtml).join('');
  empty.classList.toggle('hidden', artists.length > 0);
}

function artistCardHtml(artist) {
  return `
    <article class="admin-edit-card admin-edit-card--artist" data-id="${escapeAttr(artist.id)}" draggable="true">
      <div class="admin-edit-card__media admin-edit-card__media--avatar">
        ${ADMIN_CARD_DRAG_HANDLE}
        <span class="badge-status ${artist.isPublished ? 'badge-published' : 'badge-draft'}">
          ${artist.isPublished ? 'Published' : 'Draft'}
        </span>
        <img src="${escapeAttr(imageOrFallback(artist.avatarUrl, '../../assets/images/mspau.png'))}"
             alt="${escapeAttr(artist.name)}" loading="lazy">
      </div>
      <div class="admin-edit-card__body">
        <h3 title="${escapeAttr(artist.name)}">${escapeHtml(artist.name)}</h3>
        <p>${escapeHtml(artist.role || 'Resident artist')}</p>
        ${artist.specialties.length ? `
          <div class="chip-row">
            ${artist.specialties.slice(0, 3).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('')}
          </div>
        ` : ''}
        <div class="admin-edit-card__actions">
          <button type="button" class="btn-card-action" data-action="edit-artist" data-id="${escapeAttr(artist.id)}">
            <i class="ph ph-pencil-simple" aria-hidden="true"></i> Edit
          </button>
          <button type="button" class="btn-card-action btn-card-action--danger" data-action="delete-artist" data-id="${escapeAttr(artist.id)}">
            <i class="ph ph-trash" aria-hidden="true"></i> Delete
          </button>
        </div>
      </div>
    </article>
  `;
}

/* --------------------------------------------------------------------------
   SPECIALTIES COMBOBOX (predictive + debounced)
   -------------------------------------------------------------------------- */

function artistSpecialtyGroups() {
  const seen = new Set();
  const groups = [];

  const addGroup = (label, values) => {
    const options = [];

    values.forEach((value) => {
      const text = String(value || '').trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      options.push(text);
    });

    if (options.length) groups.push({ label, options });
  };

  const existing = [];
  state.artists.forEach((artist) => {
    (artist.specialties || []).forEach((item) => existing.push(item));
  });

  addGroup('Used by your artists', existing);
  SPECIALTY_GROUPS.forEach((group) => addGroup(group.label, group.options));

  return groups;
}

function artistSpecialtyChoices() {
  return artistSpecialtyGroups().flatMap((group) => group.options);
}

function canonicalArtistSpecialty(value) {
  const term = String(value || '').trim();
  if (!term) return '';
  return (
    artistSpecialtyChoices().find((label) => label.toLowerCase() === term.toLowerCase()) || ''
  );
}

function specialtyRank(label, query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return 0;

  const text = String(label || '').toLowerCase();
  if (text.startsWith(term)) return 0;
  if (text.split(/[\s&/+-]+/).some((word) => word.startsWith(term))) return 1;
  if (text.includes(term)) return 2;
  return -1;
}

function collectArtistSpecialtyGroups(query) {
  const matches = artistSpecialtyGroups()
    .map((group, groupIndex) => {
      const options = group.options
        .map((label, index) => ({
          value: label,
          label,
          group: group.label,
          index,
          rank: specialtyRank(label, query)
        }))
        .filter((choice) => choice.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.index - b.index);

      return {
        label: group.label,
        groupIndex,
        rank: options.length ? options[0].rank : Number.POSITIVE_INFINITY,
        options
      };
    })
    .filter((group) => group.options.length > 0);

  // Predict the most likely group first so the admin rarely needs to scroll.
  matches.sort((a, b) => a.rank - b.rank || a.groupIndex - b.groupIndex);
  return matches;
}

function renderArtistSpecialtyOptions(queryOverride) {
  const list = byId('artistSpecialtiesList');
  const input = byId('artistSpecialtiesSearch');
  if (!list || !input) return;

  const query = String(queryOverride ?? input.value ?? '').trim();
  const selectedKeys = new Set(
    state.artistSpecialties.selected.map((value) => value.toLowerCase())
  );
  const groups = collectArtistSpecialtyGroups(query);
  let optionIndex = 0;
  let html = '';

  const optionHtml = (choice) => {
    const id = `artistSpecialtyOption-${optionIndex}`;
    optionIndex += 1;
    return `
      <li class="combobox-option"
          id="${id}"
          role="option"
          data-value="${escapeAttr(choice.value)}"
          aria-selected="false">
        <span>${highlightGalleryBodyPart(choice.label, query)}</span>
      </li>
    `;
  };

  groups.forEach((group) => {
    const options = group.options.filter((choice) => !selectedKeys.has(choice.label.toLowerCase()));
    if (!options.length) return;
    html += `<li class="combobox-group" role="presentation">${escapeHtml(group.label)}</li>`;
    options.forEach((choice) => {
      html += optionHtml(choice);
    });
  });

  const customKey = query.toLowerCase();
  const isKnown = artistSpecialtyChoices().some((label) => label.toLowerCase() === customKey);
  const isSelected = selectedKeys.has(customKey);

  if (query && !isKnown && !isSelected) {
    html += `<li class="combobox-group" role="presentation">Add custom</li>`;
    html += optionHtml({ value: query, label: `Add \u201C${query}\u201D` });
  }

  if (!html) {
    html += `<li class="combobox-empty" role="presentation">No specialty matches \u201C${escapeHtml(query)}\u201D.</li>`;
  }

  list.innerHTML = html;
  state.artistSpecialties.options = Array.from(list.querySelectorAll('[role="option"]'));
  state.artistSpecialties.activeIndex = -1;
  input.removeAttribute('aria-activedescendant');

  // Highlight the top prediction so Enter accepts it immediately.
  if (query && state.artistSpecialties.options.length) {
    setArtistSpecialtyActive(0);
  }
}

function setArtistSpecialtyActive(index) {
  const options = state.artistSpecialties.options;
  const input = byId('artistSpecialtiesSearch');
  if (!input || !options.length) return;

  const next = Math.max(0, Math.min(index, options.length - 1));
  options.forEach((option, position) => {
    option.classList.toggle('is-active', position === next);
  });

  state.artistSpecialties.activeIndex = next;
  input.setAttribute('aria-activedescendant', options[next].id);
  options[next].scrollIntoView({ block: 'nearest' });
}

function positionArtistSpecialtyPanel() {
  const list = byId('artistSpecialtiesList');
  const input = byId('artistSpecialtiesSearch');
  if (!list || !input) return;

  const dialog = document.querySelector('#artistModal .modal-dialog');
  const inputRect = input.getBoundingClientRect();
  const bounds = dialog ? dialog.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const spaceBelow = Math.min(bounds.bottom, window.innerHeight) - inputRect.bottom;
  const spaceAbove = inputRect.top - Math.max(bounds.top, 0);
  const needed = Math.min(list.scrollHeight || 236, 240) + 8;

  // Flip the panel upward when the lower part of the modal has no room left.
  list.classList.toggle(
    'combobox-panel--up',
    spaceBelow < needed && spaceAbove > spaceBelow
  );
}

function openArtistSpecialtyPanel(showAll = false) {
  const list = byId('artistSpecialtiesList');
  const input = byId('artistSpecialtiesSearch');
  if (!list || !input) return;

  renderArtistSpecialtyOptions(showAll ? '' : undefined);
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  positionArtistSpecialtyPanel();
}

function closeArtistSpecialtyPanel() {
  const list = byId('artistSpecialtiesList');
  const input = byId('artistSpecialtiesSearch');
  if (!list || !input) return;

  debouncedArtistSpecialtyFilter.cancel();
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  state.artistSpecialties.activeIndex = -1;
  state.artistSpecialties.options.forEach((option) => option.classList.remove('is-active'));
}

function updateArtistSpecialtyChips() {
  const container = byId('artistSpecialtiesChips');
  const hidden = byId('artistSpecialties');
  const clear = byId('artistSpecialtiesClear');
  const selected = state.artistSpecialties.selected;

  if (hidden) hidden.value = selected.join(', ');

  if (container) {
    container.innerHTML = selected
      .map(
        (value) => `
        <button type="button" class="specialty-chip" data-specialty="${escapeAttr(value)}"
                aria-label="Remove ${escapeAttr(value)}">
          <span>${escapeHtml(value)}</span>
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      `
      )
      .join('');
  }

  if (clear) clear.hidden = selected.length === 0;
}

function setArtistSpecialties(values) {
  const seen = new Set();
  const selected = [];

  (values || []).forEach((value) => {
    const text = String(value || '').trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(text);
  });

  state.artistSpecialties.selected = selected;
  updateArtistSpecialtyChips();
}

function addArtistSpecialty(value) {
  const text = String(value || '').trim();
  if (!text) return;

  const key = text.toLowerCase();
  if (!state.artistSpecialties.selected.some((item) => item.toLowerCase() === key)) {
    state.artistSpecialties.selected.push(text);
  }

  updateArtistSpecialtyChips();
}

function removeArtistSpecialty(value) {
  const key = String(value || '').trim().toLowerCase();
  state.artistSpecialties.selected = state.artistSpecialties.selected.filter(
    (item) => item.toLowerCase() !== key
  );
  updateArtistSpecialtyChips();
}

function selectArtistSpecialty(value) {
  addArtistSpecialty(value);
  const input = byId('artistSpecialtiesSearch');
  if (input) {
    input.value = '';
    input.focus();
  }
  openArtistSpecialtyPanel(true);
}

function commitArtistSpecialtyInput() {
  const input = byId('artistSpecialtiesSearch');
  const term = String(input?.value || '').trim();

  if (term) {
    // Accept the best prediction first; fall back to the typed custom value.
    const prediction = canonicalArtistSpecialty(term) || collectArtistSpecialtyGroups(term)[0]?.options[0]?.value || term;
    addArtistSpecialty(prediction);
  }

  if (input) input.value = '';
  closeArtistSpecialtyPanel();
}

const debouncedArtistSpecialtyFilter = debounce(() => {
  renderArtistSpecialtyOptions();
}, 180);

function syncArtistSpecialties(values = []) {
  setArtistSpecialties(values);
  const input = byId('artistSpecialtiesSearch');
  if (input) input.value = '';
  closeArtistSpecialtyPanel();
}

function bindArtistSpecialtyCombobox() {
  const input = byId('artistSpecialtiesSearch');
  const list = byId('artistSpecialtiesList');
  if (!input || !list) return;

  input.addEventListener('focus', () => {
    openArtistSpecialtyPanel(true);
  });

  input.addEventListener('input', () => {
    if (list.hidden) openArtistSpecialtyPanel(false);
    debouncedArtistSpecialtyFilter();
  });

  input.addEventListener('keydown', (event) => {
    const isOpen = !list.hidden;
    const { options, activeIndex } = state.artistSpecialties;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        openArtistSpecialtyPanel(false);
        return;
      }
      setArtistSpecialtyActive(Math.max(0, activeIndex + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openArtistSpecialtyPanel(false);
        return;
      }
      setArtistSpecialtyActive(activeIndex <= 0 ? 0 : activeIndex - 1);
      return;
    }

    if (isOpen && event.key === 'Home') {
      event.preventDefault();
      setArtistSpecialtyActive(0);
      return;
    }

    if (isOpen && event.key === 'End') {
      event.preventDefault();
      setArtistSpecialtyActive(options.length - 1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen && activeIndex >= 0 && options[activeIndex]) {
        selectArtistSpecialty(options[activeIndex].dataset.value || '');
      } else {
        commitArtistSpecialtyInput();
      }
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      // Keep Escape for the dropdown first; a second press closes the modal.
      event.preventDefault();
      event.stopPropagation();
      input.value = '';
      closeArtistSpecialtyPanel();
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      const combobox = byId('artistSpecialtiesCombobox');
      if (combobox?.contains(document.activeElement)) return;
      commitArtistSpecialtyInput();
    }, 120);
  });

  // Keep focus in the search field while an option is clicked.
  list.addEventListener('mousedown', (event) => {
    if (event.target.closest('[role="option"]')) event.preventDefault();
  });

  list.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (!option) return;
    selectArtistSpecialty(option.dataset.value || '');
  });

  byId('artistSpecialtiesClear')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setArtistSpecialties([]);
    input.value = '';
    input.focus();
    openArtistSpecialtyPanel(true);
  });

  byId('artistSpecialtiesChips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-specialty]');
    if (!chip) return;
    removeArtistSpecialty(chip.dataset.specialty || '');
    if (!list.hidden) renderArtistSpecialtyOptions();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#artistSpecialtiesCombobox')) {
      closeArtistSpecialtyPanel();
    }
  });
}

function nextArtistOrder() {
  const orders = state.artists.map((artist) => Number(artist.displayOrder) || 0);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

function openArtistEditor(artist) {
  state.editing.artist = artist || null;

  byId('artistModalTitle').textContent = artist ? 'Edit artist profile' : 'Add artist profile';
  setValue('artistId', artist?.id || '');
  setValue('artistName', artist?.name || '');
  setValue('artistRole', artist?.role || '');
  setValue('artistBio', artist?.bio || '');
  syncArtistSpecialties(artist?.specialties || []);
  setValue('artistInstagram', artist?.instagramUrl || '');
  byId('artistPublished').checked = artist ? artist.isPublished : true;

  setImagePreview(byId('artistAvatarPreview'), artist?.avatarUrl || '');
  resetFileInput('artistAvatarInput');
  openModal('artistModal');
}

async function saveArtist(event) {
  event.preventDefault();

  // Capture whatever is still typed in the predictive specialty field.
  commitArtistSpecialtyInput();

  const button = byId('saveArtistBtn');
  const id = valueOf('artistId');
  const name = valueOf('artistName').trim();
  const file = byId('artistAvatarInput')?.files?.[0] || null;
  const existing = state.editing.artist;

  if (!name) {
    showToast('Add the artist\u2019s name.', 'error');
    byId('artistName')?.focus();
    return;
  }

  setBusy(button, true, 'Saving...');

  try {
    const avatarUrl = file
      ? await uploadImage(file, BUCKETS.gallery, 'artists')
      : existing?.avatarUrl || '';

    const payload = {
      name,
      role: valueOf('artistRole').trim(),
      bio: valueOf('artistBio').trim(),
      specialties: parseList(valueOf('artistSpecialties')),
      avatar_url: avatarUrl,
      instagram_url: valueOf('artistInstagram').trim(),
      is_published: byId('artistPublished').checked,
      display_order: existing?.displayOrder ?? nextArtistOrder(),
      updated_at: nowIso()
    };

    if (id) {
      await updateRow(TABLES.artists, id, payload);
    } else {
      await insertRow(TABLES.artists, { ...payload, created_at: nowIso() });
    }

    closeModal('artistModal');
    await loadAdminArtists(true);
    showToast(id ? 'Artist profile updated.' : 'Artist profile added.', 'success');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function saveArtistOrder(ids) {
  const ordered = applyPartialOrder(sortByOrder(state.artists), ids);
  if (!ordered) return;

  const previous = state.artists;
  state.artists = ordered.map((artist, index) => ({ ...artist, displayOrder: index }));
  renderArtists();

  try {
    await Promise.all(
      state.artists.map((artist, index) =>
        updateRow(TABLES.artists, artist.id, {
          display_order: index,
          updated_at: nowIso()
        })
      )
    );
    showToast('Artist order saved.', 'success');
  } catch (error) {
    state.artists = previous;
    renderArtists();
    showToast(friendlyError(error), 'error');
    await loadAdminArtists(true);
  }
}

async function deleteArtist(artist) {
  await deleteRow(TABLES.artists, artist.id);
  await removeStorageObject(artist.avatarUrl, BUCKETS.gallery);
  await loadAdminArtists(true);
  await loadAdminSiteImages(true);
  showToast('Artist profile deleted.', 'success');
}

/* ==========================================================================
   FAQ TAB
   ========================================================================== */

const FAQ_VIEWS = {
  faqs: {
    listId: 'adminFaqList',
    emptyId: 'faqEmpty',
    matches: (faq) => !isAftercareFaq(faq)
  },
  aftercare: {
    listId: 'adminAftercareFaqList',
    emptyId: 'aftercareFaqEmpty',
    matches: isAftercareFaq
  }
};

function isAftercareFaq(faq) {
  return String(faq?.category || '').trim().toLowerCase() === AFTERCARE_FAQ_CATEGORY;
}

function faqsForView(viewKey) {
  const view = FAQ_VIEWS[viewKey] || FAQ_VIEWS.faqs;
  return sortByOrder(state.faqs.filter(view.matches));
}

async function loadAdminFAQs(force = false) {
  if (state.loaded['faqs-tab'] && !force) return;
  state.loaded['faqs-tab'] = true;
  setContentStatus('connecting');

  const list = byId('adminFaqList');
  if (list) {
    list.innerHTML = `
      <div class="admin-loading">
        <i class="ph ph-circle-notch ph-spin" aria-hidden="true"></i>
        <span>Loading FAQs...</span>
      </div>
    `;
  }

  try {
    const { data, error } = await supabase
      .from(TABLES.faqs)
      .select('*');

    if (error) throw error;

    state.faqs = sortByOrder((data || []).map(normalizeFaq).filter((faq) => faq.id));
    renderFAQs();
    loadAdminSiteImages();
    setContentStatus('connected');
  } catch (error) {
    state.loaded['faqs-tab'] = false;
    if (list) list.innerHTML = '';
    byId('faqEmpty')?.classList.remove('hidden');
    byId('aftercareFaqEmpty')?.classList.remove('hidden');
    setContentStatus('error');
    showToast(friendlyError(error), 'error');
  }
}

function renderFAQs() {
  Object.entries(FAQ_VIEWS).forEach(([viewKey, view]) => {
    const list = byId(view.listId);
    const empty = byId(view.emptyId);
    if (!list || !empty) return;

    const faqs = faqsForView(viewKey);
    list.innerHTML = faqs.map((faq, index) => faqRowHtml(faq, index, faqs.length)).join('');
    empty.classList.toggle('hidden', faqs.length > 0);
  });
}

function faqRowHtml(faq, index, total) {
  return `
    <article class="data-row" data-id="${escapeAttr(faq.id)}" draggable="true">
      <div class="data-row__index">
        <span class="data-row__drag" aria-hidden="true" title="Drag to reorder">
          <i class="ph ph-dots-six-vertical"></i>
        </span>
        <div class="data-row__order">${String(index + 1).padStart(2, '0')}</div>
      </div>
      <div class="data-row__main">
        <h3>${escapeHtml(faq.question)}</h3>
        <p>${escapeHtml(faq.answer)}</p>
        <div class="data-row__meta">
          ${faq.category ? `<span class="chip">${escapeHtml(faq.category)}</span>` : ''}
          <span class="chip ${faq.isPublished ? 'chip--published' : 'chip--draft'}">
            ${faq.isPublished ? 'Published' : 'Draft'}
          </span>
        </div>
      </div>
      <div class="data-row__actions">
        <button type="button" class="btn-icon" data-action="move-faq-up" data-id="${escapeAttr(faq.id)}"
                title="Move up" aria-label="Move FAQ up" ${index === 0 ? 'disabled' : ''}>
          <i class="ph ph-arrow-up" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon" data-action="move-faq-down" data-id="${escapeAttr(faq.id)}"
                title="Move down" aria-label="Move FAQ down" ${index === total - 1 ? 'disabled' : ''}>
          <i class="ph ph-arrow-down" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon" data-action="edit-faq" data-id="${escapeAttr(faq.id)}"
                title="Edit" aria-label="Edit FAQ">
          <i class="ph ph-pencil-simple" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon btn-icon--danger" data-action="delete-faq" data-id="${escapeAttr(faq.id)}"
                title="Delete" aria-label="Delete FAQ">
          <i class="ph ph-trash" aria-hidden="true"></i>
        </button>
      </div>
    </article>
  `;
}

function openFaqEditor(faq, defaultCategory = '') {
  state.editing.faq = faq || null;

  byId('faqModalTitle').textContent = faq ? 'Edit FAQ' : 'Add FAQ';
  setValue('faqId', faq?.id || '');
  setValue('faqQuestion', faq?.question || '');
  setValue('faqAnswer', faq?.answer || '');
  setValue('faqCategory', faq?.category || defaultCategory);
  byId('faqPublished').checked = faq ? faq.isPublished : true;
  openModal('faqModal');
}

async function saveFaq(event) {
  event.preventDefault();

  const button = byId('saveFaqBtn');
  const id = valueOf('faqId');
  const question = valueOf('faqQuestion').trim();
  const answer = valueOf('faqAnswer').trim();

  if (!question || !answer) {
    showToast('Add both the question and the answer.', 'error');
    return;
  }

  setBusy(button, true, 'Saving...');

  try {
    const payload = {
      question,
      answer,
      category: valueOf('faqCategory').trim(),
      is_published: byId('faqPublished').checked,
      display_order: state.editing.faq?.displayOrder ?? state.faqs.length,
      updated_at: nowIso()
    };

    if (id) {
      await updateRow(TABLES.faqs, id, payload);
    } else {
      await insertRow(TABLES.faqs, { ...payload, created_at: nowIso() });
    }

    closeModal('faqModal');
    await loadAdminFAQs(true);
    showToast(id ? 'FAQ updated.' : 'FAQ added.', 'success');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function saveFaqOrder(faqs) {
  const previous = state.faqs;
  const ordered = faqs.map((faq, index) => ({ ...faq, displayOrder: index }));
  const orderedById = new Map(ordered.map((faq) => [faq.id, faq]));

  state.faqs = state.faqs.map((faq) => orderedById.get(faq.id) || faq);
  renderFAQs();

  try {
    await Promise.all(
      ordered.map((faq) =>
        updateRow(TABLES.faqs, faq.id, {
          display_order: faq.displayOrder,
          updated_at: nowIso()
        })
      )
    );

    showToast('FAQ order saved.', 'success');
  } catch (error) {
    state.faqs = previous;
    renderFAQs();
    showToast(friendlyError(error), 'error');
    await loadAdminFAQs(true);
  }
}

function reorderFaqsFromIds(ids, viewKey) {
  const faqs = faqsForView(viewKey);
  const faqsById = new Map(faqs.map((faq) => [faq.id, faq]));
  const ordered = ids.map((id) => faqsById.get(id)).filter(Boolean);
  if (ordered.length !== faqs.length) return;
  saveFaqOrder(ordered);
}

async function reorderFaqs(id, direction, viewKey) {
  const faqs = faqsForView(viewKey);
  const index = faqs.findIndex((faq) => faq.id === id);
  const swapIndex = index + direction;

  if (index === -1 || swapIndex < 0 || swapIndex >= faqs.length) return;

  [faqs[index], faqs[swapIndex]] = [faqs[swapIndex], faqs[index]];
  await saveFaqOrder(faqs);
}

async function deleteFaq(faq) {
  await deleteRow(TABLES.faqs, faq.id);
  await loadAdminFAQs(true);
  showToast('FAQ deleted.', 'success');
}

/* ==========================================================================
   SITE IMAGES (managed from the existing website tabs)
   ========================================================================== */

function ensureSiteImageNotices() {
  all('[data-image-list]').forEach((list) => {
    const card = list.closest('.image-group-card') || list.parentElement;
    if (!card || card.querySelector('[data-image-setup]')) return;

    const note = document.createElement('div');
    note.className = 'image-setup-note hidden';
    note.dataset.imageSetup = '';
    note.innerHTML = `
      <i class="ph ph-warning-circle" aria-hidden="true"></i>
      <div>
        <strong>Image storage is not set up yet.</strong>
        <p>Run <code>docs/migrations/create_admin_editweb_tables.sql</code> in Supabase, then retry.</p>
      </div>
      <button type="button" class="btn-secondary" data-images-retry>Retry</button>
    `;
    list.before(note);
  });
}

function setSiteImagesAvailable(available) {
  state.siteImagesAvailable = available;

  all('[data-image-add]').forEach((button) => {
    button.disabled = !available;
    button.title = available ? '' : 'Run the Supabase migration to enable image uploads.';
  });

  all('[data-image-setup]').forEach((note) => note.classList.toggle('hidden', available));

  if (!available) {
    all('[data-image-empty]').forEach((empty) => empty.classList.add('hidden'));
  }

  // Favorite Works are grouped per artist and rendered separately from the
  // section image lists, so keep their Add buttons in sync as well.
  if (state.siteImagesLoaded) renderFavoriteWorksAdmin();
}

async function loadAdminSiteImages(force = false) {
  ensureSiteImageNotices();
  if (state.siteImagesLoaded && !force) return;
  state.siteImagesLoaded = true;

  try {
    const { data, error } = await supabase
      .from(TABLES.siteImages)
      .select('*');

    if (error) throw error;

    state.siteImages = sortByOrder((data || []).map(normalizeSiteImage).filter((item) => item.id));

    // Older databases predate the Favorite Works -> artist link. Detect it so
    // the dashboard can explain the missing migration instead of quietly
    // saving works without an artist.
    const { error: artistLinkError } = await supabase
      .from(TABLES.siteImages)
      .select('artist_id')
      .limit(1);

    state.favoriteArtistLinkAvailable = !(
      artistLinkError &&
      (missingColumnFrom(artistLinkError) === 'artist_id' ||
        /artist_id/i.test(String(artistLinkError.message || '')))
    );

    setSiteImagesAvailable(true);
    renderSiteImagesAdmin();
  } catch (error) {
    if (isMissingTableError(error)) {
      // Keep this marked as loaded so every tab does not re-query the missing
      // table. The Retry button forces a fresh check after the migration runs.
      state.siteImagesLoaded = true;
      setSiteImagesAvailable(false);
      return;
    }

    state.siteImagesLoaded = false;
    setSiteImagesAvailable(false);
    showToast(friendlyError(error), 'error');
  }
}

function renderSiteImagesAdmin() {
  all('[data-image-list]').forEach((list) => {
    const section = list.dataset.imageList;
    const items = sortByOrder(state.siteImages.filter((item) => item.section === section));
    // With no saved rows the public page falls back to its bundled artwork, so
    // show that default here rather than an empty state.
    const bundled = items.length ? null : BUNDLED_SECTION_IMAGES[section];

    list.innerHTML = items.length
      ? items.map((item, index) => siteImageRowHtml(item, index, items)).join('')
      : bundled
        ? bundledSiteImageRowHtml(section, bundled)
        : '';

    const empty = document.querySelector(`[data-image-empty="${section}"]`);
    empty?.classList.toggle('hidden', items.length > 0 || Boolean(bundled));
  });

  renderFavoriteWorksAdmin();
}

/**
 * Read-only stand-in for a bundled image: it is not a site_images row, so it
 * cannot be reordered, edited or deleted; uploading a real image replaces it.
 */
function bundledSiteImageRowHtml(section, bundled) {
  const previewSrc = bundled.imageUrl
    ? (window.paulinaMediaUrl ? window.paulinaMediaUrl(bundled.imageUrl) : bundled.imageUrl)
    : '';

  return `
    <article class="data-row data-row--default" data-bundled-section="${escapeAttr(section)}">
      <div class="data-row__index">
        <div class="data-row__order">01</div>
      </div>
      <div class="data-row__main site-image-row">
        ${previewSrc ? `<img class="site-image-thumb" src="${escapeAttr(previewSrc)}" alt="${escapeAttr(bundled.alt || bundled.title)}" loading="lazy">` : ''}
        <div>
          <h3>${escapeHtml(bundled.title)}</h3>
          <p>${escapeHtml(bundled.description)}</p>
          <div class="data-row__meta">
            <span class="chip chip--published">
              <i class="ph ph-lock-simple" aria-hidden="true"></i>
              Built-in default
            </span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function siteImageRowHtml(item, index, items) {
  const previewSrc = item.imageUrl
    ? (window.paulinaMediaUrl ? window.paulinaMediaUrl(item.imageUrl) : item.imageUrl)
    : '';
  const title = item.title || item.section;
  const isFavoriteWork = item.section === 'artist-favorites';
  const artistName = isFavoriteWork ? artistNameFor(item.artistId) : '';

  return `
    <article class="data-row" data-id="${escapeAttr(item.id)}" draggable="true">
      <div class="data-row__index">
        <span class="data-row__drag" aria-hidden="true" title="Drag to reorder">
          <i class="ph ph-dots-six-vertical"></i>
        </span>
        <div class="data-row__order">${String(index + 1).padStart(2, '0')}</div>
      </div>
      <div class="data-row__main site-image-row">
        ${previewSrc ? `<img class="site-image-thumb" src="${escapeAttr(previewSrc)}" alt="${escapeAttr(item.alt || title)}" loading="lazy">` : ''}
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(item.description || item.alt || 'No description')}</p>
          <div class="data-row__meta">
            <span class="chip ${item.isPublished ? 'chip--published' : 'chip--draft'}">
              ${item.isPublished ? 'Published' : 'Draft'}
            </span>
            ${
              isFavoriteWork
                ? `<span class="chip ${item.artistId ? '' : 'chip--draft'}">
                     <i class="ph ph-user" aria-hidden="true"></i>
                     ${escapeHtml(artistName)}
                   </span>`
                : ''
            }
          </div>
        </div>
      </div>
      <div class="data-row__actions">
        <button type="button" class="btn-icon" data-action="move-image-up" data-id="${escapeAttr(item.id)}"
                title="Move up" aria-label="Move image up" ${index === 0 ? 'disabled' : ''}>
          <i class="ph ph-arrow-up" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon" data-action="move-image-down" data-id="${escapeAttr(item.id)}"
                title="Move down" aria-label="Move image down" ${index === items.length - 1 ? 'disabled' : ''}>
          <i class="ph ph-arrow-down" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon" data-action="edit-image" data-id="${escapeAttr(item.id)}"
                title="Edit" aria-label="Edit image">
          <i class="ph ph-pencil-simple" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon btn-icon--danger" data-action="delete-image" data-id="${escapeAttr(item.id)}"
                title="Delete" aria-label="Delete image">
          <i class="ph ph-trash" aria-hidden="true"></i>
        </button>
      </div>
    </article>
  `;
}

/* --------------------------------------------------------------------------
   FAVORITE WORKS (grouped per artist)
   -------------------------------------------------------------------------- */

const favoriteWorkArtistKey = (item) => String(item?.artistId || '');

function favoriteWorkItems(artistId = '') {
  const key = String(artistId || '');
  return sortByOrder(
    state.siteImages.filter(
      (item) => item.section === FAVORITE_WORKS_SECTION && favoriteWorkArtistKey(item) === key
    )
  );
}

function favoriteWorkArtistSelectHtml(item, knownIds) {
  const current = favoriteWorkArtistKey(item);
  const selected = knownIds.has(current) ? current : '';

  const options = ['<option value="">Unassigned</option>']
    .concat(
      sortByOrder(state.artists).map(
        (artist) =>
          `<option value="${escapeAttr(artist.id)}"${String(artist.id) === selected ? ' selected' : ''}>${escapeHtml(artist.name)}</option>`
      )
    )
    .join('');

  return `
    <label class="favorite-work-artist">
      <i class="ph ph-user" aria-hidden="true"></i>
      <select data-favorite-artist data-id="${escapeAttr(item.id)}" aria-label="Move this work to an artist">${options}</select>
    </label>
  `;
}

function favoriteWorkRowHtml(item, index, items, knownIds) {
  const previewSrc = item.imageUrl
    ? (window.paulinaMediaUrl ? window.paulinaMediaUrl(item.imageUrl) : item.imageUrl)
    : '';
  const title = item.title || 'Favorite work';

  return `
    <article class="data-row" data-id="${escapeAttr(item.id)}" draggable="true">
      <div class="data-row__index">
        <span class="data-row__drag" aria-hidden="true" title="Drag to reorder">
          <i class="ph ph-dots-six-vertical"></i>
        </span>
        <div class="data-row__order">${String(index + 1).padStart(2, '0')}</div>
      </div>
      <div class="data-row__main site-image-row">
        ${previewSrc ? `<img class="site-image-thumb" src="${escapeAttr(previewSrc)}" alt="${escapeAttr(item.alt || title)}" loading="lazy">` : ''}
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(item.description || item.alt || 'No description')}</p>
          <div class="data-row__meta">
            <span class="chip ${item.isPublished ? 'chip--published' : 'chip--draft'}">
              ${item.isPublished ? 'Published' : 'Draft'}
            </span>
            ${favoriteWorkArtistSelectHtml(item, knownIds)}
          </div>
        </div>
      </div>
      <div class="data-row__actions">
        <button type="button" class="btn-icon" data-action="move-image-up" data-id="${escapeAttr(item.id)}"
                title="Move up" aria-label="Move work up" ${index === 0 ? 'disabled' : ''}>
          <i class="ph ph-arrow-up" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon" data-action="move-image-down" data-id="${escapeAttr(item.id)}"
                title="Move down" aria-label="Move work down" ${index === items.length - 1 ? 'disabled' : ''}>
          <i class="ph ph-arrow-down" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon" data-action="edit-image" data-id="${escapeAttr(item.id)}"
                title="Edit" aria-label="Edit work">
          <i class="ph ph-pencil-simple" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon btn-icon--danger" data-action="delete-image" data-id="${escapeAttr(item.id)}"
                title="Delete" aria-label="Delete work">
          <i class="ph ph-trash" aria-hidden="true"></i>
        </button>
      </div>
    </article>
  `;
}

function favoriteWorkGroupHtml({ artist, items }, knownIds) {
  const isUnassigned = !artist;
  const label = artist?.name || 'Unassigned works';
  const count = items.length;
  const description = isUnassigned
    ? 'These works are not linked to an artist. Choose an artist to move them.'
    : `${count ? `${count} work${count === 1 ? '' : 's'}` : 'No works yet'} \u00b7 Shown in this artist's Favorite Works`;

  return `
    <section class="editweb-card favorite-works-group" data-favorite-group="${escapeAttr(artist?.id || '')}">
      <div class="favorite-works-group__head">
        <div class="favorite-works-group__identity">
          ${
            artist?.avatarUrl
              ? `<img class="favorite-works-group__avatar" src="${escapeAttr(imageOrFallback(artist.avatarUrl, '../../assets/images/mspau.png'))}" alt="" loading="lazy">`
              : `<span class="favorite-works-group__avatar favorite-works-group__avatar--empty"><i class="ph ph-user" aria-hidden="true"></i></span>`
          }
          <div>
            <h3>${escapeHtml(label)}</h3>
            <p>${escapeHtml(description)}</p>
          </div>
        </div>
        ${
          artist
            ? `<button type="button" class="btn-secondary" data-action="add-favorite" data-artist-id="${escapeAttr(artist.id)}"
                       ${state.siteImagesAvailable && state.favoriteArtistLinkAvailable ? '' : 'disabled'}>
                 <i class="ph ph-plus" aria-hidden="true"></i> Add work
               </button>`
            : ''
        }
      </div>
      ${
        count
          ? `<div class="data-list">${items
              .map((item, index) => favoriteWorkRowHtml(item, index, items, knownIds))
              .join('')}</div>`
          : `<p class="favorite-works-group__empty">${
              artist ? 'No Favorite Works assigned yet.' : 'Every work is linked to an artist.'
            }</p>`
      }
    </section>
  `;
}

const FAVORITE_WORKS_MIGRATION = 'docs/migrations/add_favorite_works_artist_link.sql';
const favoriteArtistLinkMessage = () =>
  `Favorite Works cannot be assigned to artists yet: the site_images.artist_id column is missing. Run ${FAVORITE_WORKS_MIGRATION} in the Supabase SQL editor, then reload this page.`;

function renderFavoriteWorksAdmin() {
  const container = byId('adminFavoriteWorks');
  if (!container) return;

  const empty = document.querySelector('[data-favorite-empty]');
  const canAssign = state.favoriteArtistLinkAvailable;
  const artists = sortByOrder(state.artists);
  const knownIds = new Set(artists.map((artist) => String(artist.id)));

  const groups = artists.map((artist) => ({ artist, items: favoriteWorkItems(artist.id) }));
  const unassigned = sortByOrder(
    state.siteImages.filter(
      (item) =>
        item.section === FAVORITE_WORKS_SECTION &&
        (!favoriteWorkArtistKey(item) || !knownIds.has(favoriteWorkArtistKey(item)))
    )
  );

  const total = unassigned.length + groups.reduce((count, group) => count + group.items.length, 0);
  empty?.classList.toggle('hidden', total > 0 || !artists.length);

  container.innerHTML = [
    canAssign
      ? ''
      : `<p class="favorite-works-setup"><i class="ph ph-warning-circle" aria-hidden="true"></i>${escapeHtml(
          favoriteArtistLinkMessage()
        )}</p>`,
    ...groups.map((group) => favoriteWorkGroupHtml(group, knownIds)),
    unassigned.length ? favoriteWorkGroupHtml({ artist: null, items: unassigned }, knownIds) : '',
    artists.length
      ? state.siteImagesAvailable
        ? ''
        : `<p class="favorite-works-group__empty">Image storage is not set up yet. Run <code>docs/migrations/create_admin_editweb_tables.sql</code> in Supabase, then retry.</p>`
      : `<p class="favorite-works-group__empty">Add an artist profile first, then publish Favorite Works for that artist.</p>`
  ].join('');

  if (!canAssign) {
    all('[data-favorite-artist]', container).forEach((select) => {
      select.disabled = true;
    });
  }

  bindFavoriteWorkDrag();
}

// Each artist's list is rebuilt on every render, so the drag handlers are
// attached to the freshly created lists rather than once at boot.
function bindFavoriteWorkDrag() {
  all('#adminFavoriteWorks .favorite-works-group').forEach((group) => {
    const list = group.querySelector('.data-list');
    if (!list) return;

    const artistId = group.dataset.favoriteGroup || '';

    initDragReorder(list, '.data-row', '.data-row__drag', (ids) => {
      const byId = new Map(favoriteWorkItems(artistId).map((row) => [row.id, row]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      if (ordered.length !== byId.size) return;
      saveFavoriteWorkOrder(artistId, ordered);
    });
  });
}

async function saveFavoriteWorkOrder(artistId, images) {
  const previous = state.siteImages;
  const ordered = images.map((item, index) => ({ ...item, displayOrder: index }));
  const orderedById = new Map(ordered.map((item) => [item.id, item]));

  state.siteImages = state.siteImages.map((item) => orderedById.get(item.id) || item);
  renderFavoriteWorksAdmin();

  try {
    await Promise.all(
      ordered.map((item, order) =>
        updateRow(TABLES.siteImages, item.id, {
          display_order: order,
          updated_at: nowIso()
        })
      )
    );
    showToast('Favorite Works order saved.', 'success');
  } catch (error) {
    state.siteImages = previous;
    renderFavoriteWorksAdmin();
    showToast(friendlyError(error), 'error');
    await loadAdminSiteImages(true);
  }
}

async function reorderFavoriteWork(item, direction) {
  const scope = favoriteWorkArtistKey(item);
  const images = favoriteWorkItems(scope);
  const index = images.findIndex((row) => row.id === item.id);
  const swapIndex = index + direction;

  if (index === -1 || swapIndex < 0 || swapIndex >= images.length) return;

  [images[index], images[swapIndex]] = [images[swapIndex], images[index]];
  await saveFavoriteWorkOrder(scope, images);
}

async function assignFavoriteWorkArtist(item, artistId) {
  if (!state.favoriteArtistLinkAvailable) {
    showToast(favoriteArtistLinkMessage(), 'error');
    renderFavoriteWorksAdmin();
    return;
  }

  const nextArtistId = String(artistId || '');
  if (nextArtistId === favoriteWorkArtistKey(item)) return;

  const previous = state.siteImages;
  // Reassigning appends the work to the end of the target artist's section.
  const position = favoriteWorkItems(nextArtistId).filter((row) => row.id !== item.id).length;

  state.siteImages = state.siteImages.map((row) =>
    row.id === item.id ? { ...row, artistId: nextArtistId, displayOrder: position } : row
  );
  renderFavoriteWorksAdmin();

  try {
    await updateRow(TABLES.siteImages, item.id, {
      artist_id: nextArtistId || null,
      display_order: position,
      updated_at: nowIso()
    });
    showToast(
      nextArtistId
        ? `Work moved to ${artistNameFor(nextArtistId)}'s Favorite Works.`
        : 'Work unassigned.',
      'success'
    );
  } catch (error) {
    state.siteImages = previous;
    renderFavoriteWorksAdmin();
    showToast(friendlyError(error), 'error');
  }
}

function populateSiteImageArtistOptions(selected = '') {
  const select = byId('siteImageArtist');
  if (!select) return;

  const artists = sortByOrder(state.artists);
  const options = ['<option value="">Select an artist...</option>'];

  artists.forEach((artist) => {
    options.push(
      `<option value="${escapeAttr(artist.id)}">${escapeHtml(artist.name)}</option>`
    );
  });

  if (!artists.length) {
    options.push('<option value="" disabled>Add an artist profile first</option>');
  }

  select.innerHTML = options.join('');
  // Preselect the only artist so a single-artist studio needs no extra click.
  select.value = selected || (artists.length === 1 ? artists[0].id : '');
  if (!select.value) select.value = '';
}

function openSiteImageEditor(item, section, presetArtistId = '') {
  const requestedSection = item?.section || section || 'home-studio';

  if (!item && requestedSection === FAVORITE_WORKS_SECTION && !state.favoriteArtistLinkAvailable) {
    showToast(favoriteArtistLinkMessage(), 'error');
    return;
  }

  state.editing.siteImage = item || null;

  const resolvedSection = requestedSection;
  const select = byId('siteImageSection');

  if (select) {
    select.innerHTML = SITE_IMAGE_SECTIONS
      .filter(([value]) => value === resolvedSection)
      .map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`)
      .join('');
    select.value = resolvedSection;
  }

  const isFavoriteWork = resolvedSection === FAVORITE_WORKS_SECTION;
  const artistIdForForm = item?.artistId || presetArtistId || '';
  byId('siteImageArtistField')?.classList.toggle('hidden', !isFavoriteWork);
  if (isFavoriteWork) populateSiteImageArtistOptions(artistIdForForm);

  const artistSelect = byId('siteImageArtist');
  if (artistSelect) artistSelect.disabled = isFavoriteWork && !state.favoriteArtistLinkAvailable;

  byId('siteImageModalTitle').textContent = isFavoriteWork
    ? item
      ? 'Edit Favorite Work'
      : 'Add Favorite Work'
    : `${item ? 'Edit' : 'Add'} ${siteImageSectionLabel(resolvedSection)}`;
  setValue('siteImageId', item?.id || '');
  setValue('siteImageTitle', item?.title || '');
  setValue('siteImageSubtitle', item?.subtitle || '');
  setValue('siteImageAlt', item?.alt || '');
  setValue('siteImageDescription', item?.description || '');
  byId('siteImagePublished').checked = item ? item.isPublished : true;

  setImagePreview(byId('siteImagePreview'), item?.imageUrl || '');
  resetFileInput('siteImageInput');
  openModal('siteImageModal');
}

async function saveSiteImage(event) {
  event.preventDefault();

  const button = byId('saveSiteImageBtn');
  const id = valueOf('siteImageId');
  const existing = state.siteImages.find((item) => item.id === id) || null;
  const section = valueOf('siteImageSection');
  const isFavoriteWork = section === FAVORITE_WORKS_SECTION;
  const artistId = isFavoriteWork ? valueOf('siteImageArtist') : '';
  const file = byId('siteImageInput')?.files?.[0] || null;

  if (isFavoriteWork && !state.favoriteArtistLinkAvailable) {
    showToast(favoriteArtistLinkMessage(), 'error');
    return;
  }

  if (isFavoriteWork && !artistId) {
    showToast('Choose the artist this Favorite Work belongs to.', 'error');
    byId('siteImageArtist')?.focus();
    return;
  }

  setBusy(button, true, 'Saving...');

  try {
    let imageUrl = existing?.imageUrl || '';
    if (file) {
      imageUrl = await uploadImage(file, BUCKETS.gallery, `site-images/${section}`);
    }

    if (!imageUrl) {
      throw new Error('Choose an image to publish.');
    }

    // A work that is new to an artist (or moved to another artist) always lands
    // at the end of that artist's Favorite Works section.
    const artistChanged = isFavoriteWork && existing && favoriteWorkArtistKey(existing) !== artistId;
    const displayOrder =
      isFavoriteWork && (!existing || artistChanged)
        ? favoriteWorkItems(artistId).filter((row) => row.id !== existing?.id).length
        : existing?.displayOrder ??
          (isFavoriteWork
            ? favoriteWorkItems(artistId).length
            : state.siteImages.filter((row) => row.section === section).length);

    const payload = {
      section,
      artist_id: artistId || null,
      title: valueOf('siteImageTitle').trim(),
      subtitle: valueOf('siteImageSubtitle').trim(),
      alt_text: valueOf('siteImageAlt').trim(),
      description: valueOf('siteImageDescription').trim(),
      image_url: imageUrl,
      is_published: byId('siteImagePublished').checked,
      display_order: displayOrder,
      updated_at: nowIso()
    };

    if (id) {
      await updateRow(TABLES.siteImages, id, payload);
    } else {
      await insertRow(TABLES.siteImages, { ...payload, created_at: nowIso() });
    }

    if (file && existing?.imageUrl && existing.imageUrl !== imageUrl) {
      await removeStorageObject(existing.imageUrl, BUCKETS.gallery);
    }

    closeModal('siteImageModal');
    await loadAdminSiteImages(true);
    showToast(id ? 'Image updated.' : 'Image added.', 'success');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function saveSectionImageOrder(section, images) {
  const previous = state.siteImages;
  const ordered = images.map((item, index) => ({ ...item, displayOrder: index }));
  const orderedById = new Map(ordered.map((item) => [item.id, item]));

  state.siteImages = state.siteImages.map((item) => orderedById.get(item.id) || item);
  renderSiteImagesAdmin();

  try {
    await Promise.all(
      ordered.map((item, order) =>
        updateRow(TABLES.siteImages, item.id, {
          display_order: order,
          updated_at: nowIso()
        })
      )
    );

    showToast('Image order saved.', 'success');
  } catch (error) {
    state.siteImages = previous;
    renderSiteImagesAdmin();
    showToast(friendlyError(error), 'error');
    await loadAdminSiteImages(true);
  }
}

async function reorderSiteImages(item, direction) {
  const images = sortByOrder(state.siteImages.filter((row) => row.section === item.section));
  const index = images.findIndex((row) => row.id === item.id);
  const swapIndex = index + direction;

  if (index === -1 || swapIndex < 0 || swapIndex >= images.length) return;

  [images[index], images[swapIndex]] = [images[swapIndex], images[index]];
  await saveSectionImageOrder(item.section, images);
}

async function deleteSiteImage(item) {
  await removeStorageObject(item.imageUrl, BUCKETS.gallery);
  await deleteRow(TABLES.siteImages, item.id);
  await loadAdminSiteImages(true);
  showToast('Image deleted.', 'success');
}

/* ==========================================================================
   BOOKING INFO TAB
   ========================================================================== */

async function loadAdminBooking(force = false) {
  if (state.loaded['booking-tab'] && !force) return;
  state.loaded['booking-tab'] = true;
  setContentStatus('connecting');

  try {
    const saved = await getSetting('booking', bookingDefaults());
    state.booking = { ...bookingDefaults(), ...saved };
    populateBookingForm();
    loadAdminSiteImages();
    setContentStatus('connected');
  } catch (error) {
    state.loaded['booking-tab'] = false;
    populateBookingForm();
    setContentStatus('error');
    showToast(friendlyError(error), 'error');
  }
}

function populateBookingForm() {
  setValue('bookingIntro', state.booking.intro);
  setValue('bookingDepositAmount', state.booking.depositAmount);
  setValue('bookingLeadTime', state.booking.leadTime);
  setValue('bookingDepositNote', state.booking.depositNote);
  setValue('bookingCancellationPolicy', state.booking.cancellationPolicy);
  setValue('bookingReschedulePolicy', state.booking.reschedulePolicy);
  setValue('bookingPaymentMethods', state.booking.paymentMethods);
  setValue('bookingArrivalInstructions', state.booking.arrivalInstructions);
  setValue('bookingContactEmail', state.booking.contactEmail);
  setValue('bookingContactPhone', state.booking.contactPhone);
}

async function saveBookingContent(event) {
  event.preventDefault();

  const button = byId('saveBookingBtn');
  setBusy(button, true, 'Saving...');

  const payload = {
    intro: valueOf('bookingIntro').trim(),
    depositAmount: valueOf('bookingDepositAmount').trim(),
    leadTime: valueOf('bookingLeadTime').trim(),
    depositNote: valueOf('bookingDepositNote').trim(),
    cancellationPolicy: valueOf('bookingCancellationPolicy').trim(),
    reschedulePolicy: valueOf('bookingReschedulePolicy').trim(),
    paymentMethods: valueOf('bookingPaymentMethods').trim(),
    arrivalInstructions: valueOf('bookingArrivalInstructions').trim(),
    contactEmail: valueOf('bookingContactEmail').trim(),
    contactPhone: valueOf('bookingContactPhone').trim()
  };

  try {
    state.booking = payload;
    await saveSetting('booking', payload);
    setInlineStatus('bookingFormStatus', 'Booking information saved.', 'success');
    showToast('Booking information saved.', 'success');
  } catch (error) {
    setInlineStatus('bookingFormStatus', friendlyError(error), 'error');
    showToast(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

/* ==========================================================================
   MODALS / CONFIRMATION
   ========================================================================== */

function openModal(modalId) {
  const modal = byId(modalId);
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  const focusTarget = modal.querySelector(
    'input:not([type="hidden"]):not([hidden]), select, textarea, button'
  );
  window.setTimeout(() => focusTarget?.focus({ preventScroll: true }), 30);
}

function closeModal(modalId) {
  const modal = byId(modalId);
  if (!modal) return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');

  if (!document.querySelector('.modal-backdrop:not(.hidden)')) {
    document.body.classList.remove('modal-open');
  }

  if (modalId === 'confirmModal') {
    state.confirmAction = null;
  }

  if (modalId === 'galleryModal') {
    closeGalleryBodyPartPanel();
  }
}

function bindModalDismissals() {
  all('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  all('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openModals = all('.modal-backdrop:not(.hidden)');
    const topModal = openModals[openModals.length - 1];
    if (topModal) closeModal(topModal.id);
  });
}

function askConfirm({ title, message, confirmLabel = DEFAULT_CONFIRM_LABEL, action }) {
  state.confirmAction = action;

  byId('confirmModalTitle').textContent = title;
  byId('confirmModalBody').textContent = message;
  byId('confirmModalOk').textContent = confirmLabel;

  openModal('confirmModal');
}

/* ==========================================================================
   IMAGE PREVIEWS / DROPZONES
   ========================================================================== */

function setImagePreview(image, url) {
  if (!image) return;

  if (url) {
    image.src = window.paulinaMediaUrl ? window.paulinaMediaUrl(url) : url;
    image.classList.remove('is-empty');
  } else {
    image.removeAttribute('src');
    image.classList.add('is-empty');
  }
}

function resetFileInput(id) {
  const input = byId(id);
  if (input) input.value = '';
}

function previewFile(image, file) {
  if (!image || !file) return;

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    image.src = String(reader.result || '');
    image.classList.remove('is-empty');
  });
  reader.readAsDataURL(file);
}

function bindImagePicker(dropzoneId, inputId, previewId) {
  const dropzone = byId(dropzoneId);
  const input = byId(inputId);
  const preview = byId(previewId);

  if (!dropzone || !input || !preview) return;

  const browse = () => input.click();

  // Keep the synthetic input click from bubbling back into the dropzone
  // handler, which would otherwise re-open the picker recursively.
  input.addEventListener('click', (event) => event.stopPropagation());

  dropzone.addEventListener('click', browse);
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      browse();
    }
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) previewFile(preview, file);
  });

  ['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
    });
  });

  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    } catch {
      // Some browsers do not allow programmatic FileList assignment.
    }

    previewFile(preview, file);
  });
}

/* ==========================================================================
   EVENT BINDING
   ========================================================================== */

function initDragReorder(container, itemSelector, handleSelector, onReorder) {
  if (!container) return;

  let dragHandleItem = null;
  let draggedItem = null;
  const originalOrder = () =>
    [...container.querySelectorAll(itemSelector)].map((item) => item.dataset.id).join('|');
  let orderBeforeDrag = originalOrder();

  const clearHandle = () => {
    dragHandleItem?.classList.remove('is-drag-armed');
    dragHandleItem = null;
  };

  container.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest(handleSelector);
    const item = handle?.closest(itemSelector);
    dragHandleItem = item && container.contains(item) ? item : null;
    dragHandleItem?.classList.add('is-drag-armed');
  });

  container.addEventListener('pointerup', () => {
    if (!draggedItem) clearHandle();
  });

  container.addEventListener('pointercancel', () => {
    if (!draggedItem) clearHandle();
  });

  container.addEventListener('dragstart', (event) => {
    const item = event.target.closest(itemSelector);
    if (!item || item !== dragHandleItem) {
      event.preventDefault();
      return;
    }

    draggedItem = item;
    orderBeforeDrag = originalOrder();
    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', item.dataset.id || '');
    } catch {
      // Some browsers expose a read-only dataTransfer during synthetic drags.
    }
  });

  container.addEventListener('dragover', (event) => {
    if (!draggedItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const target = event.target.closest(itemSelector);
    if (!target || target === draggedItem) return;

    const rect = target.getBoundingClientRect();
    const isGrid = getComputedStyle(container).display.includes('grid');
    const insertAfter = isGrid
      ? event.clientX > rect.left + rect.width / 2
      : event.clientY > rect.top + rect.height / 2;

    target.parentNode.insertBefore(draggedItem, insertAfter ? target.nextSibling : target);
  });

  container.addEventListener('drop', (event) => {
    if (draggedItem) event.preventDefault();
  });

  container.addEventListener('dragend', () => {
    if (!draggedItem) return;

    const item = draggedItem;
    draggedItem = null;
    item.classList.remove('is-dragging');
    clearHandle();

    const nextOrder = originalOrder();
    if (nextOrder === orderBeforeDrag) return;

    // The drag can otherwise end with a click on the card underneath.
    const swallowClick = (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
    };
    container.addEventListener('click', swallowClick, true);
    window.setTimeout(() => container.removeEventListener('click', swallowClick, true), 300);

    onReorder(nextOrder.split('|'));
  });
}

function bindHomeEvents() {
  byId('homeContentForm')?.addEventListener('submit', saveHomeContent);
  byId('refreshHeroBtn')?.addEventListener('click', () => loadAdminHero(true));
  byId('bannerForm')?.addEventListener('submit', saveBanner);

  byId('heroBannersGrid')?.addEventListener('click', (event) => {
    const card = event.target.closest('.hero-slide-card');
    if (!card) return;

    const banner = state.home.banners.find((item) => item.id === card.dataset.id);
    if (!banner) return;

    const action = event.target.closest('[data-action]');
    if (action?.dataset.action === 'delete-banner') {
      deleteBanner(banner);
      return;
    }

    openBannerEditor(banner);
  });

  initDragReorder(
    byId('heroBannersGrid'),
    '.hero-slide-card',
    '.admin-edit-card__drag',
    saveBannerOrder
  );

  bindImagePicker('bannerImageDropzone', 'bannerImageInput', 'bannerImagePreview');

  const openHeroPicker = () => byId('heroUploadInput')?.click();

  byId('heroUploadBtn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    openHeroPicker();
  });

  byId('heroUploadDropzone')?.addEventListener('click', (event) => {
    if (!event.target.closest('button')) openHeroPicker();
  });

  byId('heroUploadInput')?.addEventListener('click', (event) => event.stopPropagation());

  byId('heroUploadInput')?.addEventListener('change', (event) => {
    handleHeroUpload(event.target.files);
  });

  const heroDropzone = byId('heroUploadDropzone');
  if (heroDropzone) {
    ['dragenter', 'dragover'].forEach((type) => {
      heroDropzone.addEventListener(type, (event) => {
        event.preventDefault();
        heroDropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'drop'].forEach((type) => {
      heroDropzone.addEventListener(type, (event) => {
        event.preventDefault();
        heroDropzone.classList.remove('is-dragover');
      });
    });

    heroDropzone.addEventListener('drop', (event) => {
      if (event.dataTransfer?.files?.length) handleHeroUpload(event.dataTransfer.files);
    });
  }
}

function bindGalleryEvents() {
  byId('galleryAddBtn')?.addEventListener('click', () => openGalleryEditor(null));

  byId('gallerySearch')?.addEventListener('input', (event) => {
    clearTimeout(state.gallerySearchTimer);
    state.gallerySearchTimer = window.setTimeout(() => {
      state.filters.gallery.search = event.target.value;
      renderGallery();
    }, 180);
  });

  byId('galleryCategoryFilter')?.addEventListener('change', (event) => {
    state.filters.gallery.category = event.target.value;
    renderGallery();
  });

  byId('galleryVisibilityFilter')?.addEventListener('change', (event) => {
    state.filters.gallery.visibility = event.target.value;
    renderGallery();
  });

  byId('adminGalleryGrid')?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;

    const item = state.gallery.find((row) => row.id === action.dataset.id);
    if (!item) return;

    if (action.dataset.action === 'edit-gallery') {
      openGalleryEditor(item);
    } else if (action.dataset.action === 'delete-gallery') {
      askConfirm({
        title: 'Delete gallery image',
        message: `Delete \u201c${item.title}\u201d from the gallery and Storage?`,
        confirmLabel: 'Delete work',
        action: () => deleteGalleryItem(item)
      });
    }
  });

  initDragReorder(
    byId('adminGalleryGrid'),
    '.admin-edit-card',
    '.admin-edit-card__drag',
    saveGalleryOrder
  );

  byId('galleryForm')?.addEventListener('submit', saveGalleryItem);
  byId('galleryCategory')?.addEventListener('change', () => syncGallerySubcategories());
  bindGalleryBodyPartCombobox();
  bindImagePicker('galleryImageDropzone', 'galleryImageInput', 'galleryImagePreview');
}

function bindCatalogueEvents() {
  byId('catalogueAddBtn')?.addEventListener('click', () => openCatalogueEditor(null));

  byId('catalogueSearch')?.addEventListener('input', (event) => {
    clearTimeout(state.catalogueSearchTimer);
    state.catalogueSearchTimer = window.setTimeout(() => {
      state.filters.catalogue.search = event.target.value;
      renderCatalogue();
    }, 180);
  });

  byId('catalogueCategoryFilter')?.addEventListener('change', (event) => {
    state.filters.catalogue.category = event.target.value;
    renderCatalogue();
  });

  byId('catalogueVisibilityFilter')?.addEventListener('change', (event) => {
    state.filters.catalogue.visibility = event.target.value;
    renderCatalogue();
  });

  byId('adminCatalogueGrid')?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;

    const item = state.catalogue.find((row) => row.id === action.dataset.id);
    if (!item) return;

    if (action.dataset.action === 'edit-catalogue') {
      openCatalogueEditor(item);
    } else if (action.dataset.action === 'delete-catalogue') {
      askConfirm({
        title: 'Delete catalogue item',
        message: `Delete \u201c${item.name}\u201d from the catalogue and Storage?`,
        confirmLabel: 'Delete item',
        action: () => deleteCatalogueItem(item)
      });
    }
  });

  initDragReorder(
    byId('adminCatalogueGrid'),
    '.admin-edit-card',
    '.admin-edit-card__drag',
    saveCatalogueOrder
  );

  byId('catalogueForm')?.addEventListener('submit', saveCatalogueItem);
  bindImagePicker('catalogueImageDropzone', 'catalogueImageInput', 'catalogueImagePreview');
}

function bindArtistEvents() {
  byId('artistAddBtn')?.addEventListener('click', () => openArtistEditor(null));

  byId('adminArtistGrid')?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;

    const artist = state.artists.find((row) => row.id === action.dataset.id);
    if (!artist) return;

    if (action.dataset.action === 'edit-artist') {
      openArtistEditor(artist);
    } else if (action.dataset.action === 'delete-artist') {
      askConfirm({
        title: 'Delete artist profile',
        message: `Remove \u201c${artist.name}\u201d from the public artist page?`,
        confirmLabel: 'Delete profile',
        action: () => deleteArtist(artist)
      });
    }
  });

  initDragReorder(
    byId('adminArtistGrid'),
    '.admin-edit-card',
    '.admin-edit-card__drag',
    saveArtistOrder
  );

  byId('artistForm')?.addEventListener('submit', saveArtist);
  bindArtistSpecialtyCombobox();
  bindImagePicker('artistAvatarDropzone', 'artistAvatarInput', 'artistAvatarPreview');
}

function bindFaqEvents() {
  byId('faqAddBtn')?.addEventListener('click', () => openFaqEditor(null));
  byId('aftercareFaqAddBtn')?.addEventListener('click', () => openFaqEditor(null, 'Aftercare'));
  byId('faqForm')?.addEventListener('submit', saveFaq);

  Object.entries(FAQ_VIEWS).forEach(([viewKey, view]) => {
    const list = byId(view.listId);
    if (!list) return;

    initDragReorder(
      list,
      '.data-row',
      '.data-row__drag',
      (ids) => reorderFaqsFromIds(ids, viewKey)
    );

    list.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;

      const faq = state.faqs.find((row) => row.id === action.dataset.id);
      if (!faq) return;

      switch (action.dataset.action) {
        case 'edit-faq':
          openFaqEditor(faq);
          break;
        case 'delete-faq':
          askConfirm({
            title: 'Delete FAQ',
            message: `Delete \u201c${faq.question}\u201d from the ${viewKey === 'aftercare' ? 'aftercare' : 'FAQ'} page?`,
            confirmLabel: 'Delete question',
            action: () => deleteFaq(faq)
          });
          break;
        case 'move-faq-up':
          reorderFaqs(faq.id, -1, viewKey);
          break;
        case 'move-faq-down':
          reorderFaqs(faq.id, 1, viewKey);
          break;
        default:
          break;
      }
    });
  });
}

function bindSiteImageEvents() {
  ensureSiteImageNotices();
  byId('siteImageForm')?.addEventListener('submit', saveSiteImage);

  document.addEventListener('click', async (event) => {
    const retry = event.target.closest('[data-images-retry]');
    if (!retry) return;
    setBusy(retry, true, 'Checking...');
    await loadAdminSiteImages(true);
    setBusy(retry, false);
  });

  all('[data-image-add]').forEach((button) => {
    button.addEventListener('click', () => openSiteImageEditor(null, button.dataset.imageAdd));
  });

  const favoriteGroups = byId('adminFavoriteWorks');

  favoriteGroups?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;

    const item = state.siteImages.find((row) => row.id === action.dataset.id);

    switch (action.dataset.action) {
      case 'add-favorite':
        openSiteImageEditor(null, FAVORITE_WORKS_SECTION, action.dataset.artistId || '');
        break;
      case 'edit-image':
        if (item) openSiteImageEditor(item, item.section);
        break;
      case 'delete-image':
        if (!item) break;
        askConfirm({
          title: 'Delete Favorite Work',
          message: `Delete \u201c${item.title || 'this work'}\u201d from ${artistNameFor(item.artistId)} and Storage?`,
          confirmLabel: 'Delete work',
          action: () => deleteSiteImage(item)
        });
        break;
      case 'move-image-up':
        if (item) reorderFavoriteWork(item, -1);
        break;
      case 'move-image-down':
        if (item) reorderFavoriteWork(item, 1);
        break;
      default:
        break;
    }
  });

  favoriteGroups?.addEventListener('change', (event) => {
    const select = event.target.closest('[data-favorite-artist]');
    if (!select) return;

    const item = state.siteImages.find((row) => row.id === select.dataset.id);
    if (item) assignFavoriteWorkArtist(item, select.value);
  });

  all('[data-image-list]').forEach((list) => {
    initDragReorder(list, '.data-row', '.data-row__drag', (ids) => {
      const section = list.dataset.imageList;
      const current = sortByOrder(state.siteImages.filter((row) => row.section === section));
      const byId = new Map(current.map((row) => [row.id, row]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      if (ordered.length !== current.length) return;
      saveSectionImageOrder(section, ordered);
    });

    list.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;

      const item = state.siteImages.find((row) => row.id === action.dataset.id);
      if (!item) return;

      switch (action.dataset.action) {
        case 'edit-image':
          openSiteImageEditor(item, item.section);
          break;
        case 'delete-image':
          askConfirm({
            title: 'Delete image',
            message: `Delete this image from ${siteImageSectionLabel(item.section)} and Storage?`,
            confirmLabel: 'Delete image',
            action: () => deleteSiteImage(item)
          });
          break;
        case 'move-image-up':
          reorderSiteImages(item, -1);
          break;
        case 'move-image-down':
          reorderSiteImages(item, 1);
          break;
        default:
          break;
      }
    });
  });

  bindImagePicker('siteImageDropzone', 'siteImageInput', 'siteImagePreview');
}

function bindTabRetryEvents() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-grid-retry]');
    if (!button) return;

    if (button.dataset.gridRetry === 'gallery') loadAdminGallery(true);
    if (button.dataset.gridRetry === 'catalogue') loadAdminCatalogue(true);
  });
}

function bindBookingEvents() {
  byId('bookingContentForm')?.addEventListener('submit', saveBookingContent);
  byId('refreshBookingBtn')?.addEventListener('click', () => loadAdminBooking(true));
}

function bindConfirmEvents() {
  byId('confirmModalCancel')?.addEventListener('click', () => closeModal('confirmModal'));

  byId('confirmModalOk')?.addEventListener('click', async () => {
    const action = state.confirmAction;
    if (!action) return;

    const button = byId('confirmModalOk');
    setBusy(button, true, 'Working...');

    try {
      await action();
      closeModal('confirmModal');
    } catch (error) {
      showToast(friendlyError(error), 'error');
      closeModal('confirmModal');
    } finally {
      setBusy(button, false);
      state.confirmAction = null;
    }
  });
}

/* ==========================================================================
   BOOTSTRAP
   ========================================================================== */

function init() {
  bindTabs();
  bindSectionTabs();
  initGalleryRealtime();
  bindHomeEvents();
  bindGalleryEvents();
  bindCatalogueEvents();
  bindArtistEvents();
  bindFaqEvents();
  bindSiteImageEvents();
  bindTabRetryEvents();
  bindBookingEvents();
  bindConfirmEvents();
  bindModalDismissals();

  activateTab(tabFromHash(), { updateHash: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
