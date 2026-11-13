'use strict';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function bookingDate(value) {
  const raw = String(value || '').trim();
  const display = /^(\w+) (\d{1,2}), (\d{4})$/.exec(raw);
  const iso = display ? `${display[3]}-${String(months.indexOf(display[1]) + 1).padStart(2, '0')}-${display[2].padStart(2, '0')}` : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : '';
}

function bookingTime(value) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(value || '').trim());
  if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59) return '';
  return `${match[1].padStart(2, '0')}:${match[2]} ${match[3].toUpperCase()}`;
}

function validateSchedule(date, time, now = new Date()) {
  const iso = bookingDate(date), label = bookingTime(time);
  if (!iso || !label) return false;
  const hour = (+label.slice(0, 2) % 12) + (label.endsWith('PM') ? 12 : 0);
  const minute = +label.slice(3, 5);
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = local.toISOString().slice(0, 10);
  const days = (Date.parse(iso) - Date.parse(today)) / 86400000;
  return days >= 0 && days <= 7 && minute % 15 === 0 && hour >= 9 && (hour < 16 || (hour === 16 && minute === 0))
    && new Date(`${iso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`) > now;
}

module.exports = { bookingDate, bookingTime, validateSchedule };
