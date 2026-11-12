'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LOCAL_BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');

const { createClient } = require('@supabase/supabase-js');

let supabaseClient = null;
const SUPABASE_TIMEOUT_MS = 3000;
// When Supabase is unreachable, skip it for a while instead of making every
// admin request wait for the same failed connection before using the local file.
const SUPABASE_RETRY_AFTER_MS = 60000;
let supabaseUnavailableUntil = 0;

// Catches the sample values that ship with .env.example (in any casing) so a
// placeholder project never puts the store into a mode that stalls on a host
// that does not exist.
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

function getBookingsTable() {
  return (
    process.env.SUPABASE_BOOKINGS_TABLE ||
    process.env.FIRESTORE_BOOKINGS_COLLECTION ||
    'bookings'
  ).trim();
}

/**
 * Lazily create the Supabase server client using the service_role key.
 * Falls back to null when credentials are placeholder or missing (local-json path taken below).
 */
function getSupabase() {
  if (!isRealSupabaseConfigured()) return null;
  if (supabaseUnavailableUntil > Date.now()) return null;

  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
}

/** Stops retrying a store that just failed so admin pages stay responsive. */
function markSupabaseUnavailable() {
  supabaseUnavailableUntil = Date.now() + SUPABASE_RETRY_AFTER_MS;
}

/**
 * The Supabase client retries an unreachable host a few times before giving
 * up, which made the admin page sit on a loading state for seven seconds.
 * Racing the query keeps the local-file fallback instant.
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Supabase request timed out.')), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

let localWriteQueue = Promise.resolve();

/**
 * Runs local file writes one at a time so two bookings saved at the same
 * moment cannot overwrite each other's record.
 */
function enqueueLocalTask(task) {
  const run = localWriteQueue.then(task, task);
  localWriteQueue = run.catch(() => {});
  return run;
}

function enqueueLocalWrite(booking) {
  return enqueueLocalTask(async () => {
    const bookings = await readLocalBookings();
    bookings.push({ ...normalizeBookingRecord(booking), createdAt: new Date().toISOString() });
    await writeLocalBookings(bookings);
  });
}

function enqueueLocalUpdate(reference, patch) {
  return enqueueLocalTask(async () => {
    const bookings = await readLocalBookings();
    const index = bookings.findIndex((record) => record.reference === reference);

    if (index === -1) return false;

    bookings[index] = {
      ...bookings[index],
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await writeLocalBookings(bookings);
    return true;
  });
}

function enqueueLocalDelete(reference) {
  return enqueueLocalTask(async () => {
    const bookings = await readLocalBookings();
    const index = bookings.findIndex((record) => record.reference === reference);
    if (index === -1) return false;
    bookings.splice(index, 1);
    await writeLocalBookings(bookings);
    return true;
  });
}

async function writeLocalBookings(bookings) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    LOCAL_BOOKINGS_FILE,
    `${JSON.stringify(bookings, null, 2)}\n`,
    'utf8'
  );
}

function getStorageMode() {
  if (isRealSupabaseConfigured()) return 'supabase';
  return 'local-json';
}

// Booking data can come from the browser form, the local JSON file, or a
// Supabase row with snake_case columns. Normalize every source to the same
// camelCase shape before the rest of the server (and the email service) uses it.
const NESTED_RECORD_KEYS = [
  'booking',
  'bookingData',
  'appointment',
  'request',
  'details',
  'data',
  'payload',
  'customer',
  'client',
  'contact'
];

const RECORD_EMAIL_KEYS = [
  'email',
  'customerEmail',
  'customer_email',
  'clientEmail',
  'client_email',
  'emailAddress',
  'email_address',
  'recipientEmail',
  'recipient_email',
  'contactEmail',
  'contact_email'
];
const RECORD_REFERENCE_KEYS = [
  'reference',
  'referenceCode',
  'reference_code',
  'referenceId',
  'reference_id',
  'bookingReference',
  'booking_reference',
  'bookingId',
  'booking_id',
  'id'
];
const RECORD_NAME_KEYS = [
  'fullName',
  'full_name',
  'customerName',
  'customer_name',
  'clientName',
  'client_name',
  'guestName',
  'guest_name',
  'name'
];
const RECORD_PHONE_KEYS = [
  'phone',
  'phoneNumber',
  'phone_number',
  'contactNumber',
  'contact_number',
  'mobile',
  'mobileNumber',
  'mobile_number'
];
const RECORD_SERVICE_KEYS = [
  'service',
  'serviceName',
  'service_name',
  'serviceType',
  'service_type',
  'appointmentType',
  'appointment_type'
];
const RECORD_DATE_KEYS = [
  'date',
  'scheduledDate',
  'scheduled_date',
  'appointmentDate',
  'appointment_date',
  'bookingDate',
  'booking_date'
];
const RECORD_TIME_KEYS = [
  'time',
  'scheduledTime',
  'scheduled_time',
  'appointmentTime',
  'appointment_time',
  'bookingTime',
  'booking_time',
  'slot'
];

function recordText(value) {
  let candidate = value;
  if (Array.isArray(candidate)) candidate = candidate[0];

  if (candidate && typeof candidate === 'object') {
    if ('email' in candidate) return recordText(candidate.email);
    if ('address' in candidate) return recordText(candidate.address);
    if ('value' in candidate) return recordText(candidate.value);
    return '';
  }

  if (typeof candidate !== 'string' && typeof candidate !== 'number') return '';
  return String(candidate).trim();
}

function getRecordSources(record) {
  const root = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const sources = [];

  const add = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && !sources.includes(value)) {
      sources.push(value);
    }
  };

  add(root);
  for (const key of NESTED_RECORD_KEYS) add(root[key]);
  for (const key of ['data', 'payload', 'booking', 'bookingData', 'request', 'appointment']) {
    const wrapper = root[key];
    if (!wrapper || typeof wrapper !== 'object') continue;
    for (const nestedKey of NESTED_RECORD_KEYS) add(wrapper[nestedKey]);
  }

  return sources;
}

function pickRecordField(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      if (!(key in source)) continue;
      const value = recordText(source[key]);
      if (value) return value;
    }
  }
  return '';
}

function pickRecordBoolean(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      if (!(key in source)) continue;
      const value = source[key];
      if (value === true || value === 'true' || value === 1 || value === '1') return true;
      if (value === false || value === 'false' || value === 0 || value === '0') return false;
    }
  }
  return undefined;
}

function normalizeBookingRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;

  const sources = getRecordSources(record);
  const normalized = { ...record };
  const set = (key, value) => {
    if (value !== undefined && value !== null && value !== '') normalized[key] = value;
  };

  const email = pickRecordField(sources, RECORD_EMAIL_KEYS).toLowerCase();
  set('email', email);
  set('reference', pickRecordField(sources, RECORD_REFERENCE_KEYS));
  set('fullName', pickRecordField(sources, RECORD_NAME_KEYS));
  set('phone', pickRecordField(sources, RECORD_PHONE_KEYS));
  set('service', pickRecordField(sources, RECORD_SERVICE_KEYS));
  set('serviceType', pickRecordField(sources, ['serviceType', 'service_type', 'appointmentType', 'appointment_type']));
  set('date', pickRecordField(sources, RECORD_DATE_KEYS));
  set('time', pickRecordField(sources, RECORD_TIME_KEYS));
  set('artist', pickRecordField(sources, ['artist', 'artistName', 'artist_name', 'assignedArtist', 'assigned_artist']));
  set('notes', pickRecordField(sources, ['notes', 'note', 'message', 'specialRequests', 'special_requests']));
  set('paymentMethod', pickRecordField(sources, ['paymentMethod', 'payment_method', 'depositMethod', 'deposit_method']));
  set('placement', pickRecordField(sources, ['placement', 'bodyPlacement', 'body_placement', 'tattooPlacement', 'tattoo_placement']));
  set('tattooSize', pickRecordField(sources, ['tattooSize', 'tattoo_size', 'targetSize', 'target_size', 'size']));
  set('tattooStyle', pickRecordField(sources, ['tattooStyle', 'tattoo_style', 'style', 'designStyle', 'design_style']));
  set('clientRequestId', pickRecordField(sources, ['clientRequestId', 'client_request_id']));
  set('emailError', pickRecordField(sources, ['emailError', 'email_error']));
  set('emailProvider', pickRecordField(sources, ['emailProvider', 'email_provider']));
  set('createdAt', pickRecordField(sources, ['createdAt', 'created_at']));

  const emailSent = pickRecordBoolean(sources, ['emailSent', 'email_sent']);
  if (emailSent !== undefined) normalized.emailSent = emailSent;

  return normalized;
}

async function readLocalBookings() {
  try {
    const contents = await fs.readFile(LOCAL_BOOKINGS_FILE, 'utf8');
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? parsed.map(normalizeBookingRecord) : [];
  } catch (error) {
    // A missing file is normal on first run. A malformed file is replaced so
    // one bad manual edit cannot block future bookings.
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

/**
 * Persists a booking to Supabase. Falls back to local-json when credentials
 * are not configured.
 */
async function saveBooking(booking) {
  const record = normalizeBookingRecord(booking);
  const supa = getSupabase();

  if (supa) {
    const collectionName = getBookingsTable();
    try {
      const { data, error } = await withTimeout(
        supa
          .from(collectionName)
          .insert({ ...record, status: record.status || 'pending_confirmation', source: 'website' })
          .select(),
        SUPABASE_TIMEOUT_MS
      );

      if (error) throw new Error(error.message);

      return {
        type: 'supabase',
        collection: collectionName,
        id: data?.[0]?.reference || data?.[0]?.id || record.reference
      };
    } catch (err) {
      // A write must never hold the booking response hostage: fall through to
      // the local file and stop retrying this store for a minute.
      markSupabaseUnavailable();
      console.error('[booking] Could not save to Supabase, using local file:', err.message);
    }
  }

  await enqueueLocalWrite(record);

  return {
    type: 'local-json',
    file: path.relative(PROJECT_ROOT, LOCAL_BOOKINGS_FILE)
  };
}

/**
 * Finds a booking by the browser-generated idempotency token. This lets the
 * booking page recover a confirmed booking after a refresh or a lost response.
 */
async function findBookingByClientRequestId(clientRequestId) {
  const token = String(clientRequestId || '').trim();
  if (!token) return null;

  const supa = getSupabase();

  if (supa) {
    const collectionName = getBookingsTable();
    try {
      const { data, error } = await withTimeout(
        supa
          .from(collectionName)
          .select('*')
          .eq('clientRequestId', token)
          .limit(1)
          .single(),
        SUPABASE_TIMEOUT_MS
      );

      if (error || !data) return null;

      // Preserve an explicit reference column; only fall back to row id.
      return normalizeBookingRecord(data);
    } catch (err) {
      markSupabaseUnavailable();
      console.error('[booking] Could not look up Supabase booking, using local file:', err.message);
    }
  }

  const bookings = await readLocalBookings();
  const record = [...bookings].reverse().find((item) => item.clientRequestId === token);
  return record || null;
}

/**
 * Records the email delivery outcome without changing the booking status.
 */
async function updateBookingDelivery(reference, delivery) {
  if (!reference) return false;

  const supa = getSupabase();
  const patch = {
    emailSent: Boolean(delivery?.emailSent),
    emailError: delivery?.emailError || null,
    emailProvider: delivery?.emailProvider || null
  };

  if (supa) {
    const collectionName = getBookingsTable();

    try {
      const { error } = await withTimeout(
        supa.from(collectionName).update(patch).eq('reference', reference),
        SUPABASE_TIMEOUT_MS
      );

      if (error) {
        console.error(`[booking] Could not update email delivery for ${reference}:`, error.message);
        return false;
      }
      return true;
    } catch (err) {
      markSupabaseUnavailable();
      console.error('[booking] Supabase update error:', err.message);
      return false;
    }
  }

  return enqueueLocalUpdate(reference, patch);
}

/**
 * Reads every stored booking, whichever storage mode is configured. Used by the
 * admin Custom Requests page to find requests submitted with the Custom Tattoo
 * Booking Form.
 */
async function readAllBookings() {
  const supa = getSupabase();

  if (supa) {
    const collectionName = getBookingsTable();

    try {
      const { data, error } = await withTimeout(
        supa.from(collectionName).select('*'),
        SUPABASE_TIMEOUT_MS
      );

      if (error) throw error;

      return Array.isArray(data) ? data.map(normalizeBookingRecord) : [];
    } catch (error) {
      markSupabaseUnavailable();
      // Match saveBooking(): when the hosted store is unreachable, keep the
      // admin page working from the local bookings file.
      console.warn('[booking] Could not read Supabase bookings, using local file:', error.message);
    }
  }

  return readLocalBookings();
}

/**
 * Updates an existing booking record.
 */
async function updateBooking(reference, patch) {
  if (!reference) return false;
  const supa = getSupabase();

  if (supa) {
    const collectionName = getBookingsTable();
    try {
      const { error } = await withTimeout(
        supa
          .from(collectionName)
          .update({ ...patch, updatedAt: new Date().toISOString() })
          .eq('reference', reference),
        SUPABASE_TIMEOUT_MS
      );

      if (!error) {
        await enqueueLocalUpdate(reference, patch);
        return true;
      }
      console.warn(`[booking] Could not update Supabase for ${reference}:`, error.message);
    } catch (err) {
      markSupabaseUnavailable();
      console.warn('[booking] Supabase update error:', err.message);
    }
  }

  return enqueueLocalUpdate(reference, patch);
}

/**
 * Deletes a booking record.
 */
async function deleteBooking(reference) {
  if (!reference) return false;
  const supa = getSupabase();

  if (supa) {
    const collectionName = getBookingsTable();
    try {
      const { error } = await withTimeout(
        supa.from(collectionName).delete().eq('reference', reference),
        SUPABASE_TIMEOUT_MS
      );

      if (!error) {
        await enqueueLocalDelete(reference);
        return true;
      }
      console.warn(`[booking] Could not delete Supabase booking ${reference}:`, error.message);
    } catch (err) {
      markSupabaseUnavailable();
      console.warn('[booking] Supabase delete error:', err.message);
    }
  }

  return enqueueLocalDelete(reference);
}

/**
 * Returns an array of booked timeslots for a given date and optional artist.
 * Used by the public booking interface for slot locking.
 */
async function getLockedSlots(date, artist = null) {
  const bookings = await readAllBookings();
  const normalizedDate = String(date || '').trim().toLowerCase();

  return bookings
    .filter((b) => {
      const bDate = String(b.date || '').trim().toLowerCase();
      if (!bDate || bDate !== normalizedDate) return false;
      if (artist && b.artist && String(b.artist).trim().toLowerCase() !== String(artist).trim().toLowerCase()) {
        return false;
      }
      const st = String(b.status || '').toLowerCase();
      // Locked statuses: confirmed, pending_confirmation, late, completed
      // Cancelled slots are released.
      return st === 'confirmed' || st === 'pending_confirmation' || st === 'late' || st === 'completed';
    })
    .map((b) => String(b.time || '').trim())
    .filter(Boolean);
}

module.exports = {
  getStorageMode,
  normalizeBookingRecord,
  saveBooking,
  findBookingByClientRequestId,
  updateBookingDelivery,
  readAllBookings,
  updateBooking,
  deleteBooking,
  getLockedSlots
};
