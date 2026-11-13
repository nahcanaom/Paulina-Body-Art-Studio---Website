/* ==========================================================================
   PAULINA BODY ART STUDIO — ADMIN DASHBOARD ENGINE
   --------------------------------------------------------------------------
   Data source: GET /api/bookings — the same accepted appointment records that
   feed the Master Calendar. Pending requests and cancelled bookings are
   excluded, exactly like the calendar.

   Responsibilities:
     - Compute Bookings, Deposits collected and No-show rate from live records.
     - Keep Revenue manually editable by the admin (stored per month).
     - Refresh every trend capsule against the previous month.
     - Populate the bookings feed and the full upcoming-appointments list.
     - Draw the six-month booking insights chart with hover tooltips along the
       line and deep links into the Master Calendar.
       ========================================================================== */



// admin-app.js – Front‑end logic for the admin dashboard
// ----------------------------------------------------
// This module imports the Supabase client that you configured in
// `supabase-config.js` and populates the KPI cards, bookings feed,
// upcoming‑appointments list, etc.
//
// NOTE: The HTML expects elements with IDs like `kpiBookings`, `kpiRevenue`,
// `bookingsFeedBody`, `appointmentsList`, etc. – those already exist in
// `dashboard.html`.
import { supabase } from "./supabase-config.js";
async function loadKPIs() {
  // Example: count bookings, sum revenue, count deposits
  const [{ count: bookings }, { sum: revenue }, { count: deposits }] = await Promise.all([
    supabase.from("bookings").select("id", { count: "exact", head: true }),
    supabase
      .from("bookings")
      .select("total_price")
      .then(r => ({ sum: r.data?.reduce((a, b) => a + Number(b.total_price || 0), 0) || 0 })),
    supabase.from("payments").select("id", { count: "exact", head: true })
  ]);
  document.getElementById("kpiBookings").textContent = bookings ?? "0";
  document.getElementById("kpiRevenue").value = `P${revenue ?? 0}`;
  document.getElementById("kpiDeposits").textContent = `P${revenue ?? 0}`;
}
async function loadBookingsFeed(filter = "All") {
  const query = supabase
    .from("bookings")
    .select("client_name, service_type, appointment_dt, status")
    .order("appointment_dt", { ascending: false });
  if (filter !== "All") query.eq("service_type", filter);
  const { data, error } = await query;
  const tbody = document.getElementById("bookingsFeedBody");
  tbody.innerHTML = "";
  if (error) {
    console.error("Failed to load bookings feed:", error);
    tbody.innerHTML = `<tr><td colspan="4">Error loading bookings.</td></tr>`;
    return;
  }
  data.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.client_name}</td>
      <td>${row.service_type}</td>
      <td>${new Date(row.appointment_dt).toLocaleString()}</td>
      <td>${row.status}</td>`;
    tbody.appendChild(tr);
  });
}
async function loadUpcomingAppointments() {
  const { data, error } = await supabase
    .from("bookings")
    .select("client_name, appointment_dt")
    .gt("appointment_dt", new Date().toISOString())
    .order("appointment_dt", { ascending: true })
    .limit(5);
  const list = document.getElementById("appointmentsList");
  list.innerHTML = "";
  if (error) {
    console.error("Failed to load upcoming appointments:", error);
    list.innerHTML = `<li>Error loading appointments.</li>`;
    return;
  }
  data.forEach(row => {
    const li = document.createElement("li");
    li.textContent = `${row.client_name} – ${new Date(row.appointment_dt).toLocaleString()}`;
    list.appendChild(li);
  });
}
/* ------------------------------------------------------------------ */
/* Initialize dashboard when the page loads                               */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadKPIs();
    await loadBookingsFeed();
    await loadUpcomingAppointments();
    // Hook up filter dropdown
    const filterSelect = document.getElementById("feedFilterSelect");
    filterSelect?.addEventListener("change", e => loadBookingsFeed(e.target.value));
  } catch (e) {
    console.error("Dashboard init error:", e);
  }
});       








'use strict';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The Master Calendar treats these as real appointments. Pending requests and
// cancelled records never reach the dashboard.
const CALENDAR_STATUSES = new Set(['confirmed', 'completed', 'late', 'noshow']);

const STATUS_LABELS = {
  confirmed: 'Confirmed',
  completed: 'Completed',
  late: 'Late arrival',
  noshow: 'No-show',
  cancelled: 'Cancelled',
  pending: 'Pending'
};

const STATUS_CLASSES = {
  confirmed: 'status-confirmed',
  completed: 'status-completed',
  late: 'status-late',
  noshow: 'status-noshow',
  cancelled: 'status-cancelled',
  pending: 'status-pending'
};

const REVENUE_STORAGE_PREFIX = 'paulina.dashboard.revenue';
const REFRESH_INTERVAL_MS = 30000;
const SERIF_FONT = "'FootlightMTPro', 'TAN-Pearl', 'Times New Roman', serif";

const numberFormatter = new Intl.NumberFormat('en-PH');
const percentFormatter = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 });

const dashboardState = {
  bookings: [],
  referenceDate: new Date(),
  selectedService: 'All',
  manualRevenue: 0,
  revenueMonthKey: null,
  isLoading: false,
  refreshPending: false,
  loadError: null,
  chart: {
    labels: [],
    values: [],
    deposits: [],
    noShows: [],
    year: new Date().getFullYear(),
    periodLabel: ''
  }
};

let chartInstance = null;
let refreshTimer = null;
let realtimeRefreshTimer = null;
let toastTimer = null;

/* ==========================================================================
   BOOT
   ========================================================================== */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  setupEventListeners();
  setupAppointmentMenuEvents();
  initChart();
  renderDashboard();
  loadRevenueFromSupabase();
  refreshBookings();
  startAutoRefresh();
}

/* ==========================================================================
   DATA LOADING — shared with the Master Calendar
   ========================================================================== */
function apiUrl(path) {
  if (typeof window !== 'undefined' && typeof window.paulinaApiUrl === 'function') {
    return window.paulinaApiUrl(path);
  }
  return path;
}

async function refreshBookings() {
  // A realtime event can arrive mid-request; remember it and run once more so
  // the feed never misses the booking that triggered it.
  if (dashboardState.isLoading) {
    dashboardState.refreshPending = true;
    return;
  }
  dashboardState.isLoading = true;

  try {
    const response = await fetch(apiUrl('/api/bookings'), {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Bookings request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload?.bookings;

    if (!Array.isArray(rows)) {
      throw new Error('Unexpected bookings response shape');
    }

    dashboardState.bookings = rows
      .map(normalizeBooking)
      .filter(isCalendarBooking);

    dashboardState.loadError = null;
  } catch (error) {
    // Keep the last successful snapshot on screen. On first load the empty
    // states explain that the calendar service could not be reached.
    console.warn('[dashboard] Could not load bookings from the Master Calendar API:', error);
    dashboardState.loadError = error;
  } finally {
    dashboardState.isLoading = false;
  }

  renderDashboard();

  if (dashboardState.refreshPending) {
    dashboardState.refreshPending = false;
    refreshBookings();
  }
}

function startAutoRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);

  // The polling timer stays as a safety net; the stream below makes the feed
  // update the moment a booking is created or its status changes.
  refreshTimer = window.setInterval(() => {
    if (!document.hidden) refreshBookings();
  }, REFRESH_INTERVAL_MS);

  initBookingsRealtime();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshBookings();
  });

  window.addEventListener('focus', refreshBookings);
  window.addEventListener('pageshow', refreshBookings);

  // Lets another admin tab refresh this dashboard after a revenue edit.
  window.addEventListener('storage', (event) => {
    if (event.key && event.key.startsWith(REVENUE_STORAGE_PREFIX)) {
      dashboardState.revenueMonthKey = null;
      renderDashboard();
    }
  });
}

/**
 * Server-sent events: the server announces every new or updated booking, so
 * the feed reflects a confirmed appointment without waiting for the poll.
 * EventSource reconnects on its own; the 30s timer covers older browsers and
 * a dropped stream.
 */
function initBookingsRealtime() {
  if (typeof window !== 'undefined' && window.paulinaSupabase) {
    try {
      window.paulinaSupabase
        .channel('dashboard-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
          window.clearTimeout(realtimeRefreshTimer);
          realtimeRefreshTimer = window.setTimeout(refreshBookings, 250);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, () => {
          loadRevenueFromSupabase();
        })
        .subscribe();
    } catch (err) {
      console.warn('[dashboard] Supabase realtime subscription notice:', err);
    }
  }

  if (typeof EventSource !== 'function') return;

  try {
    const source = new EventSource(apiUrl('/api/bookings/stream'));

    source.addEventListener('bookings_change', () => {
      // Refresh even when the tab sits in the background: events are rare and
      // the feed is already current when the admin comes back to it.
      window.clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = window.setTimeout(refreshBookings, 250);
    });

    source.onerror = () => {
      // EventSource reconnects automatically.
    };
  } catch (error) {
    console.warn('[dashboard] Booking stream unavailable, relying on polling:', error);
  }
}

/* ==========================================================================
   NORMALISATION & FORMATTING
   ========================================================================== */
function normalizeStatus(value) {
  const status = String(value || '').toLowerCase().replace(/[\s-_]/g, '');

  if (!status) return 'confirmed';
  if (status.includes('noshow')) return 'noshow';
  if (status.includes('late')) return 'late';
  if (status.includes('complete')) return 'completed';
  if (status.includes('cancel')) return 'cancelled';
  if (status.includes('pending')) return 'pending';
  if (status.includes('confirm')) return 'confirmed';
  return status;
}

function isCalendarBooking(booking) {
  return Boolean(booking && booking.dateObj && CALENDAR_STATUSES.has(booking.status));
}

function normalizeServiceType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('piercing')) return 'Piercing';
  if (text.includes('troubleshoot') || text.includes('consult')) return 'Troubleshooting';
  return 'Tattoo';
}

function normalizeBooking(raw, index) {
  const dateObj = parseBookingDate(raw.date || raw.appointmentDate || raw.scheduledDate);
  const reference = String(raw.reference || raw.id || '').trim();
  const fullName = String(raw.fullName || raw.client || raw.name || 'Client').trim();
  const status = normalizeStatus(raw.status);
  const start = raw.time || raw.scheduledTime || '';
  const end = raw.endTime || raw.end_time || addMinutesToTime(start, parseDurationMinutes(raw.duration));

  return {
    id: reference || `dashboard-booking-${index}`,
    reference,
    clientName: fullName,
    clientFirstName: firstName(fullName),
    serviceType: normalizeServiceType(raw.serviceType || raw.service),
    service: String(raw.service || raw.serviceType || 'Appointment').trim(),
    artist: String(raw.artist || '').trim(),
    dateObj,
    dateLabel: dateObj ? formatDateLabel(dateObj) : String(raw.date || '').trim(),
    timeLabel: formatTimeRange(start, end),
    time: start,
    // When the request was submitted; the feed is ordered by this so the
    // newest booking always sits at the top.
    createdAt: String(raw.createdAt || raw.created_at || '').trim(),
    createdTime: parseTimestamp(raw.createdAt || raw.created_at),
    status,
    deposit: parseMoney(raw.deposit || raw.depositAmount || raw.deposit_amount || raw.downpayment || raw.downPayment),
    raw
  };
}

function parseTimestamp(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return 0;
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : 0;
}

function firstName(name) {
  const text = String(name || '').trim();
  return text ? text.split(/\s+/)[0] : 'Client';
}

/**
 * Accepts ISO timestamps, ISO dates and the display formats used across the
 * admin pages ("November 18, 2026", "Fri, sept 18", "Mon, 28 Sept").
 */
function parseBookingDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value == null ? '' : value).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return date.getMonth() === Number(iso[2]) - 1 && date.getDate() === Number(iso[3]) ? date : null;
  }

  const monthLookup = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  let month = -1;
  for (const word of text.toLowerCase().match(/[a-z]+/g) || []) {
    if (Object.prototype.hasOwnProperty.call(monthLookup, word)) {
      month = monthLookup[word];
      break;
    }
  }
  if (month < 0) return null;

  const dayMatch = text.match(/(?:^|[^\d])([0-3]?\d)(?:st|nd|rd|th)?(?![\d])/);
  if (!dayMatch) return null;

  const day = Number(dayMatch[1]);
  if (day < 1 || day > 31) return null;

  const yearMatch = text.match(/\b(?:19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear();
  const date = new Date(year, month, day);

  return date.getMonth() === month ? date : null;
}

function parseTimeParts(timeStr) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(timeStr || '').trim());
  if (!match) return null;

  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const suffix = match[3] ? match[3].toUpperCase() : null;

  if (suffix === 'PM' && hour < 12) hour += 12;
  if (suffix === 'AM' && hour === 12) hour = 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return { hour, minute };
}

function formatClock(parts, includeSuffix = true) {
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const suffix = parts.hour >= 12 ? 'PM' : 'AM';
  return `${hour12}:${String(parts.minute).padStart(2, '0')}${includeSuffix ? ` ${suffix}` : ''}`;
}

function formatTimeRange(start, end) {
  const startParts = parseTimeParts(start);
  if (!startParts) return String(start || '').trim();

  const endParts = parseTimeParts(end);
  if (!endParts) return formatClock(startParts);

  const sameMeridiem = (startParts.hour >= 12) === (endParts.hour >= 12);
  return sameMeridiem
    ? `${formatClock(startParts, false)} - ${formatClock(endParts)}`
    : `${formatClock(startParts)} - ${formatClock(endParts)}`;
}

function parseDurationMinutes(value) {
  const match = /(\d+(?:\.\d+)?)\s*(hour|hr|minute|min)/i.exec(String(value || ''));
  if (!match) return 0;

  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return 0;
  return /hour|hr/i.test(match[2]) ? Math.round(amount * 60) : Math.round(amount);
}

function addMinutesToTime(timeStr, minutes) {
  const parts = parseTimeParts(timeStr);
  if (!parts || !minutes) return '';

  const total = (parts.hour * 60 + parts.minute + minutes) % (24 * 60);
  return formatClock({
    hour: Math.floor(total / 60),
    minute: total % 60
  });
}

function timeValue(timeStr) {
  const parts = parseTimeParts(timeStr);
  return parts ? parts.hour * 60 + parts.minute : Number.MAX_SAFE_INTEGER;
}

function formatDateLabel(date) {
  const yearPart = date.getFullYear() === new Date().getFullYear() ? '' : `, ${date.getFullYear()}`;
  return `${DAY_SHORT[date.getDay()]}, ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}${yearPart}`;
}

function dayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseMoney(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;

  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function formatCurrency(value) {
  return `P${numberFormatter.format(Math.round(Number(value) || 0))}`;
}

function formatNumber(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

/**
 * Dashboard percentages are shares of a whole, so they are held to a 0–100
 * scale. Missing, non-finite or out-of-range input snaps back into the valid
 * range instead of rendering values such as "\u221e%" or "-5%".
 */
function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

/** Percent changes keep their sign but can never leave the -100%–100% band. */
function clampPercentChange(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(-100, numeric));
}

function formatPercentValue(value) {
  return percentFormatter.format(clampPercent(value));
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

/* ==========================================================================
   REVENUE — live synced with Supabase site_settings, stored per month
   ========================================================================== */
let revenueCache = {};

function revenueStorageKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function loadRevenueFromSupabase() {
  try {
    if (window.paulinaSupabase) {
      const { data } = await window.paulinaSupabase
        .from('site_settings')
        .select('value')
        .eq('key', 'admin_revenue')
        .maybeSingle();

      if (data?.value?.monthly && typeof data.value.monthly === 'object') {
        revenueCache = { ...data.value.monthly };
        const currentKey = dashboardState.revenueMonthKey || revenueStorageKey(new Date());
        if (revenueCache[currentKey] !== undefined) {
          dashboardState.manualRevenue = parseMoney(revenueCache[currentKey]);
          const metrics = computeDashboardMetrics(dashboardState.bookings, new Date());
          renderKPIs(metrics);
        }
      }
    }
  } catch (err) {
    console.warn('[dashboard] Could not load revenue from Supabase:', err);
  }
}

function readStoredRevenue(key) {
  if (revenueCache && revenueCache[key] !== undefined) {
    return parseMoney(revenueCache[key]);
  }
  return 0;
}

async function writeStoredRevenue(key, value) {
  revenueCache[key] = value;
  try {
    if (window.paulinaSupabase) {
      const { data } = await window.paulinaSupabase
        .from('site_settings')
        .select('value')
        .eq('key', 'admin_revenue')
        .maybeSingle();

      const current = data?.value || { monthly: {} };
      const monthly = { ...(current.monthly || {}), [key]: value };

      await window.paulinaSupabase.from('site_settings').upsert({
        key: 'admin_revenue',
        value: { ...current, monthly },
        updated_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.warn('[dashboard] Could not persist revenue to Supabase:', err);
  }
}

function syncRevenueMonth(date) {
  const key = revenueStorageKey(date);
  if (key === dashboardState.revenueMonthKey) return;

  dashboardState.revenueMonthKey = key;
  dashboardState.manualRevenue = readStoredRevenue(key);
}

function commitRevenue() {
  const input = document.getElementById('kpiRevenue');
  if (!input) return;

  const value = Math.max(0, Math.round(parseMoney(input.value)));
  dashboardState.manualRevenue = value;
  writeStoredRevenue(dashboardState.revenueMonthKey || revenueStorageKey(new Date()), value);
  input.value = formatCurrency(value);

  // Only the KPI strip is redrawn so a focused input never rebuilds the feed
  // or the appointment list underneath the admin's pointer.
  const metrics = computeDashboardMetrics(dashboardState.bookings, new Date());
  renderKPIs(metrics);
}

/* ==========================================================================
   METRICS
   ========================================================================== */
function computeMonthMetrics(bookings, year, month) {
  const monthBookings = bookings.filter((booking) => (
    booking.dateObj &&
    booking.dateObj.getFullYear() === year &&
    booking.dateObj.getMonth() === month
  ));

  const total = monthBookings.length;
  const noShows = monthBookings.filter((booking) => booking.status === 'noshow').length;
  const deposits = monthBookings.reduce((sum, booking) => sum + (booking.deposit || 0), 0);

  // The Deposits Collected KPI counts confirmed appointments at the standard
  // ₱500 reservation deposit. The chart keeps using the real saved deposit
  // amounts (`deposits` above), so only this card's figure changes.
  const confirmed = monthBookings.filter((booking) => booking.status === 'confirmed').length;
  const confirmedDeposits = confirmed * 500;

  return {
    total,
    noShows,
    deposits,
    confirmed,
    confirmedDeposits,
    // A share of the month's bookings, so it can never sit outside 0–100%.
    noShowRate: total ? clampPercent((noShows / total) * 100) : 0
  };
}

function percentChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return clampPercentChange(((current - previous) / previous) * 100);
}

function formatTrendValue(change) {
  // The pill shows the magnitude only; the trend icon already carries the sign.
  const rounded = Math.round(clampPercent(Math.abs(change)) * 100) / 100;
  return `${rounded}%`;
}

/**
 * Builds the chart window. Current month July or later -> July through
 * December. Before July -> January through June.
 */
function buildChartWindow(reference, bookings) {
  const now = reference instanceof Date ? reference : new Date();
  const startMonth = now.getMonth() >= 6 ? 6 : 0;
  const year = now.getFullYear();
  const labels = MONTH_SHORT.slice(startMonth, startMonth + 6);

  const values = [];
  const deposits = [];
  const noShows = [];

  labels.forEach((label, index) => {
    const monthBookings = bookings.filter((booking) => (
      booking.dateObj &&
      booking.dateObj.getFullYear() === year &&
      booking.dateObj.getMonth() === startMonth + index
    ));

    values.push(monthBookings.length);
    deposits.push(monthBookings.reduce((sum, booking) => sum + (booking.deposit || 0), 0));
    noShows.push(monthBookings.filter((booking) => booking.status === 'noshow').length);
  });

  return {
    labels,
    values,
    deposits,
    noShows,
    year,
    startMonth,
    periodLabel: `${MONTH_NAMES[startMonth]} – ${MONTH_NAMES[startMonth + 5]} ${year}`
  };
}

function computeDashboardMetrics(bookings, reference) {
  const now = reference instanceof Date ? reference : new Date();
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const current = computeMonthMetrics(bookings, now.getFullYear(), now.getMonth());
  const previous = computeMonthMetrics(bookings, previousDate.getFullYear(), previousDate.getMonth());

  const currentRevenue = dashboardState.manualRevenue;
  const previousRevenue = readStoredRevenue(revenueStorageKey(previousDate));

  return {
    current: { ...current, revenue: currentRevenue },
    previous: { ...previous, revenue: previousRevenue },
    previousLabel: `${MONTH_SHORT[previousDate.getMonth()]} ${previousDate.getFullYear()}`,
    trends: {
      bookings: percentChange(current.total, previous.total),
      revenue: percentChange(currentRevenue, previousRevenue),
      deposits: percentChange(current.confirmedDeposits, previous.confirmedDeposits),
      noShowRate: percentChange(current.noShowRate, previous.noShowRate)
    },
    chart: buildChartWindow(now, bookings)
  };
}

/* ==========================================================================
   RENDERING
   ========================================================================== */
function renderDashboard() {
  const reference = new Date();
  dashboardState.referenceDate = reference;
  syncRevenueMonth(reference);

  const metrics = computeDashboardMetrics(dashboardState.bookings, reference);

  renderKPIs(metrics);
  renderFilterOptions();
  renderFeedTable();
  renderUpcomingAppointments();
  renderChart(metrics);
}

function renderKPIs(metrics) {
  setText('kpiBookings', formatNumber(metrics.current.total));

  const revenueInput = document.getElementById('kpiRevenue');
  if (revenueInput && document.activeElement !== revenueInput) {
    revenueInput.value = formatCurrency(metrics.current.revenue);
  }

  setText('kpiDeposits', formatCurrency(metrics.current.confirmedDeposits));

  const noShowEl = document.getElementById('kpiNoShow');
  if (noShowEl) {
    noShowEl.innerHTML = `<span class="kpi-value-couture">${formatPercentValue(metrics.current.noShowRate)}</span>%`;
  }

  updateTrend('bookings', metrics.trends.bookings, metrics.previousLabel, metrics.previous.total, metrics.current.total, formatNumber);
  updateTrend('revenue', metrics.trends.revenue, metrics.previousLabel, metrics.previous.revenue, metrics.current.revenue, formatCurrency);
  updateTrend('deposits', metrics.trends.deposits, metrics.previousLabel, metrics.previous.confirmedDeposits, metrics.current.confirmedDeposits, formatCurrency);
  updateTrend('noShow', metrics.trends.noShowRate, metrics.previousLabel, metrics.previous.noShowRate, metrics.current.noShowRate, (value) => `${formatPercentValue(value)}%`);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function updateTrend(kpiId, change, previousLabel, previousValue, currentValue, formatter) {
  const card = document.querySelector(`.kpi-card[data-kpi="${kpiId}"]`);
  if (!card) return;

  const pill = card.querySelector('.trend-pill');
  const icon = pill ? pill.querySelector('i') : null;
  const valueEl = pill ? pill.querySelector('span') : null;
  const note = card.querySelector('.trend-note');

  if (!pill || !icon || !valueEl || !note) return;

  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  icon.className = direction === 'flat' ? 'ph ph-minus' : `ph ph-trend-${direction}`;
  valueEl.textContent = formatTrendValue(change);
  note.textContent = `vs ${previousLabel}`;

  const previousText = formatter(previousValue);
  const currentText = formatter(currentValue);
  const directionLabel = direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'No change';

  pill.title = `${currentText} this month vs ${previousText} in ${previousLabel}`;
  pill.setAttribute('aria-label', `${directionLabel} ${formatTrendValue(change)} versus ${previousLabel}`);
}

function renderFilterOptions() {
  const select = document.getElementById('feedFilterSelect');
  if (!select) return;

  const previous = dashboardState.selectedService || 'All';
  const types = Array.from(new Set(
    dashboardState.bookings
      .map((booking) => booking.serviceType)
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

  select.innerHTML = [
    '<option value="All">All types</option>',
    ...types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
  ].join('');

  select.value = previous === 'All' || types.includes(previous) ? previous : 'All';
  dashboardState.selectedService = select.value;
}

function renderFeedTable() {
  const tbody = document.getElementById('bookingsFeedBody');
  if (!tbody) return;

  const filter = dashboardState.selectedService || 'All';
  // Newest booking first: the moment a confirmed appointment is created it
  // appears here, ahead of older submissions regardless of appointment date.
  let rows = dashboardState.bookings
    .filter((booking) => filter === 'All' || booking.serviceType.toLowerCase() === filter.toLowerCase())
    .sort((a, b) => (
      b.createdTime - a.createdTime ||
      b.dateObj - a.dateObj ||
      timeValue(b.time) - timeValue(a.time)
    ));
  // Show only the 5 most recent bookings
  rows = rows.slice(0, 5);

  if (!rows.length) {
    const message = dashboardState.loadError
      ? 'Bookings are temporarily unavailable. Please check the studio server connection.'
      : 'No confirmed bookings match this filter yet.';
    tbody.innerHTML = `<tr><td class="feed-empty" colspan="4">${escapeHtml(message)}</td></tr>`;
    return;
  }

  // Partial records only: the feed mirrors the calendar's accepted bookings
  // with just the columns this card needs.
  tbody.innerHTML = rows.map((booking) => `
    <tr data-reference="${escapeHtml(booking.reference)}">
      <td title="${escapeHtml(booking.clientName)}"><strong>${escapeHtml(booking.clientFirstName)}</strong></td>
      <td>${escapeHtml(booking.serviceType)}</td>
      <td>
        <span class="feed-date">${escapeHtml(booking.dateLabel)}</span>
        <span class="feed-time">${escapeHtml(booking.timeLabel)}</span>
      </td>
      <td>
        <span class="status-badge ${STATUS_CLASSES[booking.status] || ''}">
          ${escapeHtml(STATUS_LABELS[booking.status] || booking.status)}
        </span>
      </td>
    </tr>
  `).join('');
}

function getUpcomingAppointments() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return dashboardState.bookings
    .filter((booking) => (
      booking.dateObj >= startOfToday &&
      (booking.status === 'confirmed' || booking.status === 'late')
    ))
    .sort((a, b) => a.dateObj - b.dateObj || timeValue(a.time) - timeValue(b.time));
}

function buildCalendarLink(booking) {
  const params = new URLSearchParams();
  if (booking.reference) params.set('booking', booking.reference);
  if (booking.dateObj) params.set('date', dayKey(booking.dateObj));
  const query = params.toString();
  return query ? `master-calendar.html?${query}` : 'master-calendar.html';
}

function renderUpcomingAppointments() {
  const container = document.getElementById('appointmentsList');
  if (!container) return;

  const appointments = getUpcomingAppointments();

  if (!appointments.length) {
    const message = dashboardState.loadError
      ? 'Upcoming appointments are temporarily unavailable. Please check the studio server connection.'
      : 'No upcoming confirmed appointments.';
    container.innerHTML = `<li class="appointments-empty">${escapeHtml(message)}</li>`;
    return;
  }

  container.innerHTML = appointments.map((booking, index) => {
    const title = `${booking.serviceType} session with ${booking.clientFirstName}`;
    const meta = `${booking.dateLabel} · ${booking.timeLabel}`;
    const menuId = `appt-menu-${String(booking.id || index).replace(/[^a-zA-Z0-9_-]/g, '') || index}`;

    return `
      <li class="appointment-item" role="listitem"
          data-reference="${escapeHtml(booking.reference)}"
          data-booking-id="${escapeHtml(booking.id)}">
        <div class="appt-left">
          <div class="appt-icon"><i class="ph ph-tag" aria-hidden="true"></i></div>
          <div class="appt-info">
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(meta)}</p>
          </div>
        </div>
        <div class="appt-actions">
          <button type="button" class="appt-more" aria-haspopup="menu" aria-expanded="false"
                  aria-controls="${escapeHtml(menuId)}"
                  aria-label="Actions for ${escapeHtml(title)} on ${escapeHtml(booking.dateLabel)}">
            <i class="ph ph-dots-three-vertical" aria-hidden="true"></i>
          </button>
          <ul class="appt-menu" id="${escapeHtml(menuId)}" role="menu" hidden>
            <li role="none">
              <button type="button" class="appt-menu__item" role="menuitem" data-appt-action="complete">
                <i class="ph ph-check-circle" aria-hidden="true"></i>
                <span>Mark as Complete</span>
              </button>
            </li>
            <li role="none">
              <button type="button" class="appt-menu__item appt-menu__item--danger" role="menuitem" data-appt-action="cancel">
                <i class="ph ph-x-circle" aria-hidden="true"></i>
                <span>Cancel Appointment</span>
              </button>
            </li>
            <li role="none">
              <button type="button" class="appt-menu__item" role="menuitem" data-appt-action="calendar">
                <i class="ph ph-calendar-check" aria-hidden="true"></i>
                <span>View in Calendar</span>
              </button>
            </li>
          </ul>
        </div>
      </li>
    `;
  }).join('');
}

/* ==========================================================================
   APPOINTMENT ACTIONS
   ========================================================================== */
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('is-visible');

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 2800);
}

function closeAppointmentMenus(restoreFocus) {
  let focusTarget = null;

  document.querySelectorAll('.appointment-item.is-menu-open').forEach((item) => {
    item.classList.remove('is-menu-open');
    const trigger = item.querySelector('.appt-more[aria-expanded="true"]');
    if (trigger) {
      if (restoreFocus) focusTarget = trigger;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  document.querySelectorAll('.appt-menu').forEach((menu) => {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.removeAttribute('style');
  });

  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

function positionAppointmentMenu(trigger, menu) {
  const gap = 6;
  const margin = 12;
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  let top = triggerRect.bottom + gap;
  let left = triggerRect.right - menuRect.width;

  // Flip above the trigger when the menu would fall off the viewport, then
  // keep it inside the window's horizontal edges.
  if (top + menuRect.height > window.innerHeight - margin) {
    top = triggerRect.top - menuRect.height - gap;
  }

  top = Math.max(margin, Math.min(top, window.innerHeight - menuRect.height - margin));
  left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));

  menu.style.position = 'fixed';
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.right = 'auto';
  menu.style.bottom = 'auto';
}

function openAppointmentMenu(trigger) {
  const item = trigger.closest('.appointment-item');
  const menu = item ? item.querySelector('.appt-menu') : null;
  if (!menu) return;

  closeAppointmentMenus(false);

  item.classList.add('is-menu-open');
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  positionAppointmentMenu(trigger, menu);

  const firstItem = menu.querySelector('[role="menuitem"]');
  if (firstItem) firstItem.focus({ preventScroll: true });
}

async function updateAppointmentStatus(booking, status) {
  if (!booking || !booking.reference) {
    showToast('This appointment has no reference, so it cannot be updated.');
    return;
  }

  try {
    const response = await fetch(apiUrl(`/api/bookings/${encodeURIComponent(booking.reference)}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ status })
    });

    if (!response.ok) {
      throw new Error(`Status update failed with status ${response.status}`);
    }

    // Reflect the change immediately, then reconcile with the server snapshot.
    dashboardState.bookings = dashboardState.bookings.map((item) => (
      item.reference === booking.reference ? { ...item, status: normalizeStatus(status) } : item
    ));
    renderDashboard();

    showToast(status === 'completed'
      ? `Marked ${booking.serviceType.toLowerCase()} session with ${booking.clientFirstName} as completed.`
      : `Cancelled the ${booking.serviceType.toLowerCase()} session with ${booking.clientFirstName}.`);

    refreshBookings();
  } catch (error) {
    console.warn('[dashboard] Could not update appointment status:', error);
    showToast('Could not update this appointment. Please try again.');
  }
}

async function handleAppointmentAction(action, booking) {
  if (!booking) return;

  if (action === 'calendar') {
    window.location.assign(buildCalendarLink(booking));
    return;
  }

  if (action === 'complete') {
    updateAppointmentStatus(booking, 'completed');
    return;
  }

  if (action === 'cancel') {
    const message = `Cancel the ${booking.serviceType.toLowerCase()} session with ${booking.clientFirstName}?`;
    const confirmed = window.PaulinaNotice?.confirm
      ? await window.PaulinaNotice.confirm({
          title: 'Cancel this session?',
          message,
          confirmLabel: 'Cancel session',
          cancelLabel: 'Keep session',
          tone: 'danger',
          icon: 'ph-calendar-x'
        })
      : window.confirm(message);

    if (confirmed) updateAppointmentStatus(booking, 'cancelled');
  }
}

function setupAppointmentMenuEvents() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('.appt-more');
    if (trigger) {
      const willOpen = trigger.getAttribute('aria-expanded') !== 'true';
      closeAppointmentMenus(false);
      if (willOpen) openAppointmentMenu(trigger);
      return;
    }

    const actionButton = event.target.closest('[data-appt-action]');
    if (actionButton) {
      event.preventDefault();

      const item = actionButton.closest('.appointment-item');
      const reference = item ? item.dataset.reference : '';
      const bookingId = item ? item.dataset.bookingId : '';
      const booking = dashboardState.bookings.find((entry) => (
        (reference && entry.reference === reference) || (!reference && entry.id === bookingId)
      ));

      closeAppointmentMenus(false);
      handleAppointmentAction(actionButton.dataset.apptAction, booking);
      return;
    }

    if (!event.target.closest('.appt-menu')) {
      closeAppointmentMenus(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAppointmentMenus(true);
      return;
    }

    const menu = event.target.closest('.appt-menu');
    if (!menu) return;

    if (event.key === 'Tab') {
      closeAppointmentMenus(false);
      return;
    }

    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    if (!items.length) return;

    const current = items.indexOf(document.activeElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(current + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length].focus();
    }
  });

  // The menu is fixed-positioned next to its trigger; close it as soon as the
  // list scrolls or the viewport changes so it cannot detach from the card.
  document.addEventListener('scroll', () => closeAppointmentMenus(false), true);
  window.addEventListener('resize', () => closeAppointmentMenus(false));
}

/* ==========================================================================
   BOOKING INSIGHTS CHART
   ========================================================================== */
function niceStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;

  if (normalized <= 1) return 1 * magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function initChart() {
  const canvas = document.getElementById('bookingInsightsChart');
  if (!canvas || typeof Chart === 'undefined') {
    console.warn('[dashboard] Chart.js is unavailable; booking insights cannot be drawn.');
    return;
  }

  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Confirmed bookings',
        data: [],
        borderColor: '#460c15',
        borderWidth: 2,
        pointBackgroundColor: '#f8f4ee',
        pointBorderColor: '#460c15',
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointHitRadius: 24,
        fill: false,
        tension: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 320 },
      layout: { padding: 0 },
      // Hovering anywhere over a month's column reveals that month's insight,
      // not only the exact data point on the line.
      interaction: {
        mode: 'index',
        intersect: false,
        axis: 'x'
      },
      hover: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'nearest',
          intersect: false,
          position: 'nearest',
          backgroundColor: '#460c15',
          titleColor: '#faf5ef',
          bodyColor: '#faf5ef',
          borderColor: 'rgba(250, 245, 239, 0.25)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 6,
          displayColors: false,
          titleFont: { family: SERIF_FONT, size: 11, weight: '700' },
          bodyFont: { family: SERIF_FONT, size: 11 },
          callbacks: {
            title: (items) => {
              const label = items[0]?.label || '';
              return `${label} ${dashboardState.chart.year}`.trim();
            },
            label: (context) => {
              const index = context.dataIndex;
              const chart = dashboardState.chart;
              const count = Number(chart.values?.[index]) || 0;
              const deposits = Number(chart.deposits?.[index]) || 0;
              const noShows = Number(chart.noShows?.[index]) || 0;

              const lines = [
                `${count} confirmed booking${count === 1 ? '' : 's'}`,
                `${formatCurrency(deposits)} in deposits`
              ];
              if (noShows > 0) {
                lines.push(`${noShows} no-show${noShows === 1 ? '' : 's'}`);
              }
              return lines;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 5,
          border: { display: false },
          grid: {
            color: 'rgba(42, 16, 21, 0.4)',
            drawTicks: false
          },
          ticks: {
            stepSize: 1,
            precision: 0,
            padding: 12,
            font: { family: SERIF_FONT, size: 12 },
            color: '#2a1015'
          }
        },
        x: {
          position: 'top',
          border: { display: false },
          grid: { display: false },
          ticks: {
            padding: 5,
            crossAlign: 'far',
            font: { family: SERIF_FONT, size: 16 },
            color: '#2a1015'
          }
        }
      }
    }
  });

  // Re-measure once the display font has loaded so tick labels use it.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => chartInstance && chartInstance.update('none'));
  }
}

function renderChart(metrics) {
  const chart = metrics.chart;
  dashboardState.chart = chart;

  const period = document.getElementById('chartPeriod');
  if (period) period.textContent = chart.periodLabel;

  const caption = document.getElementById('chartCaption');
  if (caption) caption.textContent = `Confirmed bookings by month, ${chart.periodLabel}`;

  const dataBody = document.getElementById('chartDataBody');
  if (dataBody) {
    dataBody.innerHTML = chart.labels.map((label, index) => `
      <tr>
        <th scope="row">${escapeHtml(label)} ${chart.year}</th>
        <td>${escapeHtml(String(chart.values[index] || 0))}</td>
      </tr>
    `).join('');
  }

  const canvas = document.getElementById('bookingInsightsChart');
  if (canvas) {
    const summary = chart.labels
      .map((label, index) => `${label} ${chart.values[index] || 0}`)
      .join(', ');
    canvas.setAttribute('aria-label', `Line chart of confirmed bookings from ${chart.periodLabel}: ${summary}`);
  }

  if (!chartInstance) return;

  chartInstance.data.labels = chart.labels;
  chartInstance.data.datasets[0].data = chart.values;

  const maxValue = Math.max(0, ...chart.values);
  const step = Math.max(1, niceStep(Math.max(1, maxValue) / 4));
  chartInstance.options.scales.y.max = Math.max(4, Math.ceil(maxValue / step) * step);
  chartInstance.options.scales.y.ticks.stepSize = step;

  chartInstance.update();
}

/* ==========================================================================
   EVENTS
   ========================================================================== */
function setupEventListeners() {
  const filterSelect = document.getElementById('feedFilterSelect');
  if (filterSelect) {
    filterSelect.addEventListener('change', (event) => {
      dashboardState.selectedService = event.target.value;
      renderFeedTable();
    });
  }

  const revenueInput = document.getElementById('kpiRevenue');
  if (revenueInput) {
    revenueInput.addEventListener('focus', () => revenueInput.select());

    revenueInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        revenueInput.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        revenueInput.value = formatCurrency(dashboardState.manualRevenue);
        revenueInput.blur();
      }
    });

    revenueInput.addEventListener('blur', commitRevenue);
  }
}

// Exposed so a future data layer can push a snapshot without a page reload.
window.PaulinaDashboard = {
  state: dashboardState,
  refresh: refreshBookings,
  recompute() {
    renderDashboard();
    return computeDashboardMetrics(dashboardState.bookings, new Date());
  },
  setBookings(rows) {
    dashboardState.bookings = (Array.isArray(rows) ? rows : []).map(normalizeBooking).filter(isCalendarBooking);
    renderDashboard();
  }
};
