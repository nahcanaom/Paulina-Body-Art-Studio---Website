'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { readAllBookings, normalizeBookingRecord } = require('./bookingStore');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

// Review state lives beside the booking data instead of inside the bookings
// table, so the custom request workflow works the same with Supabase, Firestore
// and the local JSON fallback without changing the bookings schema.
const STATUS_FILE = path.join(DATA_DIR, 'custom-request-status.json');

let writeQueue = Promise.resolve();

/**
 * Serialises writes so two admins deciding at the same time cannot overwrite
 * each other's update.
 */
function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

async function readStatusFile() {
  try {
    const contents = await fs.readFile(STATUS_FILE, 'utf8');
    const parsed = JSON.parse(contents);

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function writeStatusFile(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATUS_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * A booking is a custom tattoo request when the customer picked the "Custom
 * Tattoo Booking Form". Bookings saved before that flag existed are recognised
 * by the service label the booking page generates for the custom form.
 */
function isCustomTattooRequest(booking) {
  if (!booking) return false;
  if (booking.tattooFormType === 'custom') return true;
  if (booking.serviceType && booking.serviceType !== 'Tattoo') return false;

  return /^Custom Tattoo/i.test(String(booking.service || ''));
}

/**
 * Every booking is submitted into the review queue, which records an entry in
 * the status file. Membership is therefore the presence of that entry, so old
 * records that were never queued are not retroactively added. Requests created
 * before the queue covered every service type are still recognised by their
 * custom tattoo form label.
 */
function isReviewableBooking(booking, status = {}) {
  if (!booking) return false;
  if (status && status.status) return true;

  return isCustomTattooRequest(booking);
}

function getReference(booking) {
  const record = normalizeBookingRecord(booking);
  return String(record?.reference || '').trim();
}

/**
 * Shapes one booking plus its review state for the admin Custom Requests page.
 * Only the fields the page renders are exposed.
 */
function toCustomRequest(booking, status = {}) {
  const record = normalizeBookingRecord(booking) || {};
  const tattooFormType = status.tattooFormType || record.tattooFormType || '';
  // Only the Custom Tattoo form collects a reference picture, so piercing,
  // standard tattoo and troubleshooting requests must never be treated as
  // custom. A style value alone is not enough: the standard form can submit
  // one, and the reference panel would then appear for the wrong service.
  const isCustomTattoo = isCustomTattooRequest({ ...record, tattooFormType });

  return {
    reference: getReference(record),
    fullName: record.fullName || '',
    email: record.email || '',
    phone: record.phone || '',
    notes: record.notes || '',
    placement: record.placement || '',
    tattooSize: record.tattooSize || '',
    style: status.style || record.tattooStyle || '',
    service: record.service || record.serviceType || 'Studio Appointment',
    serviceType: record.serviceType || '',
    // Drives the reference section in the admin review panel.
    isCustomTattoo,
    artist: record.artist || 'Paulina Vampire',
    date: record.date || '',
    time: record.time || '',
    createdAt: record.createdAt || record.created_at || status.createdAt || '',
    status: status.status || 'pending',
    reviewedAt: status.reviewedAt || '',
    decidedAt: status.decidedAt || '',
    declineReason: status.declineReason || '',
    decisionEmailSent: typeof status.emailSent === 'boolean' ? status.emailSent : null,
    decisionEmailError: status.emailErrorMessage || status.emailError || '',
    references: [status.referenceFileName].filter(Boolean),
    // Stored file names; the API turns these into viewable URLs.
    referenceFiles: [status.referenceFile].filter(Boolean),
    // Payment proof attached on the booking form's payment step.
    receiptName: status.receiptFileName || record.receiptFileName || '',
    receiptFiles: [status.receiptFile].filter(Boolean),
    paymentMethod: record.paymentMethod || ''
  };
}

function sortNewestFirst(a, b) {
  return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
}

/** Every booking awaiting or holding a studio decision, newest first. */
async function listCustomRequests() {
  const [bookings, status] = await Promise.all([readAllBookings(), readStatusFile()]);

  return bookings
    .filter((booking) => isReviewableBooking(booking, status[getReference(booking)] || {}))
    .map((booking) => toCustomRequest(booking, status[getReference(booking)] || {}))
    .filter((request) => request.reference)
    .sort(sortNewestFirst);
}

/** One review-queue booking, or null when the reference is not in the queue. */
async function getCustomRequest(reference) {
  const target = String(reference || '').trim();
  if (!target) return null;

  const [bookings, status] = await Promise.all([readAllBookings(), readStatusFile()]);
  const booking = bookings.find((record) => getReference(record) === target);

  if (!booking || !isReviewableBooking(booking, status[target] || {})) return null;

  return toCustomRequest(booking, status[target] || {});
}

/**
 * Stores the review details that are not part of the booking record (tattoo
 * style and reference file name) when the booking is submitted.
 */
async function recordSubmittedRequest(booking) {
  const reference = getReference(booking);
  if (!reference) return null;

  return enqueue(async () => {
    const state = await readStatusFile();
    const existing = state[reference] || {};

    state[reference] = {
      ...existing,
      status: existing.status || 'pending',
      style: booking.tattooStyle || existing.style || '',
      tattooFormType: booking.tattooFormType || existing.tattooFormType || '',
      referenceFileName: booking.tattooReferenceFileName || existing.referenceFileName || '',
      referenceFile: booking.tattooReferenceStoredFile || existing.referenceFile || '',
      receiptFileName: booking.receiptFileName || existing.receiptFileName || '',
      receiptFile: booking.receiptStoredFile || existing.receiptFile || '',
      createdAt: existing.createdAt || new Date().toISOString()
    };

    await writeStatusFile(state);
    return state[reference];
  });
}

/** Applies a partial update to one request's review state. */
async function updateRequestStatus(reference, patch) {
  const target = String(reference || '').trim();
  if (!target) return null;

  return enqueue(async () => {
    const state = await readStatusFile();

    state[target] = { ...(state[target] || {}), ...patch };

    await writeStatusFile(state);
    return state[target];
  });
}

/**
 * Removes a request's review state. Used when the admin deletes a booking that
 * has already been reviewed, so it cannot reappear from the status file.
 */
async function deleteRequestStatus(reference) {
  const target = String(reference || '').trim();
  if (!target) return false;

  return enqueue(async () => {
    const state = await readStatusFile();
    if (!state[target]) return false;

    delete state[target];
    await writeStatusFile(state);
    return true;
  });
}

/** Marks a request as reviewed once, without changing an existing timestamp. */
async function markRequestReviewed(reference) {
  const target = String(reference || '').trim();
  if (!target) return null;

  return enqueue(async () => {
    const state = await readStatusFile();
    const existing = state[target] || {};

    state[target] = {
      ...existing,
      status: existing.status || 'pending',
      reviewedAt: existing.reviewedAt || new Date().toISOString()
    };

    await writeStatusFile(state);
    return state[target];
  });
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
