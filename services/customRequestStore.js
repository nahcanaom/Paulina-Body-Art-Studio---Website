'use strict';

const { createClient } = require('@supabase/supabase-js');

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

async function listCustomRequests() {
  const { data, error } = await getSupabase().from(REQUESTS_TABLE).select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toCustomRequest);
}

async function getCustomRequest(reference) {
  const { data, error } = await getSupabase().from(REQUESTS_TABLE).select('*').eq('reference', reference).maybeSingle();
  if (error) throw error;
  return toCustomRequest(data);
}

async function decideRequest(reference, decision, reason) {
  const { data, error } = await getSupabase().rpc('decide_booking_request', {
    p_reference: reference, p_decision: decision, p_reason: reason
  });
  if (error) throw error;
  return toCustomRequest(data);
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

  if (error) throw error;
  if (!data) throw new Error('The request no longer exists.');
  return toCustomRequest(data);
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
  listCustomRequests,
  getCustomRequest,
  updateRequestStatus,
  decideRequest,
  deleteRequestStatus,
  markRequestReviewed
};
