'use strict';
const gmail = require('./gmailProvider');

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Resend } = require('resend');
const nodemailer = require('nodemailer');

/**
 * Brand tokens mirrored from css/header_and_footer.css so transactional email
 * stays visually consistent with the website.
 */
const BRAND = Object.freeze({
  espresso: '#331418',
  ivory: '#FAF6F0',
  wine: '#80151A', 
  blush: '#F6D0D6', 
  bodyText: '#4A3B3C',
  muted: '#7C6A6C',
  border: '#E7DCD3',
  white: '#FFFFFF'
});

const SERIF = "Georgia, 'Times New Roman', 'Book Antiqua', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Courier New', Courier, monospace";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STUDIO_ADDRESS =
  'Paulina Body Art Studio, P3R6+WCW, Ilang-ilang, Novaliches, Caloocan, Metro Manila';
const STUDIO_DIRECTIONS =
  'When arriving, look for the 3J L31 - A Bldg. red building. Our shop is located on the 2nd floor, and the stairs are on the right side. Parking is available on a first-come, first-served basis.';
const STUDIO_MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=Paulina%20Body%20Art%20Studio%2C%20P3R6%2BWCW%2C%20Ilang-ilang%2C%20Novaliches%2C%20Caloocan%2C%20Metro%20Manila%2C%20Philippines';
const STUDIO_PHONE = '0951 741 7630';
const DEFAULT_SUPPORT_EMAIL = 'paulinabodyartstudio@gmail.com';

// Brand logo used in the email header. When EMAIL_LOGO_URL is not configured,
// the PNG is embedded inline (CID) and referenced by the header <img>, so it
// renders inside the template instead of appearing as a downloadable file.
const LOGO_CID = 'paulina-logo';
const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'logos', 'logo_2.png');

// Every rendered message carries one of these. The value is written to the
// X-Email-Template header and logged for each delivery, so a report about an
// outdated template can be traced to the build that produced it.
const BOOKING_TEMPLATE_VERSION = 'booking-confirmation/2026-11-05';
const REQUEST_TEMPLATE_VERSION = 'custom-request/2026-11-05';
const STUDIO_ALERT_TEMPLATE_VERSION = 'studio-alert/2026-11-10';

// The long-running Express process can outlive a .env edit. Keep a signature
// of the file at module load and reload it when it changes, so a credential
// fixed in .env takes effect on the next send instead of only after a restart.
const ENV_PATH = path.join(__dirname, '..', '.env');

function getEnvFileSignature() {
  try {
    const stat = fs.statSync(ENV_PATH);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[email] Could not inspect .env:', error.message);
    }
    return '';
  }
}

let envFileSignature = getEnvFileSignature();

function refreshEnvFromFile() {
  const signature = getEnvFileSignature();
  if (!signature || signature === envFileSignature) return;

  try {
    const parsed = dotenv.parse(fs.readFileSync(ENV_PATH, 'utf8'));
    const mayOverride = process.env.NODE_ENV !== 'production';

    for (const [key, value] of Object.entries(parsed)) {
      // In production, platform-provided variables win over the local file.
      if (mayOverride || !(key in process.env)) {
        process.env[key] = value;
      }
    }

    envFileSignature = signature;
    console.log('[email] Reloaded .env because the file changed.');
  } catch (error) {
    // A partially written file can fail to parse; the next call will retry.
    console.warn('[email] Could not reload .env:', error.message);
  }
}

// Booking payloads arrive from several places: the browser form, the local
// JSON store, Supabase rows (possibly snake_case), and the admin review queue.
// Resolve the same values from every common shape before rendering or sending.
const NESTED_BOOKING_KEYS = [
  'booking',
  'bookingData',
  'appointment',
  'request',
  'details',
  'data',
  'payload',
  'customer',
  'client',
  'contact',
  'recipient'
];

const EMAIL_KEYS = [
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
  'contact_email',
  'to'
];
const REFERENCE_KEYS = [
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
const NAME_KEYS = [
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
const PHONE_KEYS = [
  'phone',
  'phoneNumber',
  'phone_number',
  'contactNumber',
  'contact_number',
  'mobile',
  'mobileNumber',
  'mobile_number'
];
const SERVICE_KEYS = [
  'service',
  'serviceName',
  'service_name',
  'serviceType',
  'service_type',
  'appointmentType',
  'appointment_type'
];
const DATE_KEYS = [
  'date',
  'scheduledDate',
  'scheduled_date',
  'appointmentDate',
  'appointment_date',
  'bookingDate',
  'booking_date'
];
const TIME_KEYS = [
  'time',
  'scheduledTime',
  'scheduled_time',
  'appointmentTime',
  'appointment_time',
  'bookingTime',
  'booking_time',
  'slot'
];
const ARTIST_KEYS = ['artist', 'artistName', 'artist_name', 'assignedArtist', 'assigned_artist'];
const NOTES_KEYS = [
  'notes',
  'note',
  'message',
  'specialRequests',
  'special_requests',
  'customerNotes',
  'customer_notes'
];
const PAYMENT_KEYS = [
  'paymentMethod',
  'payment_method',
  'depositMethod',
  'deposit_method',
  'payment'
];
const TATTOO_STYLE_KEYS = ['tattooStyle', 'tattoo_style', 'style', 'designStyle', 'design_style'];
const TATTOO_SIZE_KEYS = ['tattooSize', 'tattoo_size', 'targetSize', 'target_size', 'size'];
const PLACEMENT_KEYS = [
  'placement',
  'bodyPlacement',
  'body_placement',
  'tattooPlacement',
  'tattoo_placement',
  'location'
];
const CLIENT_REQUEST_KEYS = ['clientRequestId', 'client_request_id'];

function getBookingSources(payload) {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const sources = [];

  const add = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && !sources.includes(value)) {
      sources.push(value);
    }
  };

  // Prefer the root object, then its common nested wrappers. The first match
  // for a field wins, so canonical camelCase values stay authoritative.
  add(root);
  for (const key of NESTED_BOOKING_KEYS) add(root[key]);

  for (const key of ['data', 'payload', 'booking', 'bookingData', 'request', 'appointment']) {
    const wrapper = root[key];
    if (!wrapper || typeof wrapper !== 'object') continue;
    for (const nestedKey of NESTED_BOOKING_KEYS) add(wrapper[nestedKey]);
  }

  return sources;
}

function toText(value) {
  let candidate = value;
  if (Array.isArray(candidate)) candidate = candidate[0];

  if (candidate && typeof candidate === 'object') {
    if ('email' in candidate) return toText(candidate.email);
    if ('address' in candidate) return toText(candidate.address);
    if ('value' in candidate) return toText(candidate.value);
    return '';
  }

  if (typeof candidate !== 'string' && typeof candidate !== 'number') return '';
  return String(candidate).trim();
}

function pickBookingField(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      if (!(key in source)) continue;
      const value = toText(source[key]);
      if (value) return value;
    }
  }
  return '';
}

/**
 * Returns a booking object with canonical camelCase fields filled from every
 * supported alias. Extra properties are preserved so nothing is lost.
 */
function normalizeBookingPayload(input = {}) {
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const sources = getBookingSources(payload);
  const normalized = { ...payload };

  const canonical = {
    email: pickBookingField(sources, EMAIL_KEYS).toLowerCase(),
    reference: pickBookingField(sources, REFERENCE_KEYS),
    fullName: pickBookingField(sources, NAME_KEYS),
    phone: pickBookingField(sources, PHONE_KEYS),
    service: pickBookingField(sources, SERVICE_KEYS),
    serviceType: pickBookingField(sources, ['serviceType', 'service_type']),
    date: pickBookingField(sources, DATE_KEYS),
    time: pickBookingField(sources, TIME_KEYS),
    artist: pickBookingField(sources, ARTIST_KEYS),
    notes: pickBookingField(sources, NOTES_KEYS),
    paymentMethod: pickBookingField(sources, PAYMENT_KEYS),
    tattooStyle: pickBookingField(sources, TATTOO_STYLE_KEYS),
    tattooSize: pickBookingField(sources, TATTOO_SIZE_KEYS),
    placement: pickBookingField(sources, PLACEMENT_KEYS),
    clientRequestId: pickBookingField(sources, CLIENT_REQUEST_KEYS)
  };

  for (const [key, value] of Object.entries(canonical)) {
    if (value) normalized[key] = value;
  }

  return normalized;
}

function resolveRecipientEmail(payload) {
  return normalizeBookingPayload(payload).email || '';
}

let resendClient = null;
let resendClientKey = '';
let smtpTransport = null;
let smtpTransportKey = '';
let smtpVerification = { status: 'unknown', checkedAt: null, error: null };

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Google displays App Passwords in four groups of four characters. Pasting the
 * spaces into .env is common and Gmail rejects the password with them, so strip
 * the decorative spaces only when the value is exactly a 16-character code.
 */
function normalizeSmtpPassword(host, password) {
  const value = String(password || '');
  const compact = value.replace(/\s+/g, '');

  if (/gmail\.com$/i.test(String(host || '')) && /^[a-z0-9]{16}$/i.test(compact)) {
    return compact;
  }

  return value;
}

/** Extracts a bare address from `Name <address>` for provider comparisons. */
function normalizeAddress(address) {
  const raw = String(address || '').trim().toLowerCase();
  const angleBracket = /<([^>]+)>/.exec(raw);
  return angleBracket ? angleBracket[1].trim() : raw;
}

function getSupportEmail() {
  return readEnv('STUDIO_SUPPORT_EMAIL', DEFAULT_SUPPORT_EMAIL);
}

/**
 * Gmail authenticates SMTP_USER and compares the From header against that
 * mailbox. A mismatched SMTP_FROM_EMAIL is either rewritten or rejected, which
 * silently breaks SPF/DKIM alignment, so surface it instead of guessing.
 */
function describeSenderIdentity({ provider, fromEmail, smtp }) {
  const normalizedFrom = String(fromEmail || '').toLowerCase();
  const fromDomain = normalizedFrom.includes('@') ? normalizedFrom.split('@').pop() : '';
  const smtpFromMatchesUser =
    provider !== 'smtp' ||
    String(smtp?.fromEmail || '').toLowerCase() === String(smtp?.user || '').toLowerCase();
  const warnings = [];

  if (provider === 'smtp' && !smtpFromMatchesUser) {
    warnings.push(
      'SMTP_FROM_EMAIL does not match SMTP_USER. Gmail rewrites or rejects that From header, ' +
        'which breaks SPF and DKIM alignment. Set SMTP_FROM_EMAIL to the same address as SMTP_USER.'
    );
  }

  return { fromEmail: normalizedFrom, fromDomain, smtpFromMatchesUser, warnings };
}


function getEmailConfig() {
  refreshEnvFromFile();

  const apiKey = readEnv('RESEND_API_KEY');
  const resendFromEmail = readEnv('RESEND_FROM_EMAIL', 'onboarding@resend.dev');
  const resendFromName = readEnv('RESEND_FROM_NAME', 'PAULINA Body Art Studio');

  const smtpHost = readEnv('SMTP_HOST');
  const smtpPort = Number.parseInt(readEnv('SMTP_PORT', '587'), 10);
  const smtpUser = readEnv('SMTP_USER');
  const smtpPass = normalizeSmtpPassword(smtpHost, readEnv('SMTP_PASS'));
  const smtpFromEmail = readEnv('SMTP_FROM_EMAIL', smtpUser);
  const smtpFromName = readEnv('SMTP_FROM_NAME', resendFromName);
  const smtpConfigured = Boolean(smtpHost && smtpUser && smtpPass);

  const providerPreference = readEnv('EMAIL_PROVIDER', 'auto').toLowerCase();
  const useSmtp =
    providerPreference === 'smtp'
      ? true
      : ['resend', 'gmail'].includes(providerPreference)
        ? false
        : smtpConfigured;

  const useGmail = providerPreference === 'gmail';
  const fromEmail = useGmail ? readEnv('GMAIL_FROM_EMAIL') : useSmtp ? smtpFromEmail : resendFromEmail;
  const fromName = useGmail ? readEnv('GMAIL_FROM_NAME', resendFromName) : useSmtp ? smtpFromName : resendFromName;
  const provider = useGmail ? 'gmail' : useSmtp ? 'smtp' : 'resend';
  const sandboxSender = !useGmail && !useSmtp && resendFromEmail.toLowerCase() === 'onboarding@resend.dev';
  const smtpPasswordChars = smtpPass.replace(/\s+/g, '').length;
  const smtpPasswordFormatValid =
    !/gmail\.com$/i.test(smtpHost) || smtpPasswordChars === 16;
  const smtpReachable =
    smtpVerification.status !== 'authentication-failed' &&
    smtpVerification.status !== 'connection-failed';
  const sender = describeSenderIdentity({
    provider,
    fromEmail,
    smtp: { fromEmail: smtpFromEmail, user: smtpUser }
  });

  return {
    provider,
    providerPreference,
    configured: useGmail ? gmail.configured() : useSmtp ? smtpConfigured : Boolean(apiKey),
    apiKey,
    fromEmail,
    fromName,
    fromEmailMatchesUser: sender.smtpFromMatchesUser,
    senderWarnings: sender.warnings,
    supportEmail: getSupportEmail(),
    mobileNumber: STUDIO_PHONE,
    mapsUrl: STUDIO_MAPS_URL,
    logoUrl: readEnv('EMAIL_LOGO_URL'),
    sandboxSender,
    externalDelivery: useGmail ? gmail.configured() : useSmtp ? smtpConfigured && smtpReachable : !sandboxSender,
    smtp: {
      configured: smtpConfigured,
      host: smtpHost,
      port: Number.isInteger(smtpPort) && smtpPort > 0 ? smtpPort : 587,
      secure: readEnv('SMTP_SECURE', 'false').toLowerCase() === 'true',
      user: smtpUser,
      pass: smtpPass,
      passwordChars: smtpPasswordChars,
      passwordFormatValid: smtpPasswordFormatValid,
      fromEmail: smtpFromEmail,
      fromName: smtpFromName
    }
  };
}

function getResendClient(apiKey) {
  if (!resendClient || resendClientKey !== apiKey) {
    resendClient = new Resend(apiKey);
    resendClientKey = apiKey;
  }
  return resendClient;
}

function getSmtpTransport(smtp) {
  // Include the password in the cache key so editing SMTP_PASS in .env and
  // restarting the dev server cannot keep reusing a rejected credential.
  const key = `${smtp.host}|${smtp.port}|${smtp.secure}|${smtp.user}|${smtp.pass}`;
  if (!smtpTransport || smtpTransportKey !== key) {
    smtpTransport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      },
      // Bound every network phase so a stalled mail server cannot leave an
      // admin decision request hanging forever.
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      tls: { minVersion: 'TLSv1.2' }
    });
    smtpTransportKey = key;
    smtpVerification = { status: 'unknown', checkedAt: null, error: null };
  }
  return smtpTransport;
}


async function verifySmtpTransport() {
  const config = getEmailConfig();

  if (config.provider !== 'smtp' || !config.configured) {
    smtpVerification = { status: 'not-configured', checkedAt: new Date().toISOString(), error: null };
    return { ...smtpVerification };
  }

  try {
    await getSmtpTransport(config.smtp).verify();
    smtpVerification = { status: 'verified', checkedAt: new Date().toISOString(), error: null };
    return { ...smtpVerification };
  } catch (error) {
    const message = error?.message || 'SMTP authentication failed.';
    const authFailed = /535|534|5\.7\.|Username and Password not accepted|Invalid login/i.test(message);
    const friendlyMessage = authFailed
      ? 'Gmail rejected the SMTP credentials. Regenerate the App Password and copy all 16 characters into SMTP_PASS.'
      : message;
    smtpVerification = {
      status: authFailed ? 'authentication-failed' : 'connection-failed',
      checkedAt: new Date().toISOString(),
      error: friendlyMessage
    };
    return { ...smtpVerification };
  }
}

function getSmtpVerification() {
  return { ...smtpVerification };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function escapeMultiline(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function formatDisplayDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'To be confirmed';

  
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoMatch) {
    const date = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
      });
    }
  }

  return raw;
}

function mapServiceLabel(serviceType) {
  switch (String(serviceType || '').trim()) {
    case 'Tattoo':
      return 'Custom Tattoo';
    case 'Piercing':
      return 'Ear Piercing';
    case 'Troubleshooting':
      return 'Troubleshooting';
    default:
      return String(serviceType || '').trim() || 'Studio Appointment';
  }
}

function detailRow(label, value, options = {}) {
  const { last = false, raw = false } = options;
  const border = last ? '0' : `1px solid ${BRAND.border}`;
  const displayValue = raw ? value : escapeHtml(value);

  return `
    <tr class="detail-row">
      <td class="detail-label" width="38%" valign="top" style="padding:14px 14px 14px 0;border-bottom:${border};font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};">${escapeHtml(label)}</td>
      <td class="detail-value" width="62%" align="right" valign="top" style="padding:14px 0;border-bottom:${border};font-family:${SANS};font-size:15px;line-height:1.45;color:${BRAND.espresso};">${displayValue}</td>
    </tr>`;
}

function guidelineRow(number, title, body) {
  return `
    <tr>
      <td width="28" valign="top" style="padding:0 8px 12px 0;font-family:${SANS};font-size:14px;font-weight:700;line-height:1.6;color:${BRAND.wine};">${number}.</td>
      <td valign="top" style="padding:0 0 12px;font-family:${SANS};font-size:14px;line-height:1.6;color:${BRAND.espresso};">
        <strong style="color:${BRAND.espresso};">${escapeHtml(title)}</strong> ${escapeHtml(body)}
      </td>
    </tr>`;
}

function getLogoSource(config) {
  return config.logoUrl || `cid:${LOGO_CID}`;
}

function buildLogoAttachment() {
  try {
    return {
      content: fs.readFileSync(LOGO_PATH),
      contentType: 'image/png',
      contentId: LOGO_CID
    };
  } catch (error) {
    console.warn('[email] Could not read the brand logo:', error.message);
    return null;
  }
}


function buildBookingConfirmationEmail(bookingInput = {}) {
  const booking = normalizeBookingPayload(bookingInput);
  const config = getEmailConfig();
  const reference = String(booking.reference || 'PLN-PENDING').trim();
  const fullName = String(booking.fullName || 'Studio Guest').trim() || 'Studio Guest';
  const firstName = fullName.split(/\s+/)[0];
  const service = String(
    booking.service || mapServiceLabel(booking.serviceType) || 'Studio Appointment'
  ).trim();
  const artist = String(booking.artist || 'Paulina Vampire').trim();
  const date = formatDisplayDate(booking.date || booking.scheduledDate);
  const time = String(booking.time || booking.scheduledTime || 'To be confirmed').trim();
  const schedule = `${date} at ${time}`;
  const paymentMethod = String(booking.paymentMethod || '').trim();
  const supportEmail = config.supportEmail;
  const logoSource = getLogoSource(config);
  const year = new Date().getFullYear();

  const detailRows = [
    [
      'Booking reference',
      `<span style="font-family:${MONO};font-size:16px;font-weight:700;letter-spacing:0.05em;color:${BRAND.wine};">${escapeHtml(reference)}</span>`,
      { raw: true }
    ],
    ['Customer', fullName],
    ['Selected service', service],
    ['Assigned artist', artist],
    ['Scheduled date & time', schedule]
  ];

  if (paymentMethod) {
    detailRows.push(['Deposit', `\u20B1500 via ${paymentMethod}`]);
  }
  if (booking.phone) {
    detailRows.push(['Contact number', booking.phone]);
  }

  const detailsHtml = detailRows
    .map(([label, value, options], index) =>
      detailRow(label, value, {
        ...(options || {}),
        last: index === detailRows.length - 1
      })
    )
    .join('');

  const notesHtml = booking.notes
    ? `
      <tr>
        <td style="padding:22px 0 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.white};border:1px solid ${BRAND.border};border-radius:10px;">
            <tr>
              <td style="padding:18px 20px;">
                <p style="margin:0 0 8px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};">Your notes</p>
                <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.65;color:${BRAND.bodyText};">${escapeMultiline(booking.notes)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : '';

  const subject = `Booking Confirmed \u2014 ${reference} \u00B7 PAULINA Body Art Studio`;
  const preheader = `Your ${service} with ${artist} is booked for ${schedule}. Reference ${reference}.`;

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-card { padding: 28px 20px !important; }
      .email-title { font-size: 26px !important; line-height: 1.2 !important; }
      .email-header { padding-bottom: 20px !important; }
      .detail-label, .detail-value {
        display: block !important;
        width: 100% !important;
        text-align: left !important;
        padding: 0 !important;
        border-bottom: 0 !important;
      }
      .detail-label { padding-top: 12px !important; }
      .detail-value { padding-bottom: 12px !important; border-bottom: 1px solid ${BRAND.border} !important; }
      .detail-row:last-child .detail-value { border-bottom: 0 !important; }
      .email-footer { padding-left: 6px !important; padding-right: 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BRAND.espresso};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.espresso}" style="width:100%;background-color:${BRAND.espresso};">
    <tr>
      <td align="center" style="padding:34px 14px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;">
          <tr>
            <td class="email-header" align="center" style="padding:0 8px 26px;">
              <img src="${logoSource}" width="320" alt="PAULINA BODY ART STUDIO" style="display:block;width:320px;max-width:82%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;color:${BRAND.ivory};font-family:${SERIF};font-size:22px;line-height:1.2;letter-spacing:0.28em;">
              <div style="width:44px;height:2px;margin:18px auto 0;background-color:${BRAND.wine};font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td class="email-card" bgcolor="${BRAND.ivory}" style="padding:38px 34px 34px;background-color:${BRAND.ivory};border-radius:14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 0 18px;">
                    <span style="display:inline-block;padding:8px 14px;background-color:${BRAND.blush};border-radius:999px;font-family:${SANS};font-size:10px;font-weight:700;line-height:1.2;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND.wine};">Booking confirmed</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 16px;">
                    <h1 class="email-title" style="margin:0;font-family:${SERIF};font-size:32px;font-weight:400;line-height:1.25;color:${BRAND.espresso};">Your appointment is confirmed.</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px;">
                    <p style="margin:0 0 14px;font-family:${SANS};font-size:16px;line-height:1.7;color:${BRAND.bodyText};">Hi ${escapeHtml(firstName)},</p>
                    <p style="margin:0;font-family:${SANS};font-size:16px;line-height:1.7;color:${BRAND.bodyText};">Thank you for booking with PAULINA Body Art Studio. Your deposit has been received and your appointment slot is reserved. Here is everything you need for the day:</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 26px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.blush}" style="background-color:${BRAND.blush};border:1px dashed ${BRAND.wine};border-radius:10px;">
                      <tr>
                        <td align="center" style="padding:18px 16px;">
                          <div style="font-family:${SANS};font-size:10px;font-weight:700;line-height:1.4;letter-spacing:0.2em;text-transform:uppercase;color:${BRAND.wine};">Booking reference</div>
                          <div style="margin-top:6px;font-family:${MONO};font-size:24px;font-weight:700;line-height:1.3;letter-spacing:0.08em;color:${BRAND.espresso};">${escapeHtml(reference)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 10px;">
                    <h2 style="margin:0;font-family:${SERIF};font-size:21px;font-weight:400;line-height:1.3;color:${BRAND.espresso};">Appointment details</h2>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${detailsHtml}
                    </table>
                  </td>
                </tr>
                ${notesHtml}
                <tr>
                  <td style="padding:28px 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.blush}" style="background-color:${BRAND.blush};border-left:5px solid ${BRAND.wine};border-radius:10px;">
                      <tr>
                        <td style="padding:22px 24px 14px;">
                          <p style="margin:0 0 14px;font-family:${SANS};font-size:10px;font-weight:700;line-height:1.4;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.wine};">Before your session</p>
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            ${guidelineRow(1, 'Bring a valid government-issued ID.', 'You must be 18 or older for tattoo and piercing services. The name on your ID should match this booking.')}
                            ${guidelineRow(2, 'Eat and hydrate first.', 'Have a full meal and drink plenty of water before arriving. Avoid alcohol, aspirin, and blood thinners for at least 24 hours.')}
                            ${guidelineRow(3, 'Arrive 10\u201315 minutes early.', 'Late arrivals may have their slot released. Please message us ahead of time if you are running late.')}
                            ${guidelineRow(4, 'Dress comfortably.', 'Wear loose clothing that gives easy access to the tattoo or piercing area.')}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 0 0;">
                    <h2 style="margin:0 0 10px;font-family:${SERIF};font-size:21px;font-weight:400;line-height:1.3;color:${BRAND.espresso};">Studio location</h2>
                    <p style="margin:0 0 10px;font-family:${SANS};font-size:15px;line-height:1.65;color:${BRAND.espresso};"><strong style="font-weight:700;">${escapeHtml(STUDIO_ADDRESS)}</strong></p>
                    <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.65;color:${BRAND.bodyText};">${escapeHtml(STUDIO_DIRECTIONS)}</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">
                      <tr>
                        <td align="center" bgcolor="${BRAND.wine}" style="border-radius:4px;">
                          <a href="${STUDIO_MAPS_URL}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:11px;font-weight:700;line-height:1.2;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.ivory};text-decoration:none;">Get directions</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.espresso}" style="background-color:${BRAND.espresso};border-radius:10px;">
                      <tr>
                        <td style="padding:22px 24px;">
                          <p style="margin:0 0 8px;font-family:${SERIF};font-size:19px;font-weight:400;line-height:1.35;color:${BRAND.ivory};">Need to make a change?</p>
                          <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.65;color:${BRAND.ivory};">Email our studio support team at <a href="mailto:${escapeHtml(supportEmail)}" style="color:${BRAND.blush};text-decoration:underline;">${escapeHtml(supportEmail)}</a> at least 48 hours before your appointment. Deposits are non-refundable but may be transferred once with notice.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:26px 0 0;">
                    <p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.65;color:${BRAND.muted};">Please keep your booking reference <strong style="color:${BRAND.wine};">${escapeHtml(reference)}</strong> handy. We can't wait to see you at the studio.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-footer" align="center" style="padding:26px 16px 0;font-family:${SANS};font-size:11px;line-height:1.8;color:${BRAND.blush};">
              <p style="margin:0 0 6px;color:${BRAND.blush};">PAULINA Body Art Studio &middot; Caloocan, Metro Manila</p>
              <p style="margin:0 0 6px;"><a href="mailto:${escapeHtml(supportEmail)}" style="color:${BRAND.blush};text-decoration:none;">${escapeHtml(supportEmail)}</a> &middot; <a href="tel:+639517417630" style="color:${BRAND.blush};text-decoration:none;">${escapeHtml(STUDIO_PHONE)}</a></p>
              <p style="margin:0;color:rgba(246,208,214,0.72);">You received this transactional email because you booked an appointment with us. &copy; ${year} PAULINA Body Art Studio.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    'PAULINA BODY ART STUDIO',
    'A studio for self-expression',
    '',
    `BOOKING CONFIRMED \u2014 ${reference}`,
    '',
    `Hi ${firstName},`,
    '',
    'Thank you for booking with PAULINA Body Art Studio. Your deposit has been received and your appointment slot is reserved.',
    '',
    'APPOINTMENT DETAILS',
    `Booking reference: ${reference}`,
    `Customer: ${fullName}`,
    `Selected service: ${service}`,
    `Assigned artist: ${artist}`,
    `Scheduled date & time: ${schedule}`,
    ...(paymentMethod ? [`Deposit: \u20B1500 via ${paymentMethod}`] : []),
    ...(booking.phone ? [`Contact number: ${booking.phone}`] : []),
    '',
    ...(booking.notes ? ['YOUR NOTES', String(booking.notes).trim(), ''] : []),
    'BEFORE YOUR SESSION',
    '1. Bring a valid government-issued ID. You must be 18 or older for tattoo and piercing services.',
    '2. Eat a full meal and hydrate well before arriving. Avoid alcohol, aspirin, and blood thinners for at least 24 hours.',
    '3. Arrive 10-15 minutes early. Late arrivals may have their slot released.',
    '4. Wear loose, comfortable clothing that gives easy access to the treatment area.',
    '',
    'STUDIO LOCATION',
    STUDIO_ADDRESS,
    STUDIO_DIRECTIONS,
    `Google Maps: ${STUDIO_MAPS_URL}`,
    '',
    'NEED TO MAKE A CHANGE?',
    `Email ${supportEmail} at least 48 hours before your appointment. Deposits are non-refundable but may be transferred once with notice.`,
    '',
    `Keep your booking reference ${reference} handy. We can't wait to see you at the studio.`,
    '',
    `\u00A9 ${year} PAULINA Body Art Studio \u00B7 Caloocan, Metro Manila`
  ].join('\n');

  return { subject, html, text, preheader, reference, version: BOOKING_TEMPLATE_VERSION };
}

/**
 * Builds the accept / decline notification for a custom tattoo request. Both
 * outcomes share the confirmation email's layout so customers receive the same
 * branded look regardless of the studio's decision.
 */
function buildCustomRequestDecisionEmail({
  booking: bookingInput = {},
  decision = 'accept',
  reason = ''
} = {}) {
  const booking = normalizeBookingPayload(bookingInput);
  const config = getEmailConfig();
  const accepted = decision === 'accept';
  const reference = String(booking.reference || 'PLN-PENDING').trim();
  const fullName = String(booking.fullName || 'Studio Guest').trim() || 'Studio Guest';
  const firstName = fullName.split(/\s+/)[0];
  const style = String(booking.tattooStyle || 'Custom Tattoo').trim();
  const isTattooRequest = String(booking.serviceType || 'Tattoo').toLowerCase() === 'tattoo';
  const serviceLabel = String(booking.service || 'Studio Appointment').trim();
  const schedule = `${formatDisplayDate(booking.date)} at ${String(booking.time || 'To be confirmed').trim()}`;
  const artist = String(booking.artist || 'Paulina Vampire').trim();
  const supportEmail = config.supportEmail;
  const logoSource = getLogoSource(config);
  const year = new Date().getFullYear();

  const detailRows = [
    [
      'Booking reference',
      `<span style="font-family:${MONO};font-size:16px;font-weight:700;letter-spacing:0.05em;color:${BRAND.wine};">${escapeHtml(reference)}</span>`,
      { raw: true }
    ]
  ];

  // A piercing or consultation has no tattoo style or placement, so the rows
  // follow the service that was actually booked.
  if (isTattooRequest) {
    detailRows.push(['Tattoo style', style]);
    detailRows.push(['Target size', booking.tattooSize || 'To be confirmed']);
    detailRows.push(['Body placement', booking.placement || 'To be confirmed']);
  } else {
    detailRows.push(['Service', serviceLabel]);
    if (booking.tattooSize) detailRows.push(['Size', booking.tattooSize]);
    if (booking.placement) detailRows.push(['Placement', booking.placement]);
  }

  detailRows.push(['Requested slot', schedule]);

  if (accepted) {
    detailRows.push(['Assigned artist', artist]);
  }
  if (booking.phone) {
    detailRows.push(['Contact number', booking.phone]);
  }

  const detailsHtml = detailRows
    .map(([label, value, options], index) =>
      detailRow(label, value, {
        ...(options || {}),
        last: index === detailRows.length - 1
      })
    )
    .join('');

  const notesHtml = booking.notes
    ? `
      <tr>
        <td style="padding:22px 0 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.white};border:1px solid ${BRAND.border};border-radius:10px;">
            <tr>
              <td style="padding:18px 20px;">
                <p style="margin:0 0 8px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};">Your request notes</p>
                <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.65;color:${BRAND.bodyText};">${escapeMultiline(booking.notes)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : '';

  const reasonHtml = !accepted
    ? `
      <tr>
        <td style="padding:0 0 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.blush}" style="background-color:${BRAND.blush};border:1px solid ${BRAND.wine};border-radius:10px;">
            <tr>
              <td style="padding:18px 20px;">
                <p style="margin:0 0 8px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.wine};">Reason from the studio</p>
                <p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.65;color:${BRAND.bodyText};">${escapeMultiline(reason || 'No reason was provided.')}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : '';

  const nextStepsHtml = accepted
    ? `
      ${guidelineRow(1, 'Confirm your slot.', 'Reply to this email within 48 hours so we can lock in your artist and schedule.')}
      ${guidelineRow(2, 'Send your \u20B1500 deposit.', 'The deposit is deductible from your final bill and reserves your session.')}
      ${guidelineRow(3, 'Prepare your references.', 'Bring your reference images and any inspiration on the day of your session.')}`
    : `
      ${guidelineRow(1, 'Try a different idea.', 'You are welcome to submit a new request for another design or service.')}
      ${guidelineRow(2, 'Ask about alternatives.', 'Reply and we will suggest other services or dates that may work.')}
      ${guidelineRow(3, 'Talk to the studio.', 'Reply to this email and we will help you find the right fit.')}`;

  const badge = accepted ? 'Request accepted' : 'Request declined';
  const subject = accepted
    ? `Request Approved \u2014 ${reference} \u00B7 PAULINA Body Art Studio`
    : `Request Update \u2014 ${reference} \u00B7 PAULINA Body Art Studio`;
  const headline = accepted
    ? 'Your request is approved.'
    : 'An update on your request.';
  const intro = accepted
    ? 'Thank you for booking with us. After reviewing your request, we are happy to move forward with this appointment. Here is what we have on file:'
    : 'Thank you for your interest in the studio. After reviewing your request, we are unable to take on this appointment at this time.';
  const preheader = accepted
    ? `Your request is approved. Reference ${reference}.`
    : `An update on your request. Reference ${reference}.`;

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-card { padding: 28px 20px !important; }
      .email-title { font-size: 26px !important; line-height: 1.2 !important; }
      .email-header { padding-bottom: 20px !important; }
      .detail-label, .detail-value {
        display: block !important;
        width: 100% !important;
        text-align: left !important;
        padding: 0 !important;
        border-bottom: 0 !important;
      }
      .detail-label { padding-top: 12px !important; }
      .detail-value { padding-bottom: 12px !important; border-bottom: 1px solid ${BRAND.border} !important; }
      .detail-row:last-child .detail-value { border-bottom: 0 !important; }
      .email-footer { padding-left: 6px !important; padding-right: 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BRAND.espresso};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.espresso}" style="width:100%;background-color:${BRAND.espresso};">
    <tr>
      <td align="center" style="padding:34px 14px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;">
          <tr>
            <td class="email-header" align="center" style="padding:0 8px 26px;">
              <img src="${logoSource}" width="320" alt="PAULINA BODY ART STUDIO" style="display:block;width:320px;max-width:82%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;color:${BRAND.ivory};font-family:${SERIF};font-size:22px;line-height:1.2;letter-spacing:0.28em;">
              <div style="width:44px;height:2px;margin:18px auto 0;background-color:${BRAND.wine};font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td class="email-card" bgcolor="${BRAND.ivory}" style="padding:38px 34px 34px;background-color:${BRAND.ivory};border-radius:14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 0 18px;">
                    <span style="display:inline-block;padding:8px 14px;background-color:${BRAND.blush};border-radius:999px;font-family:${SANS};font-size:10px;font-weight:700;line-height:1.2;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND.wine};">${badge}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 16px;">
                    <h1 class="email-title" style="margin:0;font-family:${SERIF};font-size:32px;font-weight:400;line-height:1.25;color:${BRAND.espresso};">${headline}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px;">
                    <p style="margin:0 0 14px;font-family:${SANS};font-size:16px;line-height:1.7;color:${BRAND.bodyText};">Hi ${escapeHtml(firstName)},</p>
                    <p style="margin:0;font-family:${SANS};font-size:16px;line-height:1.7;color:${BRAND.bodyText};">${intro}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 26px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.blush}" style="background-color:${BRAND.blush};border:1px dashed ${BRAND.wine};border-radius:10px;">
                      <tr>
                        <td align="center" style="padding:18px 16px;">
                          <div style="font-family:${SANS};font-size:10px;font-weight:700;line-height:1.4;letter-spacing:0.2em;text-transform:uppercase;color:${BRAND.wine};">Request reference</div>
                          <div style="margin-top:6px;font-family:${MONO};font-size:24px;font-weight:700;line-height:1.3;letter-spacing:0.08em;color:${BRAND.espresso};">${escapeHtml(reference)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${reasonHtml}
                <tr>
                  <td style="padding:0 0 10px;">
                    <h2 style="margin:0;font-family:${SERIF};font-size:21px;font-weight:400;line-height:1.3;color:${BRAND.espresso};">Request details</h2>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${detailsHtml}
                    </table>
                  </td>
                </tr>
                ${notesHtml}
                <tr>
                  <td style="padding:28px 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.blush}" style="background-color:${BRAND.blush};border-left:5px solid ${BRAND.wine};border-radius:10px;">
                      <tr>
                        <td style="padding:22px 24px 14px;">
                          <p style="margin:0 0 14px;font-family:${SANS};font-size:10px;font-weight:700;line-height:1.4;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.wine};">${accepted ? 'What happens next' : 'What you can do next'}</p>
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            ${nextStepsHtml}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.espresso}" style="background-color:${BRAND.espresso};border-radius:10px;">
                      <tr>
                        <td style="padding:22px 24px;">
                          <p style="margin:0 0 8px;font-family:${SERIF};font-size:19px;font-weight:400;line-height:1.35;color:${BRAND.ivory};">Questions about this request?</p>
                          <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.65;color:${BRAND.ivory};">Reply to this email or reach our studio team at <a href="mailto:${escapeHtml(supportEmail)}" style="color:${BRAND.blush};text-decoration:underline;">${escapeHtml(supportEmail)}</a>.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:26px 0 0;">
                    <p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.65;color:${BRAND.muted};">Please keep your request reference <strong style="color:${BRAND.wine};">${escapeHtml(reference)}</strong> handy when you contact us.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-footer" align="center" style="padding:26px 16px 0;font-family:${SANS};font-size:11px;line-height:1.8;color:${BRAND.blush};">
              <p style="margin:0 0 6px;color:${BRAND.blush};">PAULINA Body Art Studio &middot; Caloocan, Metro Manila</p>
              <p style="margin:0 0 6px;"><a href="mailto:${escapeHtml(supportEmail)}" style="color:${BRAND.blush};text-decoration:none;">${escapeHtml(supportEmail)}</a> &middot; <a href="tel:+639517417630" style="color:${BRAND.blush};text-decoration:none;">${escapeHtml(STUDIO_PHONE)}</a></p>
              <p style="margin:0;color:rgba(246,208,214,0.72);">You received this email because you submitted a custom tattoo request. &copy; ${year} PAULINA Body Art Studio.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    'PAULINA BODY ART STUDIO',
    'A studio for self-expression',
    '',
    `${accepted ? 'REQUEST APPROVED' : 'REQUEST DECLINED'} \u2014 ${reference}`,
    '',
    `Hi ${firstName},`,
    '',
    intro,
    '',
    ...(accepted ? [] : ['REASON FROM THE STUDIO', String(reason || 'No reason was provided.').trim(), '']),
    'REQUEST DETAILS',
    `Booking reference: ${reference}`,
    ...(isTattooRequest
      ? [
          `Tattoo style: ${style}`,
          `Target size: ${booking.tattooSize || 'To be confirmed'}`,
          `Body placement: ${booking.placement || 'To be confirmed'}`
        ]
      : [
          `Service: ${serviceLabel}`,
          ...(booking.tattooSize ? [`Size: ${booking.tattooSize}`] : []),
          ...(booking.placement ? [`Placement: ${booking.placement}`] : [])
        ]),
    `Requested slot: ${schedule}`,
    ...(accepted ? [`Assigned artist: ${artist}`] : []),
    ...(booking.phone ? [`Contact number: ${booking.phone}`] : []),
    '',
    ...(booking.notes ? ['YOUR REQUEST NOTES', String(booking.notes).trim(), ''] : []),
    accepted ? 'WHAT HAPPENS NEXT' : 'WHAT YOU CAN DO NEXT',
    ...(accepted
      ? [
          '1. Confirm your slot. Reply within 48 hours so we can lock in your artist and schedule.',
          '2. Send your PHP 500 deposit. It is deductible from your final bill.',
          '3. Prepare your references for the day of your session.'
        ]
      : [
          '1. Try a different idea by submitting a new request.',
          '2. Reply to ask about other services or dates.',
          '3. Reply to this email and we will help you find the right fit.'
        ]),
    '',
    'QUESTIONS ABOUT THIS REQUEST?',
    `Reply to this email or contact ${supportEmail}.`,
    '',
    `\u00A9 ${year} PAULINA Body Art Studio \u00B7 Caloocan, Metro Manila`
  ].join('\n');

  return { subject, html, text, preheader, reference, version: REQUEST_TEMPLATE_VERSION };
}

/**
  Sends a booking confirmation to the address the customer entered in the
  booking form.
 
 **/
async function sendBookingConfirmation(bookingInput) {
  const config = getEmailConfig();
  const booking = normalizeBookingPayload(bookingInput);

  if (!config.configured) {
    const error = new Error(
      config.provider === 'gmail'
        ? 'Gmail is not authorized. Run npm run email:authorize.'
        : config.provider === 'smtp'
        ? 'SMTP is not fully configured. Add SMTP_HOST, SMTP_USER, and SMTP_PASS to your .env file.'
        : 'Resend is not configured. Add RESEND_API_KEY to your .env file.'
    );
    error.code = `${config.provider.toUpperCase()}_NOT_CONFIGURED`;
    throw error;
  }

  const recipient = String(booking.email || '').trim().toLowerCase();

  if (!recipient) {
    console.error('[email] Missing recipient address in booking payload:', {
      reference: booking.reference || null,
      keys: bookingInput && typeof bookingInput === 'object' ? Object.keys(bookingInput) : []
    });
    const error = new Error('Recipient email address is missing from booking payload.');
    error.code = 'INVALID_RECIPIENT';
    error.reason = 'MISSING_RECIPIENT';
    throw error;
  }

  if (!EMAIL_PATTERN.test(recipient)) {
    const error = new Error(`The booking recipient email address is invalid: ${recipient}`);
    error.code = 'INVALID_RECIPIENT';
    error.reason = 'INVALID_RECIPIENT';
    error.recipient = recipient;
    throw error;
  }

  const template = buildBookingConfirmationEmail(booking);
  return deliverEmail(config, template, recipient);
}


async function deliverEmail(config, template, recipient) {
  const to = String(recipient || '').trim().toLowerCase();

  // Defense in depth: callers validate the customer address, but never hand an
  // unvalidated string to the mail provider.
  if (!EMAIL_PATTERN.test(to)) {
    const error = new Error('A valid confirmation email recipient is required.');
    error.code = 'INVALID_RECIPIENT';
    throw error;
  }

  const from = `${config.fromName} <${config.fromEmail}>`;
  const logo = config.logoUrl ? null : buildLogoAttachment();
  const templateVersion = template.version || 'unknown';
  const startedAt = Date.now();

  // Machine-generated transactional notices identify themselves so receiving
  // filters do not have to guess, and out-of-office replies are suppressed.
  const headers = {
    'X-Email-Template': templateVersion,
    'Auto-Submitted': 'auto-generated',
    'X-Auto-Response-Suppress': 'OOF, AutoReply'
  };

  if (config.provider === 'gmail') {
    const id = await gmail.send({ from, to, replyTo: config.supportEmail,
      subject: template.subject, html: template.html, text: template.text, headers,
      attachments: logo ? [{ filename: 'paulina-logo.png', content: logo.content,
        contentType: logo.contentType, cid: logo.contentId, contentDisposition: 'inline' }] : []
    });
    return { sent: true, id, recipient: to, from, provider: 'gmail', templateVersion };
  }

  if (config.provider === 'smtp') {
    const attachments = logo
      ? [
          {
            filename: 'paulina-logo.png',
            content: logo.content,
            contentType: logo.contentType,
            cid: logo.contentId,
            contentDisposition: 'inline'
          }
        ]
      : undefined;

    let info;
    try {
      info = await getSmtpTransport(config.smtp).sendMail({
        from,
        to,
        replyTo: config.supportEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        headers,
        ...(attachments ? { attachments } : {})
      });
    } catch (error) {
      const message = error.message || 'SMTP could not send the confirmation email.';
      const authFailed = /535|534|5\.7\.|Username and Password not accepted|Invalid login/i.test(message);
      const sendError = new Error(
        authFailed
          ? 'Gmail rejected the SMTP credentials. Regenerate the App Password and copy all 16 characters into SMTP_PASS.'
          : message
      );
      sendError.code = authFailed ? 'SMTP_AUTH_FAILED' : 'SMTP_SEND_FAILED';
      sendError.provider = 'smtp';
      sendError.recipient = to;
      sendError.cause = error;
      console.error(
        `[email] ${sendError.code} for ${to} via smtp (${templateVersion}): ${sendError.message}`
      );
      throw sendError;
    }

    // Nodemailer resolves when at least one recipient is accepted. A single
    // recipient can therefore still be rejected without sendMail throwing, so
    // inspect accepted/rejected explicitly instead of reporting a false success.
    const accepted = Array.isArray(info?.accepted)
      ? info.accepted.map(normalizeAddress)
      : [];
    const rejected = Array.isArray(info?.rejected)
      ? info.rejected.map(normalizeAddress)
      : [];
    const recipientRejected =
      rejected.includes(to) || (accepted.length > 0 && !accepted.includes(to));

    if (recipientRejected) {
      const response = info?.response || '';
      const sendError = new Error(
        `The mail server rejected ${to}.${response ? ` ${response}` : ''}`
      );
      sendError.code = 'SMTP_RECIPIENT_REJECTED';
      sendError.provider = 'smtp';
      sendError.recipient = to;
      sendError.response = response;
      console.error(
        `[email] ${sendError.code} for ${to} via smtp (${templateVersion}): ${sendError.message}`
      );
      throw sendError;
    }

    const id = info?.messageId || null;
    console.log(
      `[email] sent ${templateVersion} to ${to} via smtp in ${Date.now() - startedAt}ms` +
        (id ? ` (${id})` : '')
    );

    return {
      sent: true,
      id,
      recipient: to,
      from: config.fromEmail,
      provider: 'smtp',
      templateVersion
    };
  }

  let response;
  try {
    response = await getResendClient(config.apiKey).emails.send({
      from,
      to: [to],
      replyTo: config.supportEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      headers,
      ...(logo
        ? {
            attachments: [
              {
                filename: 'paulina-logo.png',
                content: logo.content.toString('base64'),
                content_id: logo.contentId
              }
            ]
          }
        : {})
    });
  } catch (error) {
    const message = error?.message || 'Resend could not send the confirmation email.';
    const sendError = new Error(message);
    sendError.code = 'RESEND_SEND_FAILED';
    sendError.providerCode = error?.code || error?.name || null;
    sendError.provider = 'resend';
    sendError.recipient = to;
    sendError.cause = error;
    console.error(
      `[email] ${sendError.code} for ${to} via resend (${templateVersion}): ${sendError.message}`
    );
    throw sendError;
  }

  const { data, error } = response || {};

  if (error) {
    const message = error.message || 'Resend could not send the confirmation email.';
    const recipientRejected =
      /testing email|own email address|verify a domain|domains like|not verified|invalid `to` field/i.test(
        message
      );
    const sendError = new Error(
      recipientRejected
        ? `Resend rejected ${to}: ${message}`
        : message
    );
    sendError.code = recipientRejected ? 'RESEND_RECIPIENT_REJECTED' : error.name || 'RESEND_SEND_FAILED';
    sendError.statusCode = error.statusCode || null;
    sendError.provider = 'resend';
    sendError.recipient = to;
    sendError.cause = error;
    console.error(
      `[email] ${sendError.code} for ${to} via resend (${templateVersion}): ${sendError.message}`
    );
    throw sendError;
  }

  const id = data?.id || null;
  console.log(
    `[email] sent ${templateVersion} to ${to} via resend in ${Date.now() - startedAt}ms` +
      (id ? ` (${id})` : '')
  );

  return {
    sent: true,
    id,
    recipient: to,
    from: config.fromEmail,
    provider: 'resend',
    templateVersion
  };
}


/**
 * Internal alert for the studio inbox. It is deliberately plain: its only job is
 * to tell the team that something new came in, with the booking reference so the
 * dashboard can be opened straight away.
 */
function buildStudioAlertEmail({
  type = 'booking',
  title = 'New booking request',
  message = '',
  reference = '',
  customerName = '',
  details = []
} = {}) {
  const config = getEmailConfig();
  const logoSource = getLogoSource(config);
  const year = new Date().getFullYear();
  const isReview = type === 'review';
  const subject = `${isReview ? 'New review' : 'New booking'}${reference ? ` \u2014 ${reference}` : ''} \u00B7 PAULINA Body Art Studio`;
  const rows = [
    ['Booking reference', reference],
    [isReview ? 'Reviewer' : 'Customer', customerName],
    ...details
  ].filter(([, value]) => String(value || '').trim());

  const detailRowsHtml = rows
    .map(
      ([label, value]) => `
              <tr>
                <td style="padding:8px 0;font-family:${SANS};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};width:150px;vertical-align:top;">${escapeHtml(label)}</td>
                <td style="padding:8px 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${BRAND.bodyText};">${escapeMultiline(String(value))}</td>
              </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.espresso};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${BRAND.espresso};">
    <tr>
      <td align="center" style="padding:32px 14px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
          <tr>
            <td align="center" style="padding:0 8px 22px;">
              <img src="${logoSource}" width="260" alt="PAULINA BODY ART STUDIO" style="display:block;width:260px;max-width:80%;height:auto;margin:0 auto;border:0;">
            </td>
          </tr>
          <tr>
            <td bgcolor="${BRAND.ivory}" style="padding:32px 30px;background-color:${BRAND.ivory};border-radius:14px;">
              <p style="margin:0 0 10px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.wine};">${isReview ? 'New review posted' : 'New booking received'}</p>
              <h1 style="margin:0 0 14px;font-family:${SERIF};font-size:24px;line-height:1.3;font-weight:400;color:${BRAND.espresso};">${escapeHtml(title)}</h1>
              ${message ? `<p style="margin:0 0 22px;font-family:${SANS};font-size:14px;line-height:1.7;color:${BRAND.bodyText};">${escapeMultiline(message)}</p>` : ''}
              ${detailRowsHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BRAND.border};">${detailRowsHtml}</table>` : ''}
              <p style="margin:24px 0 0;font-family:${SANS};font-size:13px;line-height:1.7;color:${BRAND.muted};">Open the admin dashboard to review it. New requests wait in the Booking page until someone accepts or declines them.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 8px 0;font-family:${SANS};font-size:11px;line-height:1.7;color:rgba(250,246,240,0.6);">
              PAULINA Body Art Studio \u00B7 ${escapeHtml(config.supportEmail)}<br>&copy; ${year} All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [title, message, ...rows.map(([label, value]) => `${label}: ${value}`)]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text, version: STUDIO_ALERT_TEMPLATE_VERSION };
}

/**
 * Sends the internal alert to the studio inbox. Every notification starts with
 * this email, so a failed delivery is reported back to the caller instead of
 * being silently swallowed.
 */
async function sendStudioNotification(notification = {}) {
  const config = getEmailConfig();

  if (!config.configured) {
    const error = new Error(
      config.provider === 'gmail'
        ? 'Gmail is not authorized. Run npm run email:authorize.'
        : config.provider === 'smtp'
        ? 'SMTP is not fully configured. Add SMTP_HOST, SMTP_USER, and SMTP_PASS to your .env file.'
        : 'Resend is not configured. Add RESEND_API_KEY to your .env file.'
    );
    error.code = `${config.provider.toUpperCase()}_NOT_CONFIGURED`;
    throw error;
  }

  const template = buildStudioAlertEmail(notification);
  return deliverEmail(config, template, getSupportEmail());
}

async function sendCustomRequestDecision({ booking: bookingInput, decision, reason = '' } = {}) {
  const config = getEmailConfig();
  const booking = normalizeBookingPayload(bookingInput);

  if (!config.configured) {
    const error = new Error(
      config.provider === 'gmail'
        ? 'Gmail is not authorized. Run npm run email:authorize.'
        : config.provider === 'smtp'
        ? 'SMTP is not fully configured. Add SMTP_HOST, SMTP_USER, and SMTP_PASS to your .env file.'
        : 'Resend is not configured. Add RESEND_API_KEY to your .env file.'
    );
    error.code = `${config.provider.toUpperCase()}_NOT_CONFIGURED`;
    throw error;
  }

  const recipient = String(booking.email || '').trim().toLowerCase();

  if (!recipient) {
    console.error('[email] Missing recipient address in request payload:', {
      reference: booking.reference || null,
      keys: bookingInput && typeof bookingInput === 'object' ? Object.keys(bookingInput) : []
    });
    const error = new Error('Recipient email address is missing from request payload.');
    error.code = 'INVALID_RECIPIENT';
    error.reason = 'MISSING_RECIPIENT';
    throw error;
  }

  if (!EMAIL_PATTERN.test(recipient)) {
    const error = new Error(`The request recipient email address is invalid: ${recipient}`);
    error.code = 'INVALID_RECIPIENT';
    error.reason = 'INVALID_RECIPIENT';
    error.recipient = recipient;
    throw error;
  }

  const template = buildCustomRequestDecisionEmail({ booking, decision, reason });
  return deliverEmail(config, template, recipient);
}

module.exports = {
  BOOKING_TEMPLATE_VERSION,
  BRAND,
  REQUEST_TEMPLATE_VERSION,
  buildBookingConfirmationEmail,
  buildCustomRequestDecisionEmail,
  buildStudioAlertEmail,
  getEmailConfig,
  getSmtpVerification,
  normalizeBookingPayload,
  resolveRecipientEmail,
  sendBookingConfirmation,
  sendCustomRequestDecision,
  sendStudioNotification,
  verifySmtpTransport
};
