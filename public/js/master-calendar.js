/**
 * PAULINA BODY ART STUDIO — MASTER CALENDAR CONTROLLER
 *
 * Data source: GET /api/bookings (live studio bookings), narrowed to real
 * appointment states. No placeholder or seed rows are merged in — an empty or
 * failed response renders an empty calendar with a notice instead of invented
 * appointments.
 *
 * Responsibilities:
 *   - Fetch and normalize real, existing bookings; pending requests and
 *     cancelled records are excluded.
 *   - Sync the calendar to the current date on load and after midnight, and
 *     auto-select the next upcoming confirmed appointment.
 *   - Display booking states: Completed, Confirmed, Cancelled, No-Show, Late Arrival.
 *   - Service color coding: Tattoo (pink), Piercing (maroon), Troubleshooting (amber).
 *   - Interactive right-side detail panel with full booking metadata.
 *   - Booking management: Edit status/details, mark cancelled, delete permanently.
 *   - Advanced multi-parameter filtering: Service, Artist, Status.
 *   - View switching: Month, Week, Today.
 */

import { createDialog } from '../components/dialog.js';
import { supabase } from './supabase-config.js';

if (supabase) {
  try {
    supabase
      .channel('master-calendar-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        loadBookings();
      })
      .subscribe();
  } catch (err) {
    console.warn('[calendar] Realtime sync error:', err);
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Studio opening hours used when a week/day has no bookings to widen the range.
const DEFAULT_HOURS = { start: 9, end: 18 };

// Accepted appointments plus no-show outcomes belong on the master calendar.
// Pending requests and cancelled records stay out.
const CALENDAR_STATUSES = new Set(['confirmed', 'completed', 'late', 'latearrival', 'noshow']);
const CALENDAR_STATUS_QUERY = Array.from(CALENDAR_STATUSES).join(',');

function statusKey(status) {
  return String(status || '').toLowerCase().replace(/[\s-_]/g, '');
}

// Artist options shown in the calendar are curated. Anna has been removed and
// the old "Paulina Vampire" name is presented as Pauline.
const HIDDEN_ARTIST_VALUES = new Set(['anna']);
const ARTIST_NAME_ALIASES = new Map([
  ['paulina vampire', 'Pauline'],
  ['paulina', 'Pauline']
]);

function normalizeArtistOption(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (HIDDEN_ARTIST_VALUES.has(key)) return '';
  return ARTIST_NAME_ALIASES.get(key) || raw;
}

function isCalendarBooking(booking) {
  return Boolean(booking) && CALENDAR_STATUSES.has(statusKey(booking.status));
}

function currentDate() {
  return new Date();
}

function dayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

// Resolves /api against the Express backend even when this admin page is
// previewed through Live Server on a different port.
function apiUrl(path) {
  if (typeof window !== 'undefined' && typeof window.paulinaApiUrl === 'function') {
    return window.paulinaApiUrl(path);
  }
  return path;
}

// App State — starts on the real current month/day, never a hardcoded date.
const initialToday = currentDate();
const state = {
  year: initialToday.getFullYear(),
  month: initialToday.getMonth(),
  selectedDay: initialToday.getDate(),
  selectedBookingRef: null,
  activeView: 'month', // 'month' | 'week' | 'today'
  bookings: [],
  loadError: null,
  lastSyncedDayKey: dayKey(initialToday),
  filters: {
    service: 'all',
    artist: 'all',
    status: 'all'
  }
};

// Dialog controllers
let editDialog = null;
let cancelDialog = null;

/* ==========================================================================
   FORMATTING & NORMALIZATION HELPERS
   ========================================================================== */

function formatStatusLabel(status) {
  const s = String(status || '').toLowerCase().replace(/[\s-_]/g, '');
  switch (s) {
    case 'completed': return 'Completed';
    case 'confirmed': return 'Confirmed';
    case 'cancelled':
    case 'canceled': return 'Cancelled';
    case 'noshow': return 'No-Show';
    case 'late':
    case 'latearrival': return 'Late Arrival';
    case 'pendingconfirmation': return 'Pending';
    default: return status || 'Confirmed';
  }
}

function getStatusClass(status) {
  const s = String(status || '').toLowerCase().replace(/[\s-_]/g, '');
  switch (s) {
    case 'completed': return 'status-completed';
    case 'confirmed': return 'status-confirmed';
    case 'cancelled':
    case 'canceled': return 'status-cancelled';
    case 'noshow': return 'status-noshow';
    case 'late':
    case 'latearrival': return 'status-late';
    default: return 'status-confirmed';
  }
}

function normalizeServiceType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('piercing')) return 'Piercing';
  if (text.includes('troubleshoot') || text.includes('consult')) return 'Troubleshooting';
  return 'Tattoo';
}

function getServiceChipClass(serviceType) {
  const s = String(serviceType || '').toLowerCase();
  if (s.includes('piercing')) return 'chip-piercing';
  if (s.includes('troubleshoot') || s.includes('consult')) return 'chip-troubleshooting';
  return 'chip-tattoo';
}

function parseBookingDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const text = String(value).trim();
  if (!text) return null;

  // Treat plain YYYY-MM-DD as a local date so the day never shifts by timezone.
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (isoDay) {
    return new Date(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]));
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function sameDay(a, b) {
  return Boolean(a && b) &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatFullDate(date) {
  if (!date) return '';
  return `${DAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function firstName(name) {
  const text = String(name || '').trim();
  return text ? text.split(/\s+/)[0] : 'Client';
}

function parseTimeParts(timeStr) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(timeStr || '').trim());
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const suffix = match[3] ? match[3].toUpperCase() : null;

  if (suffix === 'PM' && hour < 12) hour += 12;
  if (suffix === 'AM' && hour === 12) hour = 0;
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  return { hour, minute };
}

function formatClock(timeStr) {
  const parts = parseTimeParts(timeStr);
  if (!parts) return String(timeStr || '').trim();

  const suffix = parts.hour >= 12 ? 'PM' : 'AM';
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour12}:${String(parts.minute).padStart(2, '0')} ${suffix}`;
}

function formatTimeShort(timeStr) {
  const parts = parseTimeParts(timeStr);
  if (!parts) return String(timeStr || '').trim();
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour12}:${String(parts.minute).padStart(2, '0')}`;
}

function parseDurationMinutes(value) {
  const match = /(\d+(?:\.\d+)?)\s*(hour|hr|minute|min)/i.exec(String(value || ''));
  if (!match) return 0;
  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount)) return 0;
  return /hour|hr/i.test(match[2]) ? Math.round(amount * 60) : Math.round(amount);
}

function minutesToDurationLabel(minutes) {
  if (!minutes || minutes < 1) return '';
  if (minutes < 60) return `${minutes} mins`;
  const hours = minutes / 60;
  const text = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${text} hours`;
}

function addMinutesToTime(timeStr, minutes) {
  const parts = parseTimeParts(timeStr);
  if (!parts || !minutes) return '';
  const total = (parts.hour * 60 + parts.minute + minutes) % (24 * 60);
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return formatClock(`${hour}:${String(minute).padStart(2, '0')}`);
}

function durationBetween(startStr, endStr) {
  const start = parseTimeParts(startStr);
  const end = parseTimeParts(endStr);
  if (!start || !end) return '';
  let diff = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute);
  if (diff <= 0) diff += 24 * 60;
  return minutesToDurationLabel(diff);
}

function hourFromTime(timeStr) {
  const parts = parseTimeParts(timeStr);
  return parts ? parts.hour : null;
}

function formatDeposit(value) {
  if (value === 0) return '₱0';
  if (value === null || value === undefined || String(value).trim() === '') return '';

  const text = String(value).trim();
  if (/^(₱|php\b|p(?=\d))/i.test(text)) {
    return text.replace(/^php\s*/i, '₱').replace(/^p(?=\d)/i, '₱');
  }
  return `₱${text}`;
}

function publicationFromStatus(status) {
  const s = String(status || '').toLowerCase().replace(/[\s-_]/g, '');
  switch (s) {
    case 'confirmed':
    case 'completed':
    case 'late':
    case 'latearrival':
      return 'Published';
    case 'cancelled':
    case 'canceled':
      return 'Unpublished';
    case 'noshow':
      return 'Forfeited';
    case 'pendingconfirmation':
      return 'Pending';
    default:
      return 'Published';
  }
}

/**
 * Converts a raw /api/bookings row into the shape the calendar renders.
 */
function normalizeBooking(raw) {
  const dateObj = parseBookingDate(raw.date);
  const reference = String(raw.reference || raw.id || '').trim();
  const fullName = String(raw.fullName || raw.client || raw.name || 'Client').trim();
  const time = formatClock(raw.time);
  const duration = raw.duration || durationBetween(raw.time, raw.endTime);
  const endTime = raw.endTime ? formatClock(raw.endTime) : addMinutesToTime(raw.time, parseDurationMinutes(duration));
  const serviceType = normalizeServiceType(raw.serviceType || raw.service);
  const notes = [raw.notes, raw.placement, raw.tattooSize]
    .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' · ');
  const deposit = formatDeposit(raw.deposit);

  return {
    ...raw,
    reference,
    fullName,
    displayName: firstName(fullName),
    // Keep the curated artist name consistent everywhere the calendar shows
    // it: chips, details, filters and the edit dialog.
    artist: normalizeArtistOption(raw.artist),
    dateObj,
    time,
    endTime,
    duration,
    serviceType,
    deposit,
    notesText: notes || 'No notes added.',
    dateFormatted: dateObj ? formatFullDate(dateObj) : String(raw.date || '').trim(),
    timeFormatted: [time, endTime ? `– ${endTime}` : '', duration ? `· ${duration}` : '']
      .filter(Boolean)
      .join(' '),
    publicationStatus: raw.publicationStatus || publicationFromStatus(raw.status)
  };
}

function timeValue(timeStr) {
  const parts = parseTimeParts(timeStr);
  return parts ? parts.hour * 60 + parts.minute : Number.MAX_SAFE_INTEGER;
}

function bookingsOnDate(list, date) {
  return list
    .filter((booking) => sameDay(booking.dateObj, date))
    .sort((a, b) => timeValue(a.time) - timeValue(b.time));
}

/* ==========================================================================
   DATA LOADING
   ========================================================================== */

/**
 * Loads every booking from the backend. There is no seed fallback: a failed
 * request leaves the calendar empty and surfaces a notice instead.
 */
async function loadBookings() {
  try {
    const response = await fetch(
      apiUrl(`/api/bookings?status=${encodeURIComponent(CALENDAR_STATUS_QUERY)}`),
      {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      }
    );
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload?.bookings;
    if (!Array.isArray(rows)) throw new Error('Unexpected bookings response shape');

    state.bookings = rows
      .filter(isCalendarBooking)
      .map(normalizeBooking)
      .filter((booking) => booking.reference && booking.dateObj);
    state.loadError = null;
  } catch (error) {
    console.error('[calendar] Could not load bookings from the server:', error);
    state.bookings = [];
    state.loadError = error;
  }

  state.lastSyncedDayKey = dayKey(currentDate());
  populateFilterOptions();
  updateNotice();
  selectInitialDate();
  applyDeepLink();
  renderCurrentView();
  renderDetailPanel();
}

/**
 * Opens the calendar on a specific appointment when the dashboard sends
 * ?booking=<reference>&date=<YYYY-MM-DD>. The date alone is enough if the
 * record is no longer part of the calendar status set.
 */
function applyDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('booking');
  const dateParam = params.get('date');

  const target = reference
    ? state.bookings.find((booking) => booking.reference === reference) || null
    : null;
  const targetDate = target ? target.dateObj : (dateParam ? parseBookingDate(dateParam) : null);

  if (!targetDate) return;

  state.year = targetDate.getFullYear();
  state.month = targetDate.getMonth();
  state.selectedDay = targetDate.getDate();

  if (target) {
    state.selectedBookingRef = target.reference;
    return;
  }

  const dayBookings = bookingsOnDate(getFilteredBookings(), targetDate);
  state.selectedBookingRef = dayBookings.length > 0 ? dayBookings[0].reference : null;
}

/**
 * Opens on today; if today is empty, moves to the nearest upcoming confirmed
 * booking (even in a later month) so the calendar always surfaces the next
 * relevant appointment instead of a stale or empty month.
 */
function selectInitialDate() {
  const today = currentDate();
  state.year = today.getFullYear();
  state.month = today.getMonth();
  state.selectedDay = today.getDate();
  state.selectedBookingRef = null;
  state.lastSyncedDayKey = dayKey(today);

  const filtered = getFilteredBookings();
  const todayBookings = bookingsOnDate(filtered, today);
  if (todayBookings.length > 0) {
    state.selectedBookingRef = todayBookings[0].reference;
    return;
  }

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const upcoming = filtered
    .filter((booking) => booking.dateObj >= startOfToday)
    .sort((a, b) => a.dateObj - b.dateObj || timeValue(a.time) - timeValue(b.time));

  if (upcoming.length > 0) {
    const next = upcoming[0];
    state.year = next.dateObj.getFullYear();
    state.month = next.dateObj.getMonth();
    state.selectedDay = next.dateObj.getDate();
    state.selectedBookingRef = next.reference;
  }
}

/**
 * Re-syncs the calendar when the browser tab is reopened or the clock crosses
 * midnight. Without this, a tab left open overnight would keep showing
 * yesterday as "today".
 */
function syncToCurrentDate({ force = false } = {}) {
  const key = dayKey(currentDate());
  if (!force && key === state.lastSyncedDayKey) return;

  selectInitialDate();
  renderCurrentView();
  renderDetailPanel();
}

function updateNotice() {
  const notice = document.getElementById('calNotice');
  if (!notice) return;

  if (state.loadError) {
    notice.hidden = false;
    notice.textContent = 'Bookings could not be loaded from the server. Nothing placeholder is shown — check the connection and reload.';
    return;
  }

  if (state.bookings.length === 0) {
    notice.hidden = false;
    notice.textContent = 'No confirmed bookings have been recorded yet. Pending requests and cancelled appointments are not shown here.';
    return;
  }

  notice.hidden = true;
  notice.textContent = '';
}

/**
 * Populates the service and artist filters from the bookings that actually exist.
 */
function populateFilterOptions() {
  const serviceValues = new Set();
  const artistValues = new Set();

  state.bookings.forEach((booking) => {
    if (booking.serviceType) serviceValues.add(booking.serviceType);
    const artist = normalizeArtistOption(booking.artist);
    if (artist) artistValues.add(artist);
  });

  populateSelect('filterService', Array.from(serviceValues).sort(), 'All services');
  populateSelect('filterArtist', Array.from(artistValues).sort(), 'All artists');
}

function populateSelect(selectId, values, allLabel) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const previous = select.value;
  select.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = allLabel;
  select.appendChild(allOption);

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  const hasPrevious = Array.from(select.options).some((option) => option.value === previous);
  select.value = hasPrevious ? previous : 'all';
  if (!hasPrevious) {
    if (selectId === 'filterService') state.filters.service = 'all';
    if (selectId === 'filterArtist') state.filters.artist = 'all';
  }

  syncCustomFilterDropdown(selectId);
}

/**
 * Filters bookings based on current filter values.
 */
function getFilteredBookings() {
  return state.bookings.filter((booking) => {
    if (state.filters.service !== 'all' &&
        String(booking.serviceType || '').toLowerCase() !== state.filters.service.toLowerCase()) {
      return false;
    }

    if (state.filters.artist !== 'all' &&
        String(booking.artist || '').toLowerCase() !== state.filters.artist.toLowerCase()) {
      return false;
    }

    if (state.filters.status !== 'all') {
      const bookingStatus = String(booking.status || '').toLowerCase().replace(/[\s-_]/g, '');
      const filterStatus = state.filters.status.toLowerCase().replace(/[\s-_]/g, '');
      if (bookingStatus !== filterStatus) return false;
    }

    return true;
  });
}

function getSelectedBooking() {
  if (!state.selectedBookingRef) return null;
  return state.bookings.find((booking) => booking.reference === state.selectedBookingRef) || null;
}

/* ==========================================================================
   MONTH VIEW
   ========================================================================== */

function updateHeaderTitle() {
  const titleEl = document.getElementById('calCurrentMonth');
  if (titleEl) titleEl.textContent = `${MONTH_NAMES[state.month]} ${state.year}`;
}

function renderMonthGrid() {
  const grid = document.getElementById('calMonthGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const { year, month } = state;
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const filtered = getFilteredBookings();
  const today = new Date();

  // 1. Preceding days from the previous month
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell outside-month';
    const dayNumber = document.createElement('div');
    dayNumber.className = 'cal-day-number';
    dayNumber.textContent = String(daysInPrevMonth - i);
    cell.appendChild(dayNumber);
    grid.appendChild(cell);
  }

  // 2. Days in the active month
  for (let day = 1; day <= daysInCurrentMonth; day++) {
    const cellDate = new Date(year, month, day);
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.setAttribute('data-day', String(day));
    cell.setAttribute('role', 'gridcell');

    if (sameDay(today, cellDate)) cell.classList.add('is-today');
    if (day === state.selectedDay) cell.classList.add('is-selected');

    const dayNumber = document.createElement('div');
    dayNumber.className = 'cal-day-number';
    const numberSpan = document.createElement('span');
    numberSpan.textContent = String(day);
    const todayLabel = document.createElement('span');
    todayLabel.className = 'cal-today-label';
    todayLabel.textContent = 'TODAY';
    dayNumber.append(numberSpan, todayLabel);

    const chips = document.createElement('div');
    chips.className = 'cal-chips';
    bookingsOnDate(filtered, cellDate).forEach((booking) => {
      chips.appendChild(createBookingChip(booking, day));
    });

    cell.append(dayNumber, chips);
    cell.addEventListener('click', () => selectDay(day));
    grid.appendChild(cell);
  }

  // 3. Trailing days to complete a 5- or 6-week grid
  const totalRendered = firstDayIndex + daysInCurrentMonth;
  const targetTotal = totalRendered > 35 ? 42 : 35;
  for (let day = 1; day <= targetTotal - totalRendered; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell outside-month';
    const dayNumber = document.createElement('div');
    dayNumber.className = 'cal-day-number';
    dayNumber.textContent = String(day);
    cell.appendChild(dayNumber);
    grid.appendChild(cell);
  }
}

/**
 * Booking chip: "3:00 · Crizzia" over "Anna · Confirmed".
 */
function createBookingChip(booking, day) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `cal-chip ${getServiceChipClass(booking.serviceType)}`.trim();
  chip.setAttribute('data-reference', booking.reference);
  chip.title = `${booking.fullName} · ${booking.serviceType} · ${formatStatusLabel(booking.status)}`;
  chip.setAttribute(
    'aria-label',
    `${formatTimeShort(booking.time)} ${booking.fullName}, ${booking.artist || 'unassigned'}, ${formatStatusLabel(booking.status)}`
  );

  const title = document.createElement('span');
  title.className = 'cal-chip-time';
  title.textContent = `${formatTimeShort(booking.time)} · ${booking.displayName}`;

  const meta = document.createElement('span');
  meta.className = 'cal-chip-status';
  meta.textContent = [booking.artist, formatStatusLabel(booking.status)]
    .filter(Boolean)
    .join(' · ');

  chip.append(title, meta);
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    selectBooking(booking.reference, day);
  });

  return chip;
}

/* ==========================================================================
   WEEK & TODAY VIEWS
   ========================================================================== */

function buildHourRange(bookings) {
  let start = DEFAULT_HOURS.start;
  let end = DEFAULT_HOURS.end;

  bookings.forEach((booking) => {
    const startHour = hourFromTime(booking.time);
    if (startHour === null) return;
    const endHour = hourFromTime(booking.endTime);
    start = Math.min(start, startHour);
    end = Math.max(end, endHour === null ? startHour : endHour);
  });

  const hours = [];
  for (let hour = start; hour <= end; hour++) {
    hours.push({ hour, label: formatClock(`${hour}:00`) });
  }
  return hours;
}

function renderWeekView() {
  const headers = document.getElementById('weekDayHeaders');
  const grid = document.getElementById('weekGrid');
  if (!headers || !grid) return;

  headers.innerHTML = '';
  grid.innerHTML = '';

  const selectedDate = new Date(state.year, state.month, state.selectedDay);
  const startOfWeek = new Date(selectedDate);
  startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());

  const filtered = getFilteredBookings();
  const today = new Date();

  const corner = document.createElement('div');
  corner.className = 'week-day-header week-time-gutter';
  headers.appendChild(corner);

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(startOfWeek.getDate() + i);
    weekDates.push(dayDate);

    const header = document.createElement('div');
    header.className = 'week-day-header';
    if (sameDay(today, dayDate)) header.classList.add('is-today');
    const dayName = document.createElement('strong');
    dayName.textContent = DAY_NAMES[i].slice(0, 3);
    header.append(dayName, document.createElement('br'), String(dayDate.getDate()));
    headers.appendChild(header);
  }

  const hours = buildHourRange(weekDates.flatMap((dayDate) => bookingsOnDate(filtered, dayDate)));

  hours.forEach((slot) => {
    const timeLabel = document.createElement('div');
    timeLabel.className = 'week-time-label';
    timeLabel.textContent = slot.label;
    grid.appendChild(timeLabel);

    weekDates.forEach((dayDate) => {
      const cell = document.createElement('div');
      cell.className = 'week-cell';

      bookingsOnDate(filtered, dayDate)
        .filter((booking) => hourFromTime(booking.time) === slot.hour)
        .forEach((booking) => {
          const block = document.createElement('button');
          block.type = 'button';
          block.className = `week-booking-block ${getServiceChipClass(booking.serviceType)}`.trim();

          const blockTitle = document.createElement('div');
          blockTitle.className = 'week-booking-title';
          blockTitle.textContent = booking.displayName;

          const blockMeta = document.createElement('div');
          blockMeta.className = 'week-booking-meta';
          blockMeta.textContent = `${booking.time} · ${formatStatusLabel(booking.status)}`;

          block.append(blockTitle, blockMeta);
          block.addEventListener('click', (event) => {
            event.stopPropagation();
            selectBooking(booking.reference, dayDate.getDate());
          });
          cell.appendChild(block);
        });

      grid.appendChild(cell);
    });
  });
}

function renderTodayView() {
  const container = document.getElementById('todayTimeline');
  if (!container) return;
  container.innerHTML = '';

  const dayDate = new Date(state.year, state.month, state.selectedDay);
  const dayBookings = bookingsOnDate(getFilteredBookings(), dayDate);
  const hours = buildHourRange(dayBookings);

  hours.forEach((slot) => {
    const row = document.createElement('div');
    row.className = 'today-hour-row';

    const label = document.createElement('div');
    label.className = 'today-time-label';
    label.textContent = slot.label;

    const slotCell = document.createElement('div');
    slotCell.className = 'today-slot';

    dayBookings
      .filter((booking) => hourFromTime(booking.time) === slot.hour)
      .forEach((booking) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `today-booking-card ${getServiceChipClass(booking.serviceType)}`.trim();

        const time = document.createElement('div');
        time.className = 'today-booking-time';
        time.textContent = booking.time;

        const info = document.createElement('div');
        info.className = 'today-booking-info';
        const name = document.createElement('div');
        name.className = 'today-booking-name';
        name.textContent = booking.fullName;
        const service = document.createElement('div');
        service.className = 'today-booking-service';
        service.textContent = `${booking.serviceType} · ${booking.artist || 'Unassigned'}`;
        info.append(name, service);

        const status = document.createElement('span');
        status.className = `status-badge ${getStatusClass(booking.status)}`;
        status.textContent = formatStatusLabel(booking.status);

        card.append(time, info, status);
        card.addEventListener('click', () => selectBooking(booking.reference, dayDate.getDate()));
        slotCell.appendChild(card);
      });

    row.append(label, slotCell);
    container.appendChild(row);
  });
}

/* ==========================================================================
   VIEW SWITCHING & SELECTION
   ========================================================================== */

function renderCurrentView() {
  updateHeaderTitle();

  const monthWrap = document.getElementById('monthViewWrap');
  const weekWrap = document.getElementById('weekViewWrap');
  const todayWrap = document.getElementById('todayViewWrap');

  if (monthWrap) monthWrap.classList.toggle('active-view', state.activeView === 'month');
  if (weekWrap) weekWrap.classList.toggle('active-view', state.activeView === 'week');
  if (todayWrap) todayWrap.classList.toggle('active-view', state.activeView === 'today');

  if (state.activeView === 'month') {
    renderMonthGrid();
  } else if (state.activeView === 'week') {
    renderWeekView();
  } else if (state.activeView === 'today') {
    renderTodayView();
  }
}

function jumpToDate(date, { silent = false } = {}) {
  state.year = date.getFullYear();
  state.month = date.getMonth();
  state.selectedDay = date.getDate();

  const dayBookings = bookingsOnDate(getFilteredBookings(), date);
  state.selectedBookingRef = dayBookings.length > 0 ? dayBookings[0].reference : null;

  if (!silent) {
    renderCurrentView();
    renderDetailPanel();
    if (state.selectedBookingRef) openDetailSheet();
  }
}

function selectDay(day) {
  state.selectedDay = day;
  const dayDate = new Date(state.year, state.month, day);
  const dayBookings = bookingsOnDate(getFilteredBookings(), dayDate);
  state.selectedBookingRef = dayBookings.length > 0 ? dayBookings[0].reference : null;

  renderCurrentView();
  renderDetailPanel();

  // Phones show the selected booking in a bottom sheet. Empty days stay on
  // the calendar so simple browsing never forces a panel open.
  if (state.selectedBookingRef) openDetailSheet();
}

function selectBooking(reference, day) {
  if (day) state.selectedDay = day;
  state.selectedBookingRef = reference || null;
  renderCurrentView();
  renderDetailPanel();

  if (state.selectedBookingRef) openDetailSheet();
}

function openDetailSheet(trigger = null) {
  window.AdminSheet?.open('detailPanel', {
    trigger: trigger || document.querySelector('.calendar-main')
  });
}

function closeDetailSheet() {
  window.AdminSheet?.close('detailPanel', { restoreFocus: false });
}

/* ==========================================================================
   RIGHT DETAIL PANEL
   ========================================================================== */

function renderDetailPanel() {
  const booking = getSelectedBooking();
  if (!booking) {
    renderEmptyDetailPanel();
    return;
  }

  const statusBadge = document.getElementById('detailStatusBadge');
  const clientName = document.getElementById('detailClientName');
  const bookingId = document.getElementById('detailBookingId');
  const dateEl = document.getElementById('detailDate');
  const timeEl = document.getElementById('detailTime');
  const serviceArtistEl = document.getElementById('detailServiceArtist');
  const contactEl = document.getElementById('detailContact');
  const depositEl = document.getElementById('detailDeposit');
  const publicationBadge = document.getElementById('detailPublicationBadge');
  const descriptionEl = document.getElementById('detailDescription');

  if (statusBadge) {
    statusBadge.className = `detail-status-badge ${getStatusClass(booking.status)}`;
    statusBadge.textContent = formatStatusLabel(booking.status);
  }

  if (clientName) clientName.textContent = booking.displayName;

  if (bookingId) {
    bookingId.textContent = [booking.reference, booking.service || `${booking.serviceType} session`]
      .filter(Boolean)
      .join(' · ');
  }

  if (dateEl) dateEl.textContent = booking.dateFormatted || '—';

  if (timeEl) {
    timeEl.textContent = booking.timeFormatted || [booking.time, booking.duration ? `· ${booking.duration}` : '']
      .filter(Boolean)
      .join(' ') || '—';
  }

  if (serviceArtistEl) {
    serviceArtistEl.textContent = [booking.serviceType, booking.artist]
      .filter(Boolean)
      .join(' / ') || '—';
  }

  if (contactEl) {
    contactEl.textContent = [booking.email, booking.phone].filter(Boolean).join(' · ') || 'Not provided';
  }

  if (depositEl) {
    depositEl.textContent = booking.deposit ? `${booking.deposit} deposit` : 'No deposit recorded';
  }

  if (publicationBadge) publicationBadge.textContent = booking.publicationStatus || 'Published';

  if (descriptionEl) descriptionEl.textContent = booking.notesText;
}

function renderEmptyDetailPanel() {
  const statusBadge = document.getElementById('detailStatusBadge');
  const clientName = document.getElementById('detailClientName');
  const bookingId = document.getElementById('detailBookingId');
  const dateEl = document.getElementById('detailDate');
  const timeEl = document.getElementById('detailTime');
  const serviceArtistEl = document.getElementById('detailServiceArtist');
  const contactEl = document.getElementById('detailContact');
  const depositEl = document.getElementById('detailDeposit');
  const publicationBadge = document.getElementById('detailPublicationBadge');
  const descriptionEl = document.getElementById('detailDescription');

  const dayDate = new Date(state.year, state.month, state.selectedDay);

  if (statusBadge) {
    statusBadge.className = 'detail-status-badge';
    statusBadge.textContent = 'No selection';
  }
  if (clientName) clientName.textContent = 'No booking selected';
  if (bookingId) bookingId.textContent = 'Pick a day or booking on the calendar';
  if (dateEl) dateEl.textContent = formatFullDate(dayDate);
  if (timeEl) timeEl.textContent = '—';
  if (serviceArtistEl) serviceArtistEl.textContent = '—';
  if (contactEl) contactEl.textContent = '—';
  if (depositEl) depositEl.textContent = '—';
  if (publicationBadge) publicationBadge.textContent = '—';
  if (descriptionEl) descriptionEl.textContent = 'No booking is selected for this day.';
}

/* ==========================================================================
   BOOKING MANAGEMENT
   ========================================================================== */

function openEditBookingDialog() {
  const booking = getSelectedBooking();
  if (!booking || !editDialog) return;

  const titleEl = document.getElementById('editDialogTitle');
  if (titleEl) titleEl.textContent = `Manage Booking — ${booking.reference}`;

  const serviceSelect = document.getElementById('editServiceType');
  if (serviceSelect) serviceSelect.value = booking.serviceType || 'Tattoo';

  const artistSelect = document.getElementById('editArtist');
  if (artistSelect) {
    const artists = new Set(['Pauline', 'Guest Artist']);
    state.bookings.forEach((item) => {
      const artist = normalizeArtistOption(item.artist);
      if (artist) artists.add(artist);
    });

    const currentArtist = normalizeArtistOption(booking.artist);
    if (currentArtist) artists.add(currentArtist);

    artistSelect.innerHTML = '';
    Array.from(artists)
      .sort((a, b) => a.localeCompare(b))
      .forEach((artist) => artistSelect.appendChild(new Option(artist, artist)));

    if (currentArtist) artistSelect.value = currentArtist;
  }

  const dateInput = document.getElementById('editDate');
  if (dateInput) dateInput.value = booking.date || '';

  const timeInput = document.getElementById('editTime');
  if (timeInput) timeInput.value = booking.time || '';

  const notesInput = document.getElementById('editNotes');
  if (notesInput) notesInput.value = booking.notes || '';

  const currentStatus = String(booking.status || 'confirmed').toLowerCase().replace(/[\s-_]/g, '');
  document.querySelectorAll('#editStatusOptions .dialog-status-option').forEach((button) => {
    const buttonStatus = button.getAttribute('data-status').toLowerCase().replace(/[\s-_]/g, '');
    button.classList.toggle('active', buttonStatus === currentStatus);
  });

  editDialog.open({ trigger: document.getElementById('btnEditBooking') });
}

function replaceBooking(original, raw) {
  const index = state.bookings.indexOf(original);
  const normalized = normalizeBooking(raw);
  if (index === -1) return normalized;

  // A booking that has just been cancelled or sent back to pending no longer
  // qualifies as a calendar appointment. No-show is kept for the record.
  if (!isCalendarBooking(normalized)) {
    state.bookings.splice(index, 1);
    if (state.selectedBookingRef === normalized.reference) {
      state.selectedBookingRef = null;
    }
    return normalized;
  }

  state.bookings[index] = normalized;
  state.selectedBookingRef = normalized.reference;
  return normalized;
}

async function saveBookingChanges() {
  const booking = getSelectedBooking();
  if (!booking) return;

  const activeStatusBtn = document.querySelector('#editStatusOptions .dialog-status-option.active');
  const patch = {
    status: activeStatusBtn ? activeStatusBtn.getAttribute('data-status') : booking.status,
    serviceType: document.getElementById('editServiceType')?.value || booking.serviceType,
    artist: document.getElementById('editArtist')?.value || booking.artist,
    date: document.getElementById('editDate')?.value || booking.date,
    time: document.getElementById('editTime')?.value || booking.time,
    notes: document.getElementById('editNotes')?.value || booking.notes
  };

  try {
    const response = await fetch(apiUrl(`/api/bookings/${encodeURIComponent(booking.reference)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!response.ok) console.warn('[calendar] Server update returned an error, applying locally');
  } catch (error) {
    console.warn('[calendar] Server patch failed, applying locally:', error);
  }

  replaceBooking(booking, { ...booking, ...patch });
  populateFilterOptions();
  updateNotice();
  editDialog?.close();
  renderCurrentView();
  renderDetailPanel();
  if (!getSelectedBooking()) closeDetailSheet();
}

function openCancelDialog() {
  if (!getSelectedBooking() || !cancelDialog) return;
  cancelDialog.open({ trigger: document.getElementById('btnCancelBooking') });
}

async function markBookingCancelled() {
  const booking = getSelectedBooking();
  if (!booking) return;

  try {
    await fetch(apiUrl(`/api/bookings/${encodeURIComponent(booking.reference)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
  } catch (error) {
    console.warn('[calendar] Cancel request failed:', error);
  }

  replaceBooking(booking, { ...booking, status: 'cancelled' });
  populateFilterOptions();
  updateNotice();
  cancelDialog?.close();
  renderCurrentView();
  renderDetailPanel();
  if (!getSelectedBooking()) closeDetailSheet();
}

async function deleteBookingPermanently() {
  const booking = getSelectedBooking();
  if (!booking) return;

  try {
    await fetch(apiUrl(`/api/bookings/${encodeURIComponent(booking.reference)}`), { method: 'DELETE' });
  } catch (error) {
    console.warn('[calendar] Delete request failed:', error);
  }

  state.bookings = state.bookings.filter((item) => item.reference !== booking.reference);
  state.selectedBookingRef = null;
  populateFilterOptions();
  updateNotice();
  cancelDialog?.close();
  renderCurrentView();
  renderDetailPanel();
  closeDetailSheet();
}

/* ==========================================================================
   EVENT LISTENERS
   ========================================================================== */

function setupEventListeners() {
  document.getElementById('calPrevBtn')?.addEventListener('click', () => shiftMonth(-1));
  document.getElementById('calNextBtn')?.addEventListener('click', () => shiftMonth(1));
  document.getElementById('calTodayNavBtn')?.addEventListener('click', () => jumpToDate(new Date()));

  const viewButtons = document.querySelectorAll('.cal-view-btn');
  viewButtons.forEach((button) => {
    button.addEventListener('click', function () {
      const targetView = this.getAttribute('data-view');
      viewButtons.forEach((item) => {
        item.classList.remove('active');
        item.setAttribute('aria-selected', 'false');
      });
      this.classList.add('active');
      this.setAttribute('aria-selected', 'true');
      state.activeView = targetView;
      renderCurrentView();
    });
  });

  document.getElementById('filterService')?.addEventListener('change', function () {
    state.filters.service = this.value;
    afterFilterChange();
  });

  document.getElementById('filterArtist')?.addEventListener('change', function () {
    state.filters.artist = this.value;
    afterFilterChange();
  });

  document.getElementById('filterStatus')?.addEventListener('change', function () {
    state.filters.status = this.value;
    afterFilterChange();
  });

  document.getElementById('btnEditBooking')?.addEventListener('click', openEditBookingDialog);
  document.getElementById('btnCancelBooking')?.addEventListener('click', openCancelDialog);
  document.getElementById('btnSaveBookingChanges')?.addEventListener('click', saveBookingChanges);
  document.getElementById('btnMarkCancelled')?.addEventListener('click', markBookingCancelled);
  document.getElementById('btnConfirmDelete')?.addEventListener('click', deleteBookingPermanently);

  document.querySelectorAll('#editStatusOptions .dialog-status-option').forEach((button) => {
    button.addEventListener('click', function () {
      document.querySelectorAll('#editStatusOptions .dialog-status-option')
        .forEach((item) => item.classList.remove('active'));
      this.classList.add('active');
    });
  });

  editDialog = createDialog({
    overlay: document.getElementById('editBookingDialog'),
    selector: '[role="dialog"]',
    closeButtons: '[data-dialog-close]'
  });

  cancelDialog = createDialog({
    overlay: document.getElementById('cancelConfirmDialog'),
    selector: '[role="dialog"]',
    closeButtons: '[data-dialog-close]'
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.cal-custom-dropdown')) {
      closeAllCustomDropdowns();
    }
  });

  // Keep "today" honest in a tab that stays open across midnight.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncToCurrentDate();
  });
  window.addEventListener('focus', () => syncToCurrentDate());
  window.setInterval(() => syncToCurrentDate(), 60 * 1000);
}

function shiftMonth(delta) {
  state.month += delta;
  if (state.month < 0) {
    state.month = 11;
    state.year -= 1;
  } else if (state.month > 11) {
    state.month = 0;
    state.year += 1;
  }

  state.selectedDay = 1;
  state.selectedBookingRef = null;
  renderCurrentView();
  renderDetailPanel();
}

/**
 * Keeps the selected booking valid after a filter narrows the visible set.
 */
function afterFilterChange() {
  const selected = getSelectedBooking();
  if (selected && !getFilteredBookings().some((booking) => booking.reference === selected.reference)) {
    state.selectedBookingRef = null;
  }
  renderCurrentView();
  renderDetailPanel();
}

/* ==========================================================================
   CUSTOM FILTER DROPDOWNS
   ========================================================================== */

function initCustomFilterDropdowns() {
  const filterWraps = document.querySelectorAll('.cal-filter-wrap');
  filterWraps.forEach((wrap) => {
    const select = wrap.querySelector('select.cal-filter-select');
    if (!select || wrap.dataset.customized === 'true') return;
    wrap.dataset.customized = 'true';

    select.classList.add('cal-filter-select-hidden');
    const oldCaret = wrap.querySelector('.cal-filter-caret');
    if (oldCaret) oldCaret.style.display = 'none';

    const dropdown = document.createElement('div');
    dropdown.className = 'cal-custom-dropdown';
    dropdown.setAttribute('data-select-id', select.id);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cal-custom-dropdown-btn';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'cal-custom-dropdown-label';
    const selectedOption = select.options[select.selectedIndex];
    labelSpan.textContent = selectedOption ? selectedOption.textContent : 'Select...';

    const caretIcon = document.createElement('i');
    caretIcon.className = 'ph ph-caret-down cal-filter-caret';
    caretIcon.setAttribute('aria-hidden', 'true');

    button.append(labelSpan, caretIcon);
    dropdown.appendChild(button);

    const list = document.createElement('ul');
    list.className = 'cal-custom-dropdown-list';
    list.setAttribute('role', 'listbox');
    dropdown.appendChild(list);

    wrap.appendChild(dropdown);

    // Fill the custom list from the <select> immediately. Service and artist
    // are rebuilt again after data loads; status is static, so it would
    // otherwise render an empty menu.
    syncCustomFilterDropdown(select.id);

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = dropdown.classList.contains('is-open');
      closeAllCustomDropdowns();
      if (!isOpen) {
        dropdown.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
      }
    });

    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        dropdown.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
        const first = list.querySelector('.cal-custom-dropdown-item');
        if (first) first.focus();
      } else if (event.key === 'Escape') {
        dropdown.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
      }
    });
  });
}

function closeAllCustomDropdowns() {
  document.querySelectorAll('.cal-custom-dropdown.is-open').forEach((dropdown) => {
    dropdown.classList.remove('is-open');
    const button = dropdown.querySelector('.cal-custom-dropdown-btn');
    if (button) button.setAttribute('aria-expanded', 'false');
  });
}

/**
 * Rebuilds a custom dropdown from its underlying <select> options.
 */
function syncCustomFilterDropdown(selectId) {
  const dropdown = document.querySelector(`.cal-custom-dropdown[data-select-id="${selectId}"]`);
  const select = document.getElementById(selectId);
  if (!dropdown || !select) return;

  const list = dropdown.querySelector('.cal-custom-dropdown-list');
  const labelSpan = dropdown.querySelector('.cal-custom-dropdown-label');
  if (!list || !labelSpan) return;

  list.innerHTML = '';
  Array.from(select.options).forEach((option) => {
    const item = document.createElement('li');
    item.className = 'cal-custom-dropdown-item';
    if (option.value === select.value) item.classList.add('is-selected');
    item.setAttribute('role', 'option');
    item.setAttribute('data-value', option.value);
    item.textContent = option.textContent;

    item.addEventListener('click', (event) => {
      event.stopPropagation();
      select.value = option.value;
      labelSpan.textContent = option.textContent;
      dropdown.classList.remove('is-open');
      dropdown.querySelector('.cal-custom-dropdown-btn')?.setAttribute('aria-expanded', 'false');
      list.querySelectorAll('.cal-custom-dropdown-item').forEach((entry) => {
        entry.classList.toggle('is-selected', entry.getAttribute('data-value') === option.value);
      });
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    list.appendChild(item);
  });

  const currentOption = select.options[select.selectedIndex];
  if (currentOption) labelSpan.textContent = currentOption.textContent;
}

// Initialise application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initCustomFilterDropdowns();
  loadBookings();
});
