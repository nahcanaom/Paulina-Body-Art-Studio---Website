'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const NOTIFICATION_FILE = path.join(DATA_DIR, 'notifications.json');

// The admin dashboard can be open in two tabs at once, so writes are queued to
// keep one read-modify-write from overwriting the other.
let writeQueue = Promise.resolve();

const MAX_STORED = 200;

function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

async function readAll() {
  try {
    const contents = await fs.readFile(NOTIFICATION_FILE, 'utf8');
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeAll(items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(NOTIFICATION_FILE, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

function makeId() {
  return `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Adds a notification. The store only keeps what the admin UI renders, so the
 * payload stays small and free of customer secrets beyond the contact details
 * the studio already sees on the booking.
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

  const entry = {
    id: makeId(),
    type: input.type === 'review' ? 'review' : 'booking',
    title: String(input.title || '').trim() || 'New notification',
    message: String(input.message || '').trim(),
    reference: String(input.reference || '').trim(),
    customerName: String(input.customerName || '').trim(),
    details,
    emailSent: input.emailSent === true,
    emailError: String(input.emailError || '').trim(),
    createdAt: new Date().toISOString(),
    read: false
  };

  return enqueue(async () => {
    const items = await readAll();
    const next = [entry, ...items].slice(0, MAX_STORED);
    await writeAll(next);
    return entry;
  });
}

async function listNotifications({ limit = 30 } = {}) {
  const items = await readAll();
  return items.slice(0, Math.max(1, Math.min(Number(limit) || 30, MAX_STORED)));
}

async function countUnread() {
  const items = await readAll();
  return items.filter((item) => !item.read).length;
}

/**
 * Marks the given ids as read, or every notification when no ids are supplied.
 * Returns the number of entries that changed.
 */
async function markRead(ids = null) {
  const targets = Array.isArray(ids) ? new Set(ids.map((id) => String(id))) : null;

  return enqueue(async () => {
    const items = await readAll();
    let changed = 0;

    const next = items.map((item) => {
      if (item.read) return item;
      if (targets && !targets.has(item.id)) return item;
      changed += 1;
      return { ...item, read: true, readAt: new Date().toISOString() };
    });

    if (changed) await writeAll(next);
    return changed;
  });
}

/**
 * Permanently removes one notification. Returns true when an entry was found.
 */
async function deleteNotification(id) {
  const target = String(id || '').trim();
  if (!target) return false;

  return enqueue(async () => {
    const items = await readAll();
    const next = items.filter((item) => String(item.id) !== target);
    if (next.length === items.length) return false;
    await writeAll(next);
    return true;
  });
}

module.exports = {
  addNotification,
  countUnread,
  deleteNotification,
  listNotifications,
  markRead
};
