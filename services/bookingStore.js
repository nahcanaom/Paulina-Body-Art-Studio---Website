'use strict';

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_URL = 'https://celusvfynfnszmhjgqwj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_NlHs6PG9x_HHfCDUKOlArQ_pM41Bn7g';
const BOOKINGS_TABLE = 'bookings';

let supabaseClient = null;

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

function getStorageMode() {
  return 'supabase';
}

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

function normalizeBookingRecord(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const record = { ...raw };

  return {
    id: record.id || undefined,
    reference: recordText(record.reference || record.reference_code || record.referenceCode || record.id),
    fullName: recordText(record.full_name || record.fullName || record.customerName || record.customer_name || record.name),
    email: recordText(record.email || record.customerEmail || record.customer_email || record.clientEmail),
    phone: recordText(record.phone || record.phone_number || record.phoneNumber || record.mobile),
    serviceType: recordText(record.service_type || record.serviceType || record.appointmentType),
    service: recordText(record.service || record.service_name || record.serviceName),
    artist: recordText(record.artist || record.artist_name || record.artistName) || 'Paulina Vampire',
    date: recordText(record.date || record.scheduledDate || record.scheduled_date || record.bookingDate),
    time: recordText(record.time || record.scheduledTime || record.scheduled_time || record.slot),
    duration: recordText(record.duration) || '1 hour',
    endTime: recordText(record.end_time || record.endTime),
    status: recordText(record.status || 'pending_confirmation').toLowerCase(),
    attendanceStatus: recordText(record.attendance_status || record.attendanceStatus),
    depositAmount: typeof record.deposit_amount === 'number' ? record.deposit_amount : (typeof record.depositAmount === 'number' ? record.depositAmount : 500),
    deposit: recordText(record.deposit) || '₱500',
    depositStatus: recordText(record.deposit_status || record.depositStatus || 'paid'),
    paymentMethod: recordText(record.payment_method || record.paymentMethod || 'Gcash'),
    receiptFileName: recordText(record.receipt_file_name || record.receiptFileName),
    receiptUrl: recordText(record.receipt_url || record.receiptUrl),
    notes: recordText(record.notes || record.customerNotes || record.specialRequests),
    placement: recordText(record.placement || record.body_placement || record.bodyPlacement),
    tattooSize: recordText(record.tattoo_size || record.tattooSize || record.targetSize),
    tattooFormType: recordText(record.tattoo_form_type || record.tattooFormType),
    tattooStyle: recordText(record.tattoo_style || record.tattooStyle || record.style),
    clientRequestId: recordText(record.client_request_id || record.clientRequestId),
    emailSent: Boolean(record.email_sent !== undefined ? record.email_sent : record.emailSent),
    emailError: record.email_error || record.emailError || null,
    emailProvider: record.email_provider || record.emailProvider || null,
    source: recordText(record.source) || 'website',
    createdAt: record.created_at || record.createdAt || new Date().toISOString(),
    updatedAt: record.updated_at || record.updatedAt || new Date().toISOString()
  };
}

function toDbBooking(normalized) {
  return {
    reference: normalized.reference,
    full_name: normalized.fullName || '',
    email: normalized.email || '',
    phone: normalized.phone || '',
    service_type: normalized.serviceType || '',
    service: normalized.service || '',
    artist: normalized.artist || 'Paulina Vampire',
    date: normalized.date || '',
    time: normalized.time || '',
    duration: normalized.duration || '1 hour',
    end_time: normalized.endTime || '',
    status: normalized.status || 'pending_confirmation',
    attendance_status: normalized.attendanceStatus || '',
    deposit_amount: normalized.depositAmount || 500,
    deposit: normalized.deposit || '₱500',
    deposit_status: normalized.depositStatus || 'paid',
    payment_method: normalized.paymentMethod || 'Gcash',
    receipt_file_name: normalized.receiptFileName || '',
    receipt_url: normalized.receiptUrl || '',
    notes: normalized.notes || '',
    placement: normalized.placement || '',
    tattoo_size: normalized.tattooSize || '',
    tattoo_form_type: normalized.tattooFormType || '',
    tattoo_style: normalized.tattooStyle || '',
    client_request_id: normalized.clientRequestId || '',
    email_sent: Boolean(normalized.emailSent),
    email_error: normalized.emailError || '',
    email_provider: normalized.emailProvider || '',
    source: normalized.source || 'website',
    created_at: normalized.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function toDbBookingPatch(patch = {}) {
  const dbPatch = { updated_at: new Date().toISOString() };
  if (patch.reference !== undefined) dbPatch.reference = patch.reference;
  if (patch.fullName !== undefined || patch.full_name !== undefined) dbPatch.full_name = patch.fullName ?? patch.full_name;
  if (patch.email !== undefined) dbPatch.email = patch.email;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone;
  if (patch.serviceType !== undefined || patch.service_type !== undefined) dbPatch.service_type = patch.serviceType ?? patch.service_type;
  if (patch.service !== undefined) dbPatch.service = patch.service;
  if (patch.artist !== undefined) dbPatch.artist = patch.artist;
  if (patch.date !== undefined) dbPatch.date = patch.date;
  if (patch.time !== undefined) dbPatch.time = patch.time;
  if (patch.duration !== undefined) dbPatch.duration = patch.duration;
  if (patch.endTime !== undefined || patch.end_time !== undefined) dbPatch.end_time = patch.endTime ?? patch.end_time;
  if (patch.status !== undefined) dbPatch.status = String(patch.status).toLowerCase();
  if (patch.attendanceStatus !== undefined || patch.attendance_status !== undefined) dbPatch.attendance_status = patch.attendanceStatus ?? patch.attendance_status;
  if (patch.depositAmount !== undefined || patch.deposit_amount !== undefined) dbPatch.deposit_amount = patch.depositAmount ?? patch.deposit_amount;
  if (patch.deposit !== undefined) dbPatch.deposit = patch.deposit;
  if (patch.depositStatus !== undefined || patch.deposit_status !== undefined) dbPatch.deposit_status = patch.depositStatus ?? patch.deposit_status;
  if (patch.paymentMethod !== undefined || patch.payment_method !== undefined) dbPatch.payment_method = patch.paymentMethod ?? patch.payment_method;
  if (patch.receiptFileName !== undefined || patch.receipt_file_name !== undefined) dbPatch.receipt_file_name = patch.receiptFileName ?? patch.receipt_file_name;
  if (patch.receiptUrl !== undefined || patch.receipt_url !== undefined) dbPatch.receipt_url = patch.receiptUrl ?? patch.receipt_url;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.placement !== undefined) dbPatch.placement = patch.placement;
  if (patch.tattooSize !== undefined || patch.tattoo_size !== undefined) dbPatch.tattoo_size = patch.tattooSize ?? patch.tattoo_size;
  if (patch.emailSent !== undefined || patch.email_sent !== undefined) dbPatch.email_sent = Boolean(patch.emailSent ?? patch.email_sent);
  if (patch.emailError !== undefined || patch.email_error !== undefined) dbPatch.email_error = patch.emailError ?? patch.email_error;
  if (patch.emailProvider !== undefined || patch.email_provider !== undefined) dbPatch.email_provider = patch.emailProvider ?? patch.email_provider;
  return dbPatch;
}

/**
 * Persists a booking directly to Supabase PostgreSQL bookings table.
 */
async function saveBooking(booking) {
  const record = normalizeBookingRecord(booking);
  const client = getSupabase();
  const dbRecord = toDbBooking(record);

  const { data, error } = await client
    .from(BOOKINGS_TABLE)
    .upsert(dbRecord, { onConflict: 'reference' })
    .select();

  if (error) {
    console.error('[bookingStore] Supabase saveBooking error:', error.message);
    throw new Error(`Failed to save booking to Supabase: ${error.message}`);
  }

  return {
    type: 'supabase',
    collection: BOOKINGS_TABLE,
    id: data?.[0]?.reference || record.reference
  };
}

/**
 * Finds a booking by clientRequestId for deduplication.
 */
async function findBookingByClientRequestId(clientRequestId) {
  const token = String(clientRequestId || '').trim();
  if (!token) return null;

  const client = getSupabase();
  const { data, error } = await client
    .from(BOOKINGS_TABLE)
    .select('*')
    .eq('client_request_id', token)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeBookingRecord(data);
}

/**
 * Updates booking email delivery outcome in Supabase.
 */
async function updateBookingDelivery(reference, delivery) {
  if (!reference) return false;
  const client = getSupabase();

  const patch = {
    email_sent: Boolean(delivery?.emailSent),
    email_error: delivery?.emailError || '',
    email_provider: delivery?.emailProvider || '',
    updated_at: new Date().toISOString()
  };

  const { error } = await client
    .from(BOOKINGS_TABLE)
    .update(patch)
    .eq('reference', reference);

  if (error) {
    console.error(`[bookingStore] Failed to update delivery for ${reference}:`, error.message);
    return false;
  }
  return true;
}

/**
 * Reads all bookings from live Supabase PostgreSQL.
 */
async function readAllBookings() {
  const client = getSupabase();
  const { data, error } = await client
    .from(BOOKINGS_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[bookingStore] Failed to read bookings from Supabase:', error.message);
    return [];
  }

  return Array.isArray(data) ? data.map(normalizeBookingRecord) : [];
}

/**
 * Updates a booking by its reference code in Supabase.
 */
async function updateBooking(reference, patch) {
  if (!reference) return false;
  const client = getSupabase();
  const dbPatch = toDbBookingPatch(patch);

  const { error } = await client
    .from(BOOKINGS_TABLE)
    .update(dbPatch)
    .eq('reference', reference);

  if (error) {
    console.error(`[bookingStore] Failed to update booking ${reference}:`, error.message);
    return false;
  }
  return true;
}

/**
 * Permanently deletes a booking in Supabase.
 */
async function deleteBooking(reference) {
  if (!reference) return false;
  const client = getSupabase();

  const { error } = await client
    .from(BOOKINGS_TABLE)
    .delete()
    .eq('reference', reference);

  if (error) {
    console.error(`[bookingStore] Failed to delete booking ${reference}:`, error.message);
    return false;
  }
  return true;
}

/**
 * Returns locked time slots for a specific date and artist directly from Supabase.
 */
async function getLockedSlots(date, artist = '') {
  const normalizedDate = String(date || '').trim();
  if (!normalizedDate) return [];

  const client = getSupabase();
  let query = client
    .from(BOOKINGS_TABLE)
    .select('time, date, artist, status')
    .eq('date', normalizedDate)
    .in('status', ['confirmed', 'pending_confirmation', 'late', 'completed']);

  const { data, error } = await query;
  if (error) {
    console.warn('[bookingStore] Could not fetch locked slots from Supabase:', error.message);
    return [];
  }

  return (data || [])
    .filter((b) => {
      if (artist && b.artist) {
        return String(b.artist).trim().toLowerCase() === String(artist).trim().toLowerCase();
      }
      return true;
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
