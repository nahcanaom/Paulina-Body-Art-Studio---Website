'use strict';

const path = require('node:path');
// server.js now sits at the project root, beside the directories it serves.
const PROJECT_ROOT = path.resolve(__dirname);
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');

const {
  sendBookingConfirmation,
  sendCustomRequestDecision,
  sendStudioNotification,
  getEmailConfig,
  getSmtpVerification,
  verifySmtpTransport
} = require('./services/emailService');
const {
  saveBooking,
  getStorageMode,
  normalizeBookingRecord,
  findBookingByClientRequestId,
  updateBookingDelivery,
  readAllBookings,
  updateBooking,
  deleteBooking,
  getLockedSlots
} = require('./services/bookingStore');
const {
  listCustomRequests,
  getCustomRequest,
  recordSubmittedRequest,
  updateRequestStatus,
  deleteRequestStatus,
  markRequestReviewed
} = require('./services/customRequestStore');
const {
  getAllImagesAdmin,
  getPublishedImages,
  getImageById,
  createImage,
  updateImage,
  deleteImage,
  registerChangeListener
} = require('./services/galleryStore');
const {
  getAllCatalogueAdmin,
  getPublishedCatalogue,
  getCatalogueItemById,
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem,
  registerChangeListener: registerCatalogueChangeListener
} = require('./services/catalogueStore');
const {
  addNotification,
  countUnread,
  deleteNotification,
  listNotifications,
  markRead
} = require('./services/notificationStore');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const LISTEN_PORT = Number.isInteger(PORT) && PORT > 0 ? PORT : 3000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const BOOKING_REFERENCE_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

// Reference pictures for the Custom Tattoo form are stored beside the local
// data and served back to the admin panel.
const REFERENCE_DIR = path.join(PROJECT_ROOT, 'data', 'references');
const REFERENCE_DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i;
const REFERENCE_FILE_PATTERN = /^PLN-[A-Za-z0-9-]+-reference\.(jpg|png|webp)$/;
const MAX_REFERENCE_BYTES = 3 * 1024 * 1024;

// Proof of payment uploaded with the booking form. Kept separate from the
// tattoo reference pictures so each can be found and removed on its own.
const RECEIPT_DIR = path.join(PROJECT_ROOT, 'data', 'receipts');
const RECEIPT_DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i;
const RECEIPT_FILE_PATTERN = /^PLN-[A-Za-z0-9-]+-receipt\.(jpg|png|webp)$/;

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception caught:', err?.stack || err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection caught:', reason?.stack || reason?.message || reason);
});

const app = express();
app.disable('x-powered-by');
// Reference pictures arrive as a downscaled data URL, so the body allowance is
// larger than a plain form post needs.
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ---------------------------------------------------------------------------
// CORS for local development (Live Server on a different port)
// ---------------------------------------------------------------------------
const CONFIGURED_CORS_ORIGINS = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function isAllowedCorsOrigin(origin) {
  if (!origin) return false;
  if (origin === 'null') return process.env.NODE_ENV !== 'production';
  if (CONFIGURED_CORS_ORIGINS.has(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    const host = hostname.replace(/^\[|\]$/g, '');

    if (['localhost', '127.0.0.1', '::1'].includes(host)) return true;
    if (host.endsWith('.local')) return true;

    // Allow private LAN addresses so Live Server can be opened from a phone or
    // another device while Express continues to serve the booking API.
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch {
    return false;
  }
}

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;

  if (isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '600');

    // Chrome's Private Network Access preflight for localhost APIs.
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

// ---------------------------------------------------------------------------
// Booking endpoint rate limiting (in-memory, per IP)
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const rateLimitBuckets = new Map();

function bookingRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now - bucket.startedAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { startedAt: now, count: 1 });
    return next();
  }

  bucket.count += 1;

  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - bucket.startedAt)) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: 'Too many booking requests. Please wait a few minutes and try again.'
    });
  }

  return next();
}

const rateLimitCleanup = setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.startedAt < cutoff) rateLimitBuckets.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS);
rateLimitCleanup.unref?.();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function cleanSingleLine(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanNotes(value, maxLength = 1500) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

// The booking form, the admin queue and hosted store rows do not always spell
// a field the same way. Search the root payload and its common wrappers so a
// browser submission cannot fail validation just because it used an alias.
const PAYLOAD_WRAPPERS = [
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

function readPayloadField(payload, keys) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const sources = [root];
  const add = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && !sources.includes(value)) {
      sources.push(value);
    }
  };

  for (const key of PAYLOAD_WRAPPERS) {
    const nested = root[key];
    add(nested);
    if (!nested || typeof nested !== 'object') continue;
    for (const innerKey of PAYLOAD_WRAPPERS) add(nested[innerKey]);
  }

  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' || typeof value === 'number') {
        if (String(value).trim()) return value;
      }
    }
  }

  return '';
}

function generateBookingReference() {
  const number = crypto.randomInt(100000, 1000000);
  return `PLN-${number}`;
}

/**
 * Saves the reference picture sent by the Custom Tattoo form. The browser
 * already downscaled it, so the payload stays small; anything that is not a
 * plain image data URL is ignored rather than trusted.
 */
async function persistReferenceImage(reference, dataUrl, originalName = '') {
  const raw = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (!raw) return '';

  const match = REFERENCE_DATA_URL_PATTERN.exec(raw);
  if (!match) {
    console.warn(`[booking] Ignored an unsupported reference image for ${reference}.`);
    return '';
  }

  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');

  if (!buffer.length || buffer.length > MAX_REFERENCE_BYTES) {
    console.warn(`[booking] Ignored a reference image with size ${buffer.length} for ${reference}.`);
    return '';
  }

  const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const fileName = `${reference}-reference.${extension}`;

  await fs.promises.mkdir(REFERENCE_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(REFERENCE_DIR, fileName), buffer);

  console.log(
    `[booking] Stored reference picture ${fileName} (${buffer.length} bytes) for ${
      originalName || 'the customer'
    }.`
  );

  return fileName;
}

/**
 * Saves the payment proof sent with a booking. Same rules as the reference
 * picture: only plain image data URLs inside the size limit are accepted.
 */
async function persistReceiptImage(reference, dataUrl, originalName = '') {
  const raw = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (!raw) return '';

  const match = RECEIPT_DATA_URL_PATTERN.exec(raw);
  if (!match) {
    console.warn(`[booking] Ignored an unsupported payment receipt for ${reference}.`);
    return '';
  }

  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');

  if (!buffer.length || buffer.length > MAX_REFERENCE_BYTES) {
    console.warn(`[booking] Ignored a payment receipt with size ${buffer.length} for ${reference}.`);
    return '';
  }

  const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const fileName = `${reference}-receipt.${extension}`;

  await fs.promises.mkdir(RECEIPT_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(RECEIPT_DIR, fileName), buffer);

  console.log(
    `[booking] Stored payment receipt ${fileName} (${buffer.length} bytes) for ${
      originalName || reference
    }.`
  );

  return fileName;
}

// Absolute URLs so the admin page can show the picture even when it is served
// from a different local port (Live Server) than this API.
function withReferenceUrls(req, request) {
  const origin = `${req.protocol}://${req.get('host')}`;

  return {
    ...request,
    referenceUrls: (request.referenceFiles || []).map(
      (fileName) => `${origin}/api/references/${encodeURIComponent(fileName)}`
    ),
    receiptUrls: (request.receiptFiles || []).map(
      (fileName) => `${origin}/api/receipts/${encodeURIComponent(fileName)}`
    )
  };
}


function normalizeBooking(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const fields = [];

  const fullName = cleanSingleLine(
    readPayloadField(payload, [
      'fullName',
      'full_name',
      'customerName',
      'customer_name',
      'clientName',
      'client_name',
      'guestName',
      'guest_name',
      'name'
    ]),
    120
  );
  const email = cleanSingleLine(
    readPayloadField(payload, [
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
    ]),
    254
  ).toLowerCase();
  const serviceType = cleanSingleLine(
    readPayloadField(payload, ['serviceType', 'service_type', 'appointmentType', 'appointment_type']),
    80
  );
  const service =
    cleanSingleLine(
      readPayloadField(payload, ['service', 'serviceName', 'service_name', 'appointmentType', 'appointment_type']),
      160
    ) || serviceType;
  const date = cleanSingleLine(
    readPayloadField(payload, [
      'date',
      'scheduledDate',
      'scheduled_date',
      'appointmentDate',
      'appointment_date',
      'bookingDate',
      'booking_date'
    ]),
    80
  );
  const time = cleanSingleLine(
    readPayloadField(payload, [
      'time',
      'scheduledTime',
      'scheduled_time',
      'appointmentTime',
      'appointment_time',
      'bookingTime',
      'booking_time',
      'slot'
    ]),
    40
  );
  const rawClientRequestId = cleanSingleLine(
    readPayloadField(payload, ['clientRequestId', 'client_request_id']),
    100
  );
  const clientRequestId = CLIENT_REQUEST_ID_PATTERN.test(rawClientRequestId)
    ? rawClientRequestId
    : '';

  if (!fullName) fields.push('fullName');
  if (!EMAIL_PATTERN.test(email)) fields.push('email');
  if (!service) fields.push('service');
  if (!date) fields.push('date');
  if (!time) fields.push('time');

  if (fields.length) {
    return { fields, booking: null };
  }

  const parsedAge = Number.parseInt(payload.age, 10);
  const rawTattooFormType = cleanSingleLine(
    readPayloadField(payload, ['tattooFormType', 'tattoo_form_type']),
    20
  ).toLowerCase();

  return {
    fields: [],
    booking: {
      fullName,
      email,
      age: Number.isFinite(parsedAge) ? parsedAge : null,
      phone: cleanSingleLine(
        readPayloadField(payload, [
          'phone',
          'phoneNumber',
          'phone_number',
          'contactNumber',
          'contact_number',
          'mobile',
          'mobileNumber',
          'mobile_number'
        ]),
        40
      ),
      serviceType,
      service,
      artist:
        cleanSingleLine(
          readPayloadField(payload, ['artist', 'artistName', 'artist_name', 'assignedArtist', 'assigned_artist']),
          120
        ) || 'Paulina Vampire',
      date,
      time,
      placement: cleanSingleLine(
        readPayloadField(payload, [
          'placement',
          'bodyPlacement',
          'body_placement',
          'tattooPlacement',
          'tattoo_placement',
          'location'
        ]),
        120
      ),
      tattooSize: cleanSingleLine(
        readPayloadField(payload, ['tattooSize', 'tattoo_size', 'targetSize', 'target_size', 'size']),
        120
      ),
      // Custom Tattoo Booking Form details, surfaced on the admin
      // Custom Requests page.
      tattooFormType: ['custom', 'standard'].includes(rawTattooFormType) ? rawTattooFormType : '',
      tattooStyle: cleanSingleLine(
        readPayloadField(payload, ['tattooStyle', 'tattoo_style', 'style', 'designStyle', 'design_style']),
        60
      ),
      tattooReferenceFileName: cleanSingleLine(
        readPayloadField(payload, ['tattooReferenceFileName', 'tattoo_reference_file_name']),
        255
      ),
      // Downscaled data URL for the reference picture (Custom Tattoo only).
      tattooReferenceImage:
        typeof payload.tattooReferenceImage === 'string' ? payload.tattooReferenceImage : '',
      notes: cleanNotes(
        readPayloadField(payload, [
          'notes',
          'note',
          'message',
          'specialRequests',
          'special_requests',
          'customerNotes',
          'customer_notes'
        ])
      ),
      paymentMethod: cleanSingleLine(
        readPayloadField(payload, [
          'paymentMethod',
          'payment_method',
          'depositMethod',
          'deposit_method'
        ]),
        40
      ),
      receiptFileName: cleanSingleLine(
        readPayloadField(payload, ['receiptFileName', 'receipt_file_name']),
        255
      ),
      // Downscaled data URL of the uploaded payment proof.
      receiptImage:
        typeof payload.receiptImage === 'string' ? payload.receiptImage : '',
      clientRequestId
    }
  };
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  const email = getEmailConfig();
  const smtpVerification = getSmtpVerification();

  res.json({
    success: true,
    status: 'ok',
    email: {
      provider: email.provider,
      providerPreference: email.providerPreference,
      configured: email.configured,
      from: email.fromEmail,
      fromMatchesUser: email.fromEmailMatchesUser,
      recipientSource: 'customer-email',
      externalDelivery: email.externalDelivery,
      sandboxSender: email.sandboxSender,
      smtpVerification:
        email.provider === 'smtp' ? smtpVerification.status : 'not-applicable',
      smtpVerificationError:
        email.provider === 'smtp' ? smtpVerification.error || null : null,
      smtpPasswordFormatValid:
        email.provider === 'smtp' ? email.smtp.passwordFormatValid : null,
      warnings: Array.isArray(email.senderWarnings) ? email.senderWarnings : [],
      deliveryHint: email.externalDelivery
        ? null
        : email.provider === 'smtp'
          ? email.configured
            ? 'SMTP authentication failed. Regenerate the Gmail App Password and update SMTP_PASS.'
            : 'Add SMTP_HOST, SMTP_USER, and SMTP_PASS to send to every customer.'
          : 'Resend is using its sandbox sender. Verify a domain at resend.com/domains and update RESEND_FROM_EMAIL, or configure SMTP_* in .env.'
    },
    storage: getStorageMode()
  });
});

app.post('/api/send-booking-email', bookingRateLimit, async (req, res) => {
  const { fields, booking } = normalizeBooking(req.body);

  if (!booking) {
    return res.status(400).json({
      success: false,
      error: 'Please complete the required booking details before confirming.',
      fields
    });
  }

  // A retry after a lost response reuses the same browser-generated token.
  // Return the original booking instead of saving or emailing it twice.
  if (booking.clientRequestId) {
    try {
      const existing = await findBookingByClientRequestId(booking.clientRequestId);

      if (existing) {
        // Every booking now waits for the studio, so a repeat submission must
        // never claim a confirmation email was sent at submission time.
        const alreadyDecided = ['confirmed', 'cancelled'].includes(
          String(existing.status || '').toLowerCase()
        );

        return res.status(200).json({
          success: true,
          duplicate: true,
          reference: existing.reference,
          bookingId: existing.reference,
          confirmationDeferred: !alreadyDecided,
          emailSent: alreadyDecided ? Boolean(existing.emailSent) : false,
          sentTo: existing.email || booking.email,
          emailError: alreadyDecided ? existing.emailError || null : null,
          storage: getStorageMode(),
          message: alreadyDecided
            ? `This booking was already reviewed (${existing.status}).`
            : `This booking request was already received as ${existing.reference}. The studio will email you once it is reviewed.`
        });
      }
    } catch (error) {
      console.error('[booking] Could not check the existing booking token:', error.message);
    }
  }

  const reference = generateBookingReference();
  const {
    tattooFormType,
    tattooStyle,
    tattooReferenceFileName,
    tattooReferenceImage,
    receiptImage,
    ...bookingFields
  } = booking;

  // Conflict prevention: check if date and slot are already locked by a confirmed booking
  try {
    const lockedTimes = await getLockedSlots(bookingFields.date, bookingFields.artist);
    if (lockedTimes.some((t) => t.toLowerCase() === String(bookingFields.time || '').toLowerCase())) {
      return res.status(409).json({
        success: false,
        error: `The ${bookingFields.time} slot on ${bookingFields.date} is already confirmed for another session. Please select an alternate time.`
      });
    }
  } catch (err) {
    console.warn('[booking] Could not check slot locks:', err.message);
  }

  // Every service type is an appointment *request* until the studio accepts
  // it. Piercings, standard tattoos and custom tattoo requests all start in
  // the review queue and are emailed only after a decision is recorded.
  const initialStatus = 'pending_confirmation';

  const record = {
    ...bookingFields,
    reference,
    status: initialStatus
  };

  let storage;
  try {
    storage = await saveBooking(record);
  } catch (error) {
    console.error('[booking] Failed to persist booking:', error);
    return res.status(500).json({
      success: false,
      error: 'We could not save your booking. Please try again in a moment.'
    });
  }

  // New request: connected dashboards refetch so the feed is current even
  // before the studio confirms it.
  broadcastBookingsChanged('created', { reference });

  // Step one of every notification is the studio alert email; the dashboard
  // record is written afterwards so it can carry the delivery result.
  await notifyStudio({
    type: 'booking',
    title: `New booking from ${record.fullName || 'a client'}`,
    message: 'A new booking request is waiting in the review queue.',
    reference,
    customerName: record.fullName || '',
    details: [
      ['Service', record.service || ''],
      ['Requested date', record.date || ''],
      ['Requested time', record.time || ''],
      ['Payment method', record.paymentMethod || ''],
      ['Email', record.email || ''],
      ['Phone', record.phone || ''],
      ['Payment proof', record.receiptFileName || 'Not attached']
    ]
  });

  // Every submission enters the admin review queue. The extra form details are
  // kept outside the bookings record so existing storage schemas stay untouched.
  let storedReferenceFile = '';

  if (tattooReferenceFileName && !tattooReferenceImage) {
    console.warn(
      '[booking] ' + reference + ' arrived with reference file name "' + tattooReferenceFileName + '" but no image data.'
    );
  }
  try {
    storedReferenceFile = await persistReferenceImage(
      reference,
      tattooReferenceImage,
      tattooReferenceFileName
    );
  } catch (error) {
    console.warn(`[booking] Could not store the reference picture for ${reference}:`, error.message);
  }

  let storedReceiptFile = '';
  try {
    storedReceiptFile = await persistReceiptImage(reference, receiptImage, bookingFields.receiptFileName);
  } catch (error) {
    console.warn(`[booking] Could not store the payment receipt for ${reference}:`, error.message);
  }

  try {
    await recordSubmittedRequest({
      ...record,
      tattooFormType,
      tattooStyle,
      tattooReferenceFileName,
      tattooReferenceStoredFile: storedReferenceFile,
      receiptFileName: bookingFields.receiptFileName,
      receiptStoredFile: storedReceiptFile
    });
  } catch (error) {
    console.error(`[booking] Could not queue custom request ${reference}:`, error.message);
  }

  // Nothing is emailed at submission time. The confirmation template is sent
  // by the decision route when an admin accepts the booking, so the customer
  // is never told they are booked before the studio approves the appointment.
  return res.status(201).json({
    success: true,
    reference,
    bookingId: reference,
    clientRequestId: record.clientRequestId || null,
    confirmationDeferred: true,
    emailSent: false,
    emailId: null,
    sentTo: record.email,
    emailError: null,
    storage: storage.type,
    message:
      `Booking request received. The studio will review it and email your confirmation to ${record.email} once it is approved.`
  });
});

app.get('/api/bookings/status/:clientRequestId', async (req, res) => {
  const token = String(req.params.clientRequestId || '').trim();

  if (!CLIENT_REQUEST_ID_PATTERN.test(token)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid booking status token.'
    });
  }

  try {
    const booking = await findBookingByClientRequestId(token);

    if (!booking) {
      return res.status(404).json({
        success: false,
        found: false,
        error: 'No confirmed booking was found for this request.'
      });
    }

    return res.json({
      success: true,
      found: true,
      booking: {
        reference: booking.reference,
        fullName: booking.fullName,
        email: booking.email,
        phone: booking.phone,
        serviceType: booking.serviceType,
        service: booking.service,
        artist: booking.artist,
        date: booking.date,
        time: booking.time,
        paymentMethod: booking.paymentMethod,
        status: booking.status,
        confirmationDeferred:
          String(booking.status || '').toLowerCase() === 'pending_confirmation',
        emailSent: Boolean(booking.emailSent),
        emailError: booking.emailError || null
      }
    });
  } catch (error) {
    console.error('[booking] Could not load the booking status:', error.message);
    return res.status(500).json({
      success: false,
      error: 'We could not check the booking status.'
    });
  }
});

// ---------------------------------------------------------------------------
// Master Calendar Bookings (admin) & Locked Slots (public)
// ---------------------------------------------------------------------------
app.get('/api/bookings/locked-slots', async (req, res) => {
  try {
    const date = req.query.date;
    const artist = req.query.artist;
    if (!date) {
      return res.status(400).json({ success: false, error: 'Date is required.' });
    }
    const lockedSlots = await getLockedSlots(date, artist);
    return res.json({ success: true, date, lockedSlots });
  } catch (error) {
    console.error('[bookings] Could not get locked slots:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to retrieve locked slots' });
  }
});

// Real-time SSE stream for the dashboard: a created, accepted, edited or
// deleted booking is pushed straight to connected admin pages, so the bookings
// feed updates without waiting for its polling interval.
const bookingClients = new Set();

function broadcastBookingsChanged(action, data = null) {
  const payload = JSON.stringify({ action, data, timestamp: new Date().toISOString() });
  for (const client of bookingClients) {
    try {
      client.write(`event: bookings_change\ndata: ${payload}\n\n`);
    } catch {
      bookingClients.delete(client);
    }
  }
}

/**
 * Alerts the studio inbox first, then records the notification for the admin
 * dashboard. A failed email does not swallow the alert: it is stored anyway and
 * the delivery result is kept with it, so the team still sees it on login.
 */
async function notifyStudio(notification) {
  let emailSent = false;
  let emailError = '';

  try {
    const delivery = await sendStudioNotification(notification);
    emailSent = Boolean(delivery?.sent);
  } catch (error) {
    emailError = error?.message || 'The studio alert email could not be sent.';
    console.warn(`[notifications] Alert email failed: ${emailError}`);
  }

  try {
    return await addNotification({ ...notification, emailSent, emailError });
  } catch (error) {
    console.error('[notifications] Could not store the notification:', error.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Notifications: unread badge, login bar and the dedicated notifications page.

app.get('/api/notifications', async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 30;
    const [notifications, unreadCount] = await Promise.all([
      listNotifications({ limit }),
      countUnread()
    ]);

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, notifications, unreadCount });
  } catch (error) {
    console.error('[notifications] Could not list notifications:', error.message);
    return res.status(500).json({ success: false, error: 'Notifications could not be loaded.' });
  }
});

app.post('/api/notifications/read', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const changed = await markRead(ids);
    const unreadCount = await countUnread();

    return res.json({ success: true, changed, unreadCount });
  } catch (error) {
    console.error('[notifications] Could not mark notifications read:', error.message);
    return res.status(500).json({ success: false, error: 'Notifications could not be updated.' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const deleted = await deleteNotification(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Notification not found.' });
    }

    const unreadCount = await countUnread();
    return res.json({ success: true, deleted: true, unreadCount });
  } catch (error) {
    console.error('[notifications] Could not delete notification:', error.message);
    return res.status(500).json({ success: false, error: 'Notification could not be deleted.' });
  }
});

// Public reviews are written straight to Supabase from the browser, so the
// review composer pings this route after a successful post.
app.post('/api/notifications/review', async (req, res) => {
  const reviewerName = cleanSingleLine(req.body?.reviewerName, 120) || 'A client';
  const rating = Number.parseInt(req.body?.rating, 10);
  const body = String(req.body?.body || '').trim().slice(0, 600);

  try {
    const notification = await notifyStudio({
      type: 'review',
      title: `New ${Number.isFinite(rating) ? `${rating}-star ` : ''}review from ${reviewerName}`,
      message: body || 'A new review was posted on the website.',
      customerName: reviewerName,
      details: [
        ['Rating', Number.isFinite(rating) ? `${rating} out of 5` : ''],
        ['Posted', new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })]
      ]
    });

    return res.json({ success: true, notification });
  } catch (error) {
    console.error('[notifications] Could not record the review:', error.message);
    return res.status(500).json({ success: false, error: 'The review notification could not be recorded.' });
  }
});

app.get('/api/bookings/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  bookingClients.add(res);
  res.write(`event: connected\ndata: {"status":"connected"}\n\n`);

  req.on('close', () => {
    bookingClients.delete(res);
  });
});

app.get('/api/bookings', async (req, res) => {
  try {
    const rawBookings = await readAllBookings();
    let statusMap = {};
    try {
      const statusFilePath = path.join(PROJECT_ROOT, 'data', 'custom-request-status.json');
      if (fs.existsSync(statusFilePath)) {
        statusMap = JSON.parse(fs.readFileSync(statusFilePath, 'utf8')) || {};
      }
    } catch {
      // ignore status read errors
    }

    const FINALIZED_STATUSES = new Set(['completed', 'cancelled', 'canceled', 'noshow', 'late', 'latearrival']);

    const bookings = rawBookings.map((b) => {
      const ref = b.reference || b.id;
      let status = (b.status || 'confirmed').toLowerCase();
      const storedStatus = String(b.status || '').toLowerCase().replace(/[\s-_]/g, '');

      // A custom-request decision seeds the appointment status, but it must not
      // overwrite a status the admin has since finalized from the dashboard or
      // the Master Calendar (completed, cancelled, no-show, late).
      if (statusMap[ref] && !FINALIZED_STATUSES.has(storedStatus)) {
        if (statusMap[ref].status === 'accepted') status = 'confirmed';
        else if (statusMap[ref].status === 'declined') status = 'cancelled';
        else if (statusMap[ref].status === 'pending') status = 'pending_confirmation';
      }

      return {
        ...b,
        reference: ref,
        status,
        serviceType: b.serviceType || 'Tattoo'
      };
    });

    const { service, artist, status } = req.query;
    let filtered = bookings;

    if (service && service !== 'all') {
      filtered = filtered.filter(
        (b) => (b.serviceType || '').toLowerCase() === service.toLowerCase()
      );
    }
    if (artist && artist !== 'all') {
      filtered = filtered.filter(
        (b) => (b.artist || '').toLowerCase() === artist.toLowerCase()
      );
    }
    if (status && status !== 'all') {
      // Accept a single status or a comma-separated allow-list so the master
      // calendar can request only active/confirmed appointment states.
      const normalizeStatus = (value) =>
        String(value || '').toLowerCase().replace(/[\s-_]/g, '');

      const statuses = String(status)
        .split(',')
        .map(normalizeStatus)
        .filter(Boolean);

      filtered = filtered.filter((b) => statuses.includes(normalizeStatus(b.status)));
    }

    return res.json({ success: true, bookings: filtered });
  } catch (error) {
    console.error('[bookings] Could not list bookings:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to load bookings' });
  }
});

app.patch('/api/bookings/:reference', async (req, res) => {
  const reference = String(req.params.reference || '').trim();
  if (!BOOKING_REFERENCE_PATTERN.test(reference)) {
    return res.status(400).json({ success: false, error: 'Invalid booking reference.' });
  }

  const patch = {};
  if (req.body.status) {
    const s = String(req.body.status).toLowerCase().replace(/[\s-_]/g, '');
    const map = {
      confirmed: 'confirmed',
      completed: 'completed',
      cancelled: 'cancelled',
      canceled: 'cancelled',
      noshow: 'noshow',
      late: 'late',
      latearrival: 'late',
      pendingconfirmation: 'pending_confirmation'
    };
    if (!map[s]) {
      return res.status(400).json({ success: false, error: 'Invalid status value.' });
    }
    patch.status = map[s];
  }
  if (req.body.serviceType) patch.serviceType = cleanSingleLine(req.body.serviceType, 50);
  if (req.body.service) patch.service = cleanSingleLine(req.body.service, 100);
  if (req.body.artist) patch.artist = cleanSingleLine(req.body.artist, 100);
  if (req.body.date) patch.date = cleanSingleLine(req.body.date, 50);
  if (req.body.time) patch.time = cleanSingleLine(req.body.time, 50);
  if (req.body.notes !== undefined) patch.notes = cleanNotes(req.body.notes, 500);

  try {
    const success = await updateBooking(reference, patch);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }
    broadcastBookingsChanged('updated', { reference });
    return res.json({ success: true, reference, patch });
  } catch (error) {
    console.error(`[bookings] Could not update ${reference}:`, error.message);
    return res.status(500).json({ success: false, error: 'Failed to update booking.' });
  }
});

app.delete('/api/bookings/:reference', async (req, res) => {
  const reference = String(req.params.reference || '').trim();
  if (!BOOKING_REFERENCE_PATTERN.test(reference)) {
    return res.status(400).json({ success: false, error: 'Invalid booking reference.' });
  }

  try {
    const success = await deleteBooking(reference);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }
    broadcastBookingsChanged('deleted', { reference });
    return res.json({ success: true, reference });
  } catch (error) {
    console.error(`[bookings] Could not delete ${reference}:`, error.message);
    return res.status(500).json({ success: false, error: 'Failed to delete booking.' });
  }
});

// ---------------------------------------------------------------------------
// Custom tattoo requests (admin)
// ---------------------------------------------------------------------------
app.get('/api/references/:fileName', (req, res) => {
  const fileName = path.basename(String(req.params.fileName || ''));

  if (!REFERENCE_FILE_PATTERN.test(fileName)) {
    return res.status(404).json({ success: false, error: 'Reference picture not found.' });
  }

  const filePath = path.join(REFERENCE_DIR, fileName);

  return res.sendFile(filePath, { headers: { 'Cache-Control': 'private, max-age=600' } }, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ success: false, error: 'Reference picture not found.' });
    }
  });
});

app.get('/api/receipts/:fileName', (req, res) => {
  const fileName = path.basename(String(req.params.fileName || ''));

  if (!RECEIPT_FILE_PATTERN.test(fileName)) {
    return res.status(404).json({ success: false, error: 'Payment receipt not found.' });
  }

  return res.sendFile(
    path.join(RECEIPT_DIR, fileName),
    { headers: { 'Cache-Control': 'private, max-age=600' } },
    (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ success: false, error: 'Payment receipt not found.' });
      }
    }
  );
});

app.get('/api/custom-requests', async (req, res) => {
  try {
    const requests = await listCustomRequests();
    return res.json({
      success: true,
      storage: getStorageMode(),
      requests: requests.map((request) => withReferenceUrls(req, request))
    });
  } catch (error) {
    console.error('[custom-requests] Could not list requests:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Custom requests could not be loaded. Please try again.'
    });
  }
});

// Opening a request in the admin panel removes it from the Needs Review queue.
app.post('/api/custom-requests/:reference/view', async (req, res) => {
  const reference = String(req.params.reference || '').trim();

  if (!BOOKING_REFERENCE_PATTERN.test(reference)) {
    return res.status(400).json({ success: false, error: 'Invalid request reference.' });
  }

  try {
    const existing = await getCustomRequest(reference);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Custom request not found.' });
    }

    let request = existing;

    if (!existing.reviewedAt) {
      const state = await markRequestReviewed(reference);
      request = { ...existing, reviewedAt: state?.reviewedAt || new Date().toISOString() };
    }

    return res.json({ success: true, request: withReferenceUrls(req, request) });
  } catch (error) {
    console.error(`[custom-requests] Could not mark ${reference} as reviewed:`, error.message);
    return res.status(500).json({
      success: false,
      error: 'The request could not be marked as reviewed.'
    });
  }
});

// Accepting or declining saves the decision first, then emails the customer so
// a mail failure never loses the studio's decision.
app.post('/api/custom-requests/:reference/decision', async (req, res) => {
  const reference = String(req.params.reference || '').trim();
  const decision = String(req.body?.decision || '').trim().toLowerCase();
  const reason = cleanNotes(req.body?.reason, 500);

  if (!BOOKING_REFERENCE_PATTERN.test(reference)) {
    return res.status(400).json({ success: false, error: 'Invalid request reference.' });
  }

  if (decision !== 'accept' && decision !== 'decline') {
    return res.status(400).json({ success: false, error: 'Choose to accept or decline the request.' });
  }

  if (decision === 'decline' && !reason) {
    return res.status(400).json({
      success: false,
      error: 'Please enter a reason for declining this request.'
    });
  }

  try {
    const existing = await getCustomRequest(reference);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Custom request not found.' });
    }

    if (existing.status === 'accepted' || existing.status === 'declined') {
      return res.status(409).json({
        success: false,
        error: `This request was already ${existing.status}.`,
        request: withReferenceUrls(req, existing)
      });
    }

    const decidedAt = new Date().toISOString();
    const requestStatus = decision === 'accept' ? 'accepted' : 'declined';

    await updateRequestStatus(reference, {
      status: requestStatus,
      reviewedAt: existing.reviewedAt || decidedAt,
      decidedAt,
      declineReason: decision === 'decline' ? reason : ''
    });

    // Synchronize to Master Calendar: update booking record status to Confirmed or Cancelled
    try {
      if (decision === 'accept') {
        await updateBooking(reference, { status: 'confirmed' });
      } else if (decision === 'decline') {
        await updateBooking(reference, { status: 'cancelled' });
      }
      broadcastBookingsChanged('updated', { reference });
    } catch (bookingSyncErr) {
      console.error(`[custom-requests] Could not update booking status for ${reference}:`, bookingSyncErr.message);
    }

    let emailSent = false;
    let emailError = null;
    let emailErrorMessage = null;
    let emailProvider = getEmailConfig().provider;
    let message = '';
    let recipientEmail = String(existing.email || '').trim().toLowerCase();

    try {
      if (decision === 'accept') {
        // Acceptance is the moment the booking becomes confirmed, so the
        // booking confirmation template is dispatched here (and only here).
        // Prefer the stored booking row, but keep the reviewed request fields
        // for records whose email/name arrived under a different key.
        const records = await readAllBookings();
        const stored = records.find((item) => String(item.reference || item.id || '') === reference);
        const approved = normalizeBookingRecord({
          ...existing,
          ...(stored || {}),
          reference,
          email: stored?.email || existing.email || ''
        });
        recipientEmail = approved.email || recipientEmail;

        const delivery = await sendBookingConfirmation(approved);
        emailSent = delivery.sent === true;
        emailProvider = delivery.provider || emailProvider;
        try {
          await updateBookingDelivery(reference, {
            emailSent,
            emailError: null,
            emailProvider
          });
        } catch (deliveryError) {
          console.warn(
            `[custom-requests] Could not record confirmation delivery for ${reference}:`,
            deliveryError.message
          );
        }
        message = `Booking approved. Confirmation email sent to ${delivery.recipient || approved.email}.`;
      } else {
        const delivery = await sendCustomRequestDecision({
          booking: { ...existing, tattooStyle: existing.style },
          decision,
          reason
        });
        emailSent = delivery.sent === true;
        emailProvider = delivery.provider || emailProvider;
        message = `Request declined. Notification email sent to ${delivery.recipient || existing.email}.`;
      }
    } catch (error) {
      emailError = error.code || 'EMAIL_SEND_FAILED';
      emailErrorMessage = error.message || 'The email could not be sent.';
      console.error(
        `[custom-requests] Decision email failed for ${reference} (${emailError}) to ${recipientEmail}:`,
        emailErrorMessage
      );

      // Record the failed delivery on the booking as well as the request. The
      // old code only wrote successful deliveries, so the admin list and the
      // Master Calendar could show emailSent:false with no reason at all.
      try {
        await updateBookingDelivery(reference, {
          emailSent: false,
          emailError: emailErrorMessage,
          emailProvider
        });
      } catch (deliveryError) {
        console.warn(
          `[custom-requests] Could not record failed delivery for ${reference}:`,
          deliveryError.message
        );
      }

      message =
        `The decision was saved, but the email to ${recipientEmail || 'the customer'} could not be sent. ` +
        `${emailErrorMessage} Check the email settings and follow up with the customer.`;
    }

    try {
      await updateRequestStatus(reference, { emailSent, emailError, emailErrorMessage });
    } catch (error) {
      console.error(`[custom-requests] Could not record delivery for ${reference}:`, error.message);
    }

    return res.json({
      success: true,
      decision: requestStatus,
      emailSent,
      emailError,
      emailErrorMessage,
      emailProvider,
      message,
      request: withReferenceUrls(req, {
        ...existing,
        status: requestStatus,
        reviewedAt: existing.reviewedAt || decidedAt,
        decidedAt,
        declineReason: decision === 'decline' ? reason : '',
        decisionEmailSent: emailSent,
        decisionEmailError: emailErrorMessage
      })
    });
  } catch (error) {
    console.error(`[custom-requests] Could not decide ${reference}:`, error.message);
    return res.status(500).json({
      success: false,
      error: 'The decision could not be saved. Please try again.'
    });
  }
});

// Removes a booking from the studio's records. Review state, the booking row and
// any uploaded pictures go together, so a reviewed request cannot be resurrected
// by the status file or leave orphaned files behind.
app.delete('/api/custom-requests/:reference', async (req, res) => {
  const reference = String(req.params.reference || '').trim();

  if (!BOOKING_REFERENCE_PATTERN.test(reference)) {
    return res.status(400).json({ success: false, error: 'Invalid booking reference.' });
  }

  try {
    const existing = await getCustomRequest(reference);
    let removed = false;

    try {
      removed = await deleteBooking(reference);
    } catch (error) {
      console.warn(`[custom-requests] Booking row for ${reference} was not removed:`, error.message);
    }

    const statusRemoved = await deleteRequestStatus(reference);

    if (!removed && !statusRemoved) {
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }

    // Best effort: the record is already gone, so a missing file is not an error.
    const files = [
      ...(existing?.referenceFiles || []).map((name) => path.join(REFERENCE_DIR, path.basename(name))),
      ...(existing?.receiptFiles || []).map((name) => path.join(RECEIPT_DIR, path.basename(name)))
    ];

    await Promise.all(
      files.map((file) => fs.promises.unlink(file).catch(() => {}))
    );

    broadcastBookingsChanged('deleted', { reference });

    return res.json({ success: true, reference });
  } catch (error) {
    console.error(`[custom-requests] Could not delete ${reference}:`, error.message);
    return res.status(500).json({
      success: false,
      error: 'The booking could not be deleted. Please try again.'
    });
  }
});

// ---------------------------------------------------------------------------
// Gallery Management API & Real-Time Synchronization
// ---------------------------------------------------------------------------
const multer = require('multer');
const GALLERY_UPLOAD_DIR = path.join(PROJECT_ROOT, 'data', 'uploads', 'gallery');

const galleryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(GALLERY_UPLOAD_DIR, { recursive: true });
    cb(null, GALLERY_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);
    const unique = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    cb(null, `${safeBase || 'work'}-${unique}${ext}`);
  }
});

const galleryUpload = multer({
  storage: galleryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes((file.mimetype || '').toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WebP images are allowed.'));
    }
  }
});

// Real-Time SSE Event Stream for instant updates on client tabs
const galleryClients = new Set();

registerChangeListener((action, data) => {
  const payload = JSON.stringify({ action, data, timestamp: new Date().toISOString() });
  for (const client of galleryClients) {
    try {
      client.write(`event: gallery_change\ndata: ${payload}\n\n`);
    } catch {
      galleryClients.delete(client);
    }
  }
});

app.get('/api/gallery/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  galleryClients.add(res);
  res.write(`event: connected\ndata: {"status":"connected"}\n\n`);

  req.on('close', () => {
    galleryClients.delete(res);
  });
});

// Public gallery endpoint for published works. Admin writes must be visible on
// the next request, so this response is never served from a stale cache.
app.get('/api/gallery', async (req, res) => {
  try {
    const category = req.query.category || 'all';
    const images = await getPublishedImages(category);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, count: images.length, images });
  } catch (error) {
    console.error('[gallery] Could not fetch published gallery:', error.message);
    return res.status(500).json({ success: false, error: 'Could not fetch gallery works.' });
  }
});

// Admin gallery list with filters and stats
app.get('/api/admin/gallery', async (req, res) => {
  try {
    const { category, visibility, search, sort } = req.query;
    const result = await getAllImagesAdmin({ category, visibility, search, sort });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[gallery] Admin gallery fetch failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to retrieve admin gallery list.' });
  }
});

// Single gallery image detail
app.get('/api/admin/gallery/:id', async (req, res) => {
  try {
    const image = await getImageById(req.params.id);
    if (!image) {
      return res.status(404).json({ success: false, error: 'Image not found.' });
    }
    return res.json({ success: true, image });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to retrieve image.' });
  }
});

// Upload a new gallery image
app.post('/api/admin/gallery/upload', (req, res) => {
  galleryUpload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds maximum limit of 10 MB.' : err.message;
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please choose an image file to upload.' });
    }

    try {
      const relativeUrl = `/uploads/gallery/${req.file.filename}`;
      const title = (req.body.title || path.parse(req.file.originalname).name || 'New Studio Work').trim();
      const category = req.body.category || 'Face';
      const subcategory = req.body.subcategory || 'Face tattoos';
      const bodyPart = (req.body.bodyPart || '').trim();
      const altText = req.body.altText || '';
      const isPublished = req.body.isPublished === 'true' || req.body.isPublished === true;

      const created = await createImage({
        title,
        category,
        subcategory,
        bodyPart,
        imageUrl: relativeUrl,
        thumbnailUrl: relativeUrl,
        altText,
        isPublished,
        displayOrder: Number(req.body.displayOrder) || 0
      });

      return res.status(201).json({ success: true, image: created });
    } catch (error) {
      console.error('[gallery] Upload processing failed:', error.message);
      // Multer already wrote the file; do not leave an unreferenced upload
      // behind when the metadata write fails.
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(500).json({ success: false, error: 'Failed to save uploaded work.' });
    }
  });
});

// Change/replace image file for existing entry
app.post('/api/admin/gallery/:id/change-image', (req, res) => {
  galleryUpload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds 10 MB.' : err.message;
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file uploaded.' });
    }

    try {
      const id = req.params.id;
      const relativeUrl = `/uploads/gallery/${req.file.filename}`;
      const updated = await updateImage(id, {
        imageUrl: relativeUrl,
        thumbnailUrl: relativeUrl
      });
      if (!updated) {
        // The replacement file has no owning record; remove it.
        fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(404).json({ success: false, error: 'Image not found.' });
      }
      return res.json({ success: true, image: updated });
    } catch (error) {
      console.error('[gallery] Replace image failed:', error.message);
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(500).json({ success: false, error: 'Failed to replace image.' });
    }
  });
});

// Update gallery image properties
app.put('/api/admin/gallery/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { title, category, subcategory, bodyPart, altText, isPublished, displayOrder } = req.body;
    const updated = await updateImage(id, {
      title,
      category,
      subcategory,
      bodyPart,
      altText,
      isPublished,
      displayOrder
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Image not found.' });
    }
    return res.json({ success: true, image: updated });
  } catch (error) {
    console.error('[gallery] Update failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to update image.' });
  }
});

// Quick toggle visibility
app.patch('/api/admin/gallery/:id/visibility', async (req, res) => {
  try {
    const id = req.params.id;
    const { isPublished } = req.body;
    const updated = await updateImage(id, { isPublished: Boolean(isPublished) });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Image not found.' });
    }
    return res.json({ success: true, image: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update visibility.' });
  }
});

// Delete gallery image
app.delete('/api/admin/gallery/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await deleteImage(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Image not found.' });
    }
    return res.json({ success: true, id });
  } catch (error) {
    console.error('[gallery] Delete failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to delete image.' });
  }
});

// ---------------------------------------------------------------------------
// Catalogue Management API & Real-Time Synchronization
// ---------------------------------------------------------------------------
const CATALOGUE_UPLOAD_DIR = path.join(PROJECT_ROOT, 'data', 'uploads', 'catalogue');

const catalogueStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(CATALOGUE_UPLOAD_DIR, { recursive: true });
    cb(null, CATALOGUE_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);
    const unique = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    cb(null, `${safeBase || 'catalogue'}-${unique}${ext}`);
  }
});

const catalogueUpload = multer({
  storage: catalogueStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes((file.mimetype || '').toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WebP images are allowed.'));
    }
  }
});

// Real-Time SSE Event Stream for instant catalogue updates on client and admin tabs
const catalogueClients = new Set();

registerCatalogueChangeListener((action, data) => {
  const payload = JSON.stringify({ action, data, timestamp: new Date().toISOString() });
  for (const client of catalogueClients) {
    try {
      client.write(`event: catalogue_change\ndata: ${payload}\n\n`);
    } catch {
      catalogueClients.delete(client);
    }
  }
});

app.get('/api/catalogue/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  catalogueClients.add(res);
  res.write(`event: connected\ndata: {"status":"connected"}\n\n`);

  req.on('close', () => {
    catalogueClients.delete(res);
  });
});

// Public catalogue endpoint for published piercings & jewelry
app.get('/api/catalogue', async (req, res) => {
  try {
    const category = req.query.category || 'all';
    const items = await getPublishedCatalogue(category);
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    return res.json({ success: true, count: items.length, items });
  } catch (error) {
    console.error('[catalogue] Could not fetch published catalogue:', error.message);
    return res.status(500).json({ success: false, error: 'Could not fetch catalogue items.' });
  }
});

// Typeahead suggestions for the public catalogue search. Partial matches are
// ranked: name prefix, word prefix, name substring, then placement/material.
app.get('/api/catalogue/suggest', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 6, 1), 10);

    res.setHeader('Cache-Control', 'no-store');

    if (!query) {
      return res.json({ success: true, query: '', suggestions: [] });
    }

    const needle = query.toLowerCase();
    const items = await getPublishedCatalogue();

    const ranked = items
      .map((item) => {
        const name = String(item.name || '').toLowerCase();
        const category = String(item.category || '').toLowerCase();
        const subcategory = String(item.subcategory || '').toLowerCase();
        const material = String(item.material || '').toLowerCase();

        // Short queries only look at product names; longer ones may match the
        // placement or material so "helix" and "titanium" still find pieces.
        let score = -1;
        if (name.startsWith(needle)) score = 0;
        else if (name.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle))) score = 1;
        else if (needle.length >= 2 && name.includes(needle)) score = 2;
        else if (needle.length >= 3 && subcategory.includes(needle)) score = 3;
        else if (needle.length >= 3 && category.includes(needle)) score = 4;
        else if (needle.length >= 4 && material.includes(needle)) score = 5;

        return { item, score };
      })
      .filter((entry) => entry.score !== -1)
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .slice(0, limit);

    return res.json({
      success: true,
      query,
      suggestions: ranked.map(({ item }) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        material: item.material,
        price: item.price,
        image: item.thumbnailUrl || item.imageUrl
      }))
    });
  } catch (error) {
    console.error('[catalogue] Suggestion search failed:', error.message);
    return res.status(500).json({ success: false, error: 'Could not search the catalogue.' });
  }
});

// Admin catalogue list with filters and stats
app.get('/api/admin/catalogue', async (req, res) => {
  try {
    const { category, visibility, search, sort } = req.query;
    const result = await getAllCatalogueAdmin({ category, visibility, search, sort });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[catalogue] Admin catalogue fetch failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to retrieve admin catalogue list.' });
  }
});

// Single catalogue item detail
app.get('/api/admin/catalogue/:id', async (req, res) => {
  try {
    const item = await getCatalogueItemById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Catalogue item not found.' });
    }
    return res.json({ success: true, item });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to retrieve catalogue item.' });
  }
});

// Upload a new catalogue item
app.post('/api/admin/catalogue/upload', (req, res) => {
  catalogueUpload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds maximum limit of 10 MB.' : err.message;
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please choose an image file to upload.' });
    }

    try {
      const relativeUrl = `/uploads/catalogue/${req.file.filename}`;
      const name = (req.body.name || req.body.title || path.parse(req.file.originalname).name || 'New Studio Work').trim();
      const category = req.body.category || 'Ear';
      const subcategory = req.body.subcategory || 'Helix';
      const material = req.body.material || 'ASTM F136 Titanium';
      const price = Number(req.body.price ?? 600);
      let sizes = req.body.sizes;
      if (typeof sizes === 'string') {
        try { sizes = JSON.parse(sizes); } catch { sizes = sizes.split(',').map(s => s.trim()).filter(Boolean); }
      }
      if (!Array.isArray(sizes) || sizes.length === 0) {
        sizes = ['4mm', '3mm', '2mm'];
      }
      const activeSize = req.body.activeSize || sizes[0] || '4mm';
      const socialMedia = req.body.socialMedia || 'Instagram';
      const isPublished = req.body.isPublished === 'true' || req.body.isPublished === true;

      const created = await createCatalogueItem({
        name,
        category,
        subcategory,
        material,
        price,
        sizes,
        activeSize,
        socialMedia,
        imageUrl: relativeUrl,
        thumbnailUrl: relativeUrl,
        images: [relativeUrl],
        isPublished
      });

      return res.status(201).json({ success: true, item: created });
    } catch (error) {
      console.error('[catalogue] Upload processing failed:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to save uploaded catalogue item.' });
    }
  });
});

// Change/replace image file for existing catalogue entry
app.post('/api/admin/catalogue/:id/change-image', (req, res) => {
  catalogueUpload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds 10 MB.' : err.message;
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file uploaded.' });
    }

    try {
      const id = req.params.id;
      const relativeUrl = `/uploads/catalogue/${req.file.filename}`;
      const updated = await updateCatalogueItem(id, {
        imageUrl: relativeUrl,
        thumbnailUrl: relativeUrl
      });
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Catalogue item not found.' });
      }
      return res.json({ success: true, item: updated });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to replace catalogue image.' });
    }
  });
});

// Update catalogue item properties
app.put('/api/admin/catalogue/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { name, title, category, subcategory, material, price, sizes, activeSize, socialMedia, isPublished, displayOrder } = req.body;
    let parsedSizes = sizes;
    if (typeof parsedSizes === 'string') {
      try { parsedSizes = JSON.parse(parsedSizes); } catch { parsedSizes = parsedSizes.split(',').map(s => s.trim()).filter(Boolean); }
    }
    const updated = await updateCatalogueItem(id, {
      name,
      title,
      category,
      subcategory,
      material,
      price,
      sizes: parsedSizes,
      activeSize,
      socialMedia,
      isPublished,
      displayOrder
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Catalogue item not found.' });
    }
    return res.json({ success: true, item: updated });
  } catch (error) {
    console.error('[catalogue] Update failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to update catalogue item.' });
  }
});

// Quick toggle visibility
app.patch('/api/admin/catalogue/:id/visibility', async (req, res) => {
  try {
    const id = req.params.id;
    const { isPublished } = req.body;
    const updated = await updateCatalogueItem(id, { isPublished: Boolean(isPublished) });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Catalogue item not found.' });
    }
    return res.json({ success: true, item: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update visibility.' });
  }
});

// Delete catalogue item
app.delete('/api/admin/catalogue/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await deleteCatalogueItem(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Catalogue item not found.' });
    }
    return res.json({ success: true, id });
  } catch (error) {
    console.error('[catalogue] Delete failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to delete catalogue item.' });
  }
});

// ---------------------------------------------------------------------------
// Static website (only public pages and asset directories are exposed)
// ---------------------------------------------------------------------------
// The browser files (CSS, page scripts, images and fonts) live in public/ so
// Vercel can serve them from its CDN. The HTML pages, shared components and
// templates stay at the project root and are served by this app.
const STATIC_DIRECTORIES = {
  assets: 'public/assets',
  css: 'public/css',
  js: 'public/js',
  components: 'components',
  template: 'template',
  html: 'html'
};

for (const [route, directory] of Object.entries(STATIC_DIRECTORIES)) {
  app.use(
    `/${route}`,
    express.static(path.join(PROJECT_ROOT, directory), {
      dotfiles: 'ignore',
      fallthrough: true
    })
  );
}

app.use(
  '/uploads/gallery',
  express.static(path.join(PROJECT_ROOT, 'data', 'uploads', 'gallery'), {
    dotfiles: 'ignore',
    fallthrough: false
  })
);

app.use(
  '/uploads/catalogue',
  express.static(path.join(PROJECT_ROOT, 'data', 'uploads', 'catalogue'), {
    dotfiles: 'ignore',
    fallthrough: false
  })
);

const HTML_DIR = path.join(PROJECT_ROOT, 'html');
const USER_SIDE_DIR = path.join(HTML_DIR, 'user-side');
const ADMIN_SIDE_DIR = path.join(HTML_DIR, 'admin-side');

const USER_PAGES = new Set(
  fs.existsSync(USER_SIDE_DIR)
    ? fs
        .readdirSync(USER_SIDE_DIR)
        .filter((fileName) => fileName.toLowerCase().endsWith('.html'))
        .map((fileName) => fileName.toLowerCase())
    : []
);

const ADMIN_PAGES = new Set(
  fs.existsSync(ADMIN_SIDE_DIR)
    ? fs
        .readdirSync(ADMIN_SIDE_DIR)
        .filter((fileName) => fileName.toLowerCase().endsWith('.html'))
        .map((fileName) => fileName.toLowerCase())
    : []
);

app.get('/', (req, res) => {
  res.sendFile(path.join(USER_SIDE_DIR, 'home.html'));
});

app.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});

app.get('/user-side/:page', (req, res, next) => {
  const requested = String(req.params.page || '').toLowerCase();
  const fileName = requested.endsWith('.html') ? requested : `${requested}.html`;
  if (!USER_PAGES.has(fileName)) return next();
  return res.sendFile(path.join(USER_SIDE_DIR, fileName), (error) => {
    if (error) next(error);
  });
});

app.get('/admin-side/:page', (req, res, next) => {
  const requested = String(req.params.page || '').toLowerCase();
  const fileName = requested.endsWith('.html') ? requested : `${requested}.html`;
  if (!ADMIN_PAGES.has(fileName)) return next();
  return res.sendFile(path.join(ADMIN_SIDE_DIR, fileName), (error) => {
    if (error) next(error);
  });
});

app.get('/:page', (req, res, next) => {
  const requested = String(req.params.page || '').toLowerCase();
  const fileName = requested.endsWith('.html') ? requested : `${requested}.html`;

  if (USER_PAGES.has(fileName)) {
    return res.sendFile(path.join(USER_SIDE_DIR, fileName), (error) => {
      if (error) next(error);
    });
  }

  if (ADMIN_PAGES.has(fileName)) {
    return res.sendFile(path.join(ADMIN_SIDE_DIR, fileName), (error) => {
      if (error) next(error);
    });
  }

  return next();
});

// ---------------------------------------------------------------------------
// 404 + error handling
// ---------------------------------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API route not found.' });
  }

  res.status(404).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page Not Found | PAULINA Body Art Studio</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#331418;color:#FAF6F0;font-family:Arial,Helvetica,sans-serif;text-align:center;">
  <main style="padding:40px 24px;">
    <p style="margin:0 0 10px;color:#F6D0D6;font-size:12px;letter-spacing:0.24em;text-transform:uppercase;">PAULINA Body Art Studio</p>
    <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-weight:400;font-size:38px;">Page not found</h1>
    <p style="margin:0 0 24px;color:#F6D0D6;">The page you were looking for has moved or no longer exists.</p>
    <a href="/" style="display:inline-block;padding:13px 24px;background:#80151A;color:#FAF6F0;text-decoration:none;border-radius:4px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">Return home</a>
  </main>
</body>
</html>`);
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  // Missing static files (a deleted or replaced gallery upload, for example)
  // reach this handler as 404 errors because those mounts use
  // fallthrough:false. Report them as 404 rather than a 500 server fault.
  const errorStatus = Number(error?.status || error?.statusCode) || 0;
  if (errorStatus === 404) {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ success: false, error: 'Not found.' });
    }
    return res.status(404).type('text').send('Not found');
  }

  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON payload.' });
  }

  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'The booking payload is too large.' });
  }

  console.error('[server] Unhandled error:', error);

  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }

  return res.status(500).type('text').send('Internal server error.');
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
if (require.main === module) {
  const server = app.listen(LISTEN_PORT, () => {
    const email = getEmailConfig();
    const emailStatus = email.configured ? 'configured' : 'NOT configured';

    console.log(`PAULINA booking server: http://localhost:${LISTEN_PORT}`);
    console.log(
      `Email: ${email.provider === 'smtp' ? 'SMTP' : 'Resend'} ${emailStatus} | from ${email.fromEmail} | confirmations go to the customer email`
    );
    if (email.sandboxSender) {
      console.warn(
        'Resend sandbox sender: deliveries are limited to the Resend account owner. ' +
          'Verify a sending domain in Resend or configure SMTP_HOST/SMTP_USER/SMTP_PASS to reach every customer.'
      );
    }
    console.log(`Storage: ${getStorageMode()}`);

    if (email.provider === 'smtp' && email.configured && !email.smtp.passwordFormatValid) {
      console.warn(
        `SMTP_PASS has ${email.smtp.passwordChars} characters. Gmail App Passwords have 16; ` +
          'regenerate one and copy the whole code into .env.'
      );
    }

    if (email.provider === 'smtp' && email.configured && !email.fromEmailMatchesUser) {
      console.warn(
        `Email sender mismatch: SMTP_FROM_EMAIL is ${email.fromEmail} but SMTP_USER is ` +
          `${email.smtp.user}. Gmail rewrites or rejects that From header; set both to the same address.`
      );
    }

    for (const warning of email.senderWarnings || []) {
      console.warn(`Email sender warning: ${warning}`);
    }

    if (email.provider === 'smtp' && email.configured) {
      verifySmtpTransport()
        .then((result) => {
          if (result.status === 'verified') {
            console.log('SMTP credentials verified. Confirmation emails can reach external recipients.');
          } else {
            console.error(`SMTP verification failed (${result.status}): ${result.error}`);
          }
        })
        .catch((error) => {
          console.error('SMTP verification could not run:', error.message);
        });
    }
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received. Closing server...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Vercel imports this file from the project root entrypoint and expects the
// Express app itself; `npm start` keeps using the listen block above.
module.exports = app;

module.exports = app;
