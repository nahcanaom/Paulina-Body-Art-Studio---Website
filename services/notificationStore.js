'use strict';

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_URL = 'https://celusvfynfnszmhjgqwj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_NlHs6PG9x_HHfCDUKOlArQ_pM41Bn7g';
const NOTIFICATIONS_TABLE = 'notifications';

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

function makeId() {
  return `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatNotification(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    type: row.type || 'booking',
    title: row.title || 'New notification',
    message: row.message || '',
    reference: row.reference || '',
    customerName: row.customer_name || row.customerName || '',
    details: Array.isArray(row.details) ? row.details : [],
    emailSent: Boolean(row.email_sent !== undefined ? row.email_sent : row.emailSent),
    emailError: row.email_error || row.emailError || '',
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    read: Boolean(row.is_read !== undefined ? row.is_read : row.read),
    readAt: row.read_at || row.readAt || null
  };
}

/**
 * Adds a new notification to Supabase.
 */
async function addNotification(input = {}) {
  const details = Array.isArray(input.details)
    ? input.details
        .map((detail) => {
          if (Array.isArray(detail)) {
            return [String(detail[0] || '').trim(), String(detail[1] || '').trim()];
          }
          if (detail && typeof detail === 'object') {
            return [String(detail.label || '').trim(), String(detail.value || '').trim()];
          }
          return null;
        })
        .filter((detail) => detail && detail[0] && detail[1])
    : [];

  const id = input.id || makeId();
  const entry = {
    id,
    type: input.type === 'review' ? 'review' : 'booking',
    title: String(input.title || '').trim() || 'New notification',
    message: String(input.message || '').trim(),
    reference: String(input.reference || '').trim(),
    customer_name: String(input.customerName || input.customer_name || '').trim(),
    details,
    email_sent: Boolean(input.emailSent),
    email_error: String(input.emailError || '').trim(),
    is_read: false,
    created_at: new Date().toISOString()
  };

  const client = getSupabase();
  const { data, error } = await client
    .from(NOTIFICATIONS_TABLE)
    .upsert(entry)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[notificationStore] Could not insert notification to Supabase:', error.message);
    return formatNotification(entry);
  }

  return formatNotification(data || entry);
}

/**
 * Lists notifications ordered by newest first.
 */
async function listNotifications({ limit = 30 } = {}) {
  const client = getSupabase();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 200));

  const { data, error } = await client
    .from(NOTIFICATIONS_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    console.warn('[notificationStore] Failed to list notifications from Supabase:', error.message);
    return [];
  }

  return (data || []).map(formatNotification);
}

/**
 * Counts unread notifications in Supabase.
 */
async function countUnread() {
  const client = getSupabase();
  const { count, error } = await client
    .from(NOTIFICATIONS_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error) {
    console.warn('[notificationStore] Could not count unread notifications:', error.message);
    return 0;
  }

  return count || 0;
}

/**
 * Marks specified ids or all notifications as read in Supabase.
 */
async function markRead(ids = null) {
  const client = getSupabase();
  const patch = {
    is_read: true,
    read_at: new Date().toISOString()
  };

  let query = client.from(NOTIFICATIONS_TABLE).update(patch);

  if (Array.isArray(ids) && ids.length > 0) {
    const stringIds = ids.map(String);
    query = query.in('id', stringIds);
  } else {
    query = query.eq('is_read', false);
  }

  const { data, error } = await query.select();
  if (error) {
    console.error('[notificationStore] Failed to mark read:', error.message);
    return 0;
  }

  return Array.isArray(data) ? data.length : 0;
}

/**
 * Permanently removes one notification in Supabase.
 */
async function deleteNotification(id) {
  const target = String(id || '').trim();
  if (!target) return false;

  const client = getSupabase();
  const { error } = await client
    .from(NOTIFICATIONS_TABLE)
    .delete()
    .eq('id', target);

  if (error) {
    console.error(`[notificationStore] Failed to delete notification ${target}:`, error.message);
    return false;
  }
  return true;
}

module.exports = {
  addNotification,
  countUnread,
  deleteNotification,
  listNotifications,
  markRead
};
