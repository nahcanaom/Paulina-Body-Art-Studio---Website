'use strict';

const { createClient } = require('@supabase/supabase-js');
const { readAllBookings, updateBooking } = require('./bookingStore');

const DEFAULT_SUPABASE_URL = 'https://celusvfynfnszmhjgqwj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_NlHs6PG9x_HHfCDUKOlArQ_pM41Bn7g';
const REQUESTS_TABLE = 'custom_requests';

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

function isCustomTattooRequest(booking) {
  if (!booking) return false;
  if (booking.tattooFormType === 'custom' || booking.tattoo_form_type === 'custom') return true;
  if (booking.serviceType && booking.serviceType !== 'Tattoo' && booking.service_type !== 'Tattoo') return false;
  return /^Custom Tattoo/i.test(String(booking.service || ''));
}

function isReviewableBooking(booking, status = {}) {
  if (!booking) return false;
  if (status && status.status) return true;
  return isCustomTattooRequest(booking);
}

function toCustomRequest(row) {
  if (!row) return null;
  const ref = String(row.reference || '').trim();
  const isCustomTattoo = row.tattoo_form_type === 'custom' || row.tattooFormType === 'custom' || /^Custom Tattoo/i.test(row.service || '');

  const refUrl = row.reference_image_url || row.referenceImageUrl || '';
  const refName = row.reference_file_name || row.referenceFileName || '';
  const receiptUrl = row.receipt_image_url || row.receiptImageUrl || '';
  const receiptName = row.receipt_file_name || row.receiptFileName || '';

  return {
    reference: ref,
    fullName: row.full_name || row.fullName || '',
    email: row.email || '',
    phone: row.phone || '',
    notes: row.concept_description || row.notes || '',
    placement: row.placement || '',
    tattooSize: row.dimensions || row.tattoo_size || row.tattooSize || '',
    style: row.style || row.tattoo_style || row.tattooStyle || '',
    service: row.service || 'Custom Tattoo',
    serviceType: row.service_type || row.serviceType || 'Tattoo',
    isCustomTattoo,
    artist: row.artist || 'Paulina Vampire',
    date: row.date || '',
    time: row.time || '',
    createdAt: row.created_at || row.createdAt || '',
    status: row.status || 'pending',
    reviewedAt: row.reviewed_at || row.reviewedAt || '',
    decidedAt: row.decided_at || row.decidedAt || '',
    declineReason: row.decline_reason || row.declineReason || '',
    decisionEmailSent: typeof row.decision_email_sent === 'boolean'
      ? row.decision_email_sent
      : (typeof row.decisionEmailSent === 'boolean' ? row.decisionEmailSent : null),
    decisionEmailError: row.decision_email_error || row.decisionEmailError || '',
    references: [refName].filter(Boolean),
    referenceFiles: [refUrl].filter(Boolean),
    referenceUrls: [refUrl].filter(Boolean),
    receiptName: receiptName,
    receiptFiles: [receiptUrl].filter(Boolean),
    receiptUrls: [receiptUrl].filter(Boolean),
    paymentMethod: row.payment_method || row.paymentMethod || 'Gcash'
  };
}

/**
 * Stores a custom tattoo or appointment request in the Supabase custom_requests table.
 */
async function recordSubmittedRequest(booking) {
  const reference = String(booking?.reference || '').trim();
  if (!reference) return null;

  const client = getSupabase();
  const payload = {
    reference,
    full_name: booking.fullName || booking.full_name || '',
    email: booking.email || '',
    phone: booking.phone || '',
    service: booking.service || 'Custom Tattoo',
    service_type: booking.serviceType || booking.service_type || 'Tattoo',
    artist: booking.artist || 'Paulina Vampire',
    date: booking.date || '',
    time: booking.time || '',
    concept_description: booking.notes || '',
    placement: booking.placement || '',
    dimensions: booking.tattooSize || booking.tattoo_size || '',
    style: booking.tattooStyle || booking.style || '',
    tattoo_form_type: booking.tattooFormType || 'custom',
    reference_file_name: booking.tattooReferenceFileName || '',
    reference_image_url: booking.tattooReferenceStoredFile || booking.referenceImageUrl || '',
    receipt_file_name: booking.receiptFileName || '',
    receipt_image_url: booking.receiptStoredFile || booking.receiptImageUrl || '',
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await client
    .from(REQUESTS_TABLE)
    .upsert(payload, { onConflict: 'reference' })
    .select()
    .single();

  if (error) {
    console.error('[customRequestStore] Could not record request to Supabase:', error.message);
    return payload;
  }

  return data;
}

/**
 * Lists all custom tattoo & review queue requests from Supabase.
 */
async function listCustomRequests() {
  const client = getSupabase();
  const { data: requests, error } = await client
    .from(REQUESTS_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[customRequestStore] Supabase list failed:', error.message);
  }

  const existingMap = new Map();
  (requests || []).forEach((row) => {
    existingMap.set(row.reference, toCustomRequest(row));
  });

  // Also incorporate any custom bookings from bookings table not yet in custom_requests
  try {
    const bookings = await readAllBookings();
    for (const b of bookings) {
      if (b.reference && !existingMap.has(b.reference) && isReviewableBooking(b)) {
        existingMap.set(b.reference, toCustomRequest({
          reference: b.reference,
          full_name: b.fullName,
          email: b.email,
          phone: b.phone,
          service: b.service,
          service_type: b.serviceType,
          artist: b.artist,
          date: b.date,
          time: b.time,
          concept_description: b.notes,
          placement: b.placement,
          dimensions: b.tattooSize,
          style: b.tattooStyle,
          tattoo_form_type: b.tattooFormType || 'custom',
          reference_file_name: b.tattooReferenceFileName,
          reference_image_url: b.receiptUrl,
          receipt_file_name: b.receiptFileName,
          receipt_image_url: b.receiptUrl,
          status: b.status === 'confirmed' ? 'accepted' : (b.status === 'cancelled' ? 'declined' : 'pending'),
          created_at: b.createdAt
        }));
      }
    }
  } catch (err) {
    console.warn('[customRequestStore] Could not check bookings fallback:', err.message);
  }

  return Array.from(existingMap.values()).sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
}

/**
 * Gets a single custom request by reference code.
 */
async function getCustomRequest(reference) {
  const target = String(reference || '').trim();
  if (!target) return null;

  const client = getSupabase();
  const { data, error } = await client
    .from(REQUESTS_TABLE)
    .select('*')
    .eq('reference', target)
    .maybeSingle();

  if (error) {
    console.warn('[customRequestStore] Failed to get request:', error.message);
  }

  if (data) return toCustomRequest(data);

  // Fallback to bookings
  const bookings = await readAllBookings();
  const found = bookings.find((b) => b.reference === target);
  if (found && isReviewableBooking(found)) {
    return toCustomRequest({
      reference: found.reference,
      full_name: found.fullName,
      email: found.email,
      phone: found.phone,
      service: found.service,
      service_type: found.serviceType,
      artist: found.artist,
      date: found.date,
      time: found.time,
      concept_description: found.notes,
      placement: found.placement,
      dimensions: found.tattooSize,
      style: found.tattooStyle,
      tattoo_form_type: found.tattooFormType || 'custom',
      status: found.status === 'confirmed' ? 'accepted' : (found.status === 'cancelled' ? 'declined' : 'pending'),
      created_at: found.createdAt
    });
  }

  return null;
}

/**
 * Updates a custom request's decision or review status in Supabase.
 */
async function updateRequestStatus(reference, patch) {
  const target = String(reference || '').trim();
  if (!target) return null;

  const client = getSupabase();
  const dbPatch = { updated_at: new Date().toISOString() };

  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.declineReason !== undefined || patch.decline_reason !== undefined) {
    dbPatch.decline_reason = patch.declineReason ?? patch.decline_reason;
  }
  if (patch.reviewedAt !== undefined || patch.reviewed_at !== undefined) {
    dbPatch.reviewed_at = patch.reviewedAt ?? patch.reviewed_at;
  }
  if (patch.decidedAt !== undefined || patch.decided_at !== undefined) {
    dbPatch.decided_at = patch.decidedAt ?? patch.decided_at;
  }
  if (patch.adminNotes !== undefined || patch.admin_notes !== undefined) {
    dbPatch.admin_notes = patch.adminNotes ?? patch.admin_notes;
  }
  if (patch.emailSent !== undefined || patch.decision_email_sent !== undefined) {
    dbPatch.decision_email_sent = patch.emailSent ?? patch.decision_email_sent;
  }
  if (patch.emailErrorMessage !== undefined || patch.decision_email_error !== undefined) {
    dbPatch.decision_email_error = patch.emailErrorMessage ?? patch.decision_email_error;
  }

  const { data, error } = await client
    .from(REQUESTS_TABLE)
    .update(dbPatch)
    .eq('reference', target)
    .select()
    .maybeSingle();

  if (error) {
    console.error(`[customRequestStore] Update failed for ${target}:`, error.message);
  }

  // Also sync booking status with calendar if approved or rejected
  if (patch.status === 'accepted') {
    await updateBooking(target, { status: 'confirmed' });
  } else if (patch.status === 'declined') {
    await updateBooking(target, { status: 'cancelled' });
  }

  return data || { reference: target, ...patch };
}

/**
 * Deletes custom request entry in Supabase.
 */
async function deleteRequestStatus(reference) {
  const target = String(reference || '').trim();
  if (!target) return false;

  const client = getSupabase();
  const { error } = await client
    .from(REQUESTS_TABLE)
    .delete()
    .eq('reference', target);

  return !error;
}

/**
 * Marks request as reviewed.
 */
async function markRequestReviewed(reference) {
  const target = String(reference || '').trim();
  if (!target) return null;

  return updateRequestStatus(target, { reviewedAt: new Date().toISOString() });
}

module.exports = {
  isCustomTattooRequest,
  isReviewableBooking,
  listCustomRequests,
  getCustomRequest,
  recordSubmittedRequest,
  updateRequestStatus,
  deleteRequestStatus,
  markRequestReviewed
};
