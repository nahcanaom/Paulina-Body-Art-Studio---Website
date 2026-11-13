/**
 * Admin notification indicators.
 *
 * The bell in the admin header shows how many notifications are unread, and the
 * dashboard shows a dismissible bar with the latest activity. Both read the same
 * /api/notifications endpoint, so the count and the copy never disagree.
 */
(function () {
  'use strict';

  const POLL_INTERVAL_MS = 5000;
  const DISMISS_KEY = 'paulina:notificationBarDismissedAt';

  const apiUrl =
    typeof window.paulinaApiUrl === 'function' ? window.paulinaApiUrl : (path) => path;

  const badge = document.getElementById('notificationBadge');
  const bell = document.getElementById('notificationsBtn');

  function renderBadge(count) {
    if (!badge) return;

    const total = Number(count) || 0;
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.hidden = total <= 0;

    if (bell) {
      bell.classList.toggle('has-unread', total > 0);
      bell.setAttribute(
        'aria-label',
        total > 0 ? `Notifications (${total} unread)` : 'Notifications'
      );
    }
  }

  async function loadNotifications(limit = 5) {
    const response = await window.paulinaAdminFetch(apiUrl(`/api/notifications?limit=${limit}`), {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) throw new Error(`Notifications request failed (${response.status})`);
    return response.json();
  }

  async function refreshBadge() {
    try {
      const data = await loadNotifications(1);
      renderBadge(data.unreadCount);
      return data;
    } catch (error) {
      // A sleeping dev server is not worth a console error on every poll.
      return null;
    }
  }

  async function initDashboardBar() {
    const bar = document.getElementById('notificationBar');
    if (!bar) return;

    const data = await refreshBadge();
    if (!data) return;

    let notifications = [];

    try {
      const full = await loadNotifications(5);
      notifications = Array.isArray(full.notifications) ? full.notifications : [];
      renderBadge(full.unreadCount);
    } catch (error) {
      return;
    }

    const unread = notifications.filter((item) => !item.read);
    if (!unread.length) return;

    // Dismissing hides the bar until more notifications arrive than were on
    // screen at the time, so a new booking still surfaces after a dismiss.
    const dismissedCount = Number(window.sessionStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedCount >= unread.length) return;

    const title = document.getElementById('notificationBarTitle');

    if (title) {
      title.textContent = `${unread.length} new update${unread.length === 1 ? '' : 's'}`;
    }

    bar.hidden = false;

    document.getElementById('notificationBarDismiss')?.addEventListener('click', () => {
      window.sessionStorage.setItem(DISMISS_KEY, String(unread.length));
      bar.hidden = true;
    });
  }

  function start() {
    refreshBadge();
    initDashboardBar();

    window.setInterval(refreshBadge, POLL_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshBadge();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.AdminNotifications = { refreshBadge };
})();
