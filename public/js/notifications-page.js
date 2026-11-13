/**
 * Notifications page.
 *
 * Lists new bookings and reviews newest first, lets the admin filter by unread,
 * open a notification to read it, delete single notifications, and mark
 * everything read on demand.
 */
(function () {
  'use strict';

  const apiUrl =
    typeof window.paulinaApiUrl === 'function' ? window.paulinaApiUrl : (path) => path;

  const state = {
    notifications: [],
    filter: 'all',
    loaded: false,
    marking: false,
    deleting: false,
    openId: null
  };

  const list = document.getElementById('notificationsList');
  const summary = document.getElementById('notificationsSummary');
  const markAllButton = document.getElementById('btnMarkAllRead');
  const allCount = document.getElementById('notificationsAllCount');
  const unreadCountLabel = document.getElementById('notificationsUnreadCount');

  const modal = document.getElementById('notificationModal');
  const modalDialog = modal?.querySelector('.notification-modal');
  const modalTitle = document.getElementById('notificationModalTitle');
  const modalMessage = document.getElementById('notificationModalMessage');
  const modalMeta = document.getElementById('notificationModalMeta');
  const modalDetails = document.getElementById('notificationModalDetails');
  const modalIcon = document.getElementById('notificationModalIcon');
  const modalLink = document.getElementById('notificationModalLink');
  const modalDelete = document.getElementById('btnDeleteNotification');
  const modalClose = document.getElementById('notificationModalClose');
  const modalDone = document.getElementById('notificationModalDone');

  let lastFocused = null;

  function isNew(item) {
    return !item.read;
  }

  function unreadItems() {
    return state.notifications.filter(isNew);
  }

  function hasUnread() {
    return state.notifications.some((item) => !item.read);
  }

  function formatTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function refreshCounts() {
    const unread = unreadItems().length;
    if (allCount) allCount.textContent = String(state.notifications.length);
    if (unreadCountLabel) unreadCountLabel.textContent = String(unread);
    if (markAllButton) markAllButton.disabled = !hasUnread() || state.marking;
  }

  function renderEmpty() {
    if (!list) return;

    const empty = document.createElement('div');
    empty.className = 'notification-empty';

    const icon = document.createElement('i');
    icon.className = 'ph ph-bell-slash';
    icon.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('p');
    copy.textContent =
      state.filter === 'unread'
        ? 'You are all caught up. No unread notifications.'
        : 'No notifications yet. New bookings and reviews will appear here.';

    empty.append(icon, copy);
    list.appendChild(empty);
  }

  function buildMeta(notification) {
    const meta = document.createElement('div');
    meta.className = 'notification-meta';

    const time = document.createElement('span');
    time.textContent = formatTimestamp(notification.createdAt);
    meta.appendChild(time);

    if (notification.reference) {
      const reference = document.createElement('span');
      reference.textContent = notification.reference;
      meta.appendChild(reference);
    }

    const hint = document.createElement('span');
    hint.className = 'notification-open-hint';
    hint.textContent = 'View notification';
    meta.appendChild(hint);

    return meta;
  }

  function buildItem(notification) {
    const item = document.createElement('article');
    item.className = `notification-item${isNew(notification) ? ' is-unread' : ''}`;
    item.dataset.id = notification.id;

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'notification-open';
    open.setAttribute('aria-label', `View notification: ${notification.title || 'Notification'}`);

    const icon = document.createElement('span');
    icon.className = 'notification-icon';
    const glyph = document.createElement('i');
    glyph.className = notification.type === 'review' ? 'ph ph-star' : 'ph ph-calendar-check';
    glyph.setAttribute('aria-hidden', 'true');
    icon.appendChild(glyph);

    const body = document.createElement('div');
    body.className = 'notification-body';

    const title = document.createElement('h3');
    title.textContent = notification.title || 'Notification';
    if (isNew(notification)) {
      const pill = document.createElement('em');
      pill.className = 'notification-pill';
      pill.textContent = 'New';
      title.appendChild(pill);
    }

    const copy = document.createElement('p');
    copy.textContent = notification.message || '';

    body.append(title, copy, buildMeta(notification));
    open.append(icon, body);
    open.addEventListener('click', () => openNotification(notification.id, open));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'notification-item-delete';
    remove.title = 'Delete notification';
    remove.setAttribute('aria-label', `Delete notification: ${notification.title || 'Notification'}`);
    remove.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i>';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteNotification(notification.id, remove);
    });

    item.append(open, remove);
    return item;
  }

  function render() {
    if (!list) return;

    const visible =
      state.filter === 'unread' ? unreadItems() : state.notifications;

    list.textContent = '';

    if (!state.loaded) {
      renderEmpty();
      return;
    }

    if (!visible.length) {
      renderEmpty();
    } else {
      visible.forEach((notification) => list.appendChild(buildItem(notification)));
    }

    refreshCounts();
    updateSummary();
  }

  function updateSummary() {
    if (!summary) return;

    if (!state.loaded) {
      summary.textContent = 'Loading notifications…';
      return;
    }

    if (!state.notifications.length) {
      summary.textContent = 'New bookings and reviews will appear here.';
      return;
    }

    const unread = unreadItems().length;
    summary.textContent = unread
      ? `${unread} unread of ${state.notifications.length} notification${
          state.notifications.length === 1 ? '' : 's'
        }.`
      : `${state.notifications.length} notification${
          state.notifications.length === 1 ? '' : 's'
        } in total.`;
  }

  /* ------------------------------------------------------------------------
     Read state
     ------------------------------------------------------------------------ */

  async function markRead(ids) {
    const targets = new Set(ids.map(String));
    const affected = state.notifications.filter((item) => targets.has(String(item.id)) && !item.read);
    if (!affected.length) return;

    state.notifications = state.notifications.map((item) =>
      targets.has(String(item.id)) ? { ...item, read: true } : item
    );
    render();

    try {
      const response = await window.paulinaAdminFetch(apiUrl('/api/notifications/read'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: affected.map((item) => item.id) })
      });

      if (!response.ok) throw new Error(`Mark read failed (${response.status})`);
      window.AdminNotifications?.refreshBadge?.();
    } catch (error) {
      console.warn('[notifications] Could not mark notification as read:', error);
    }
  }

  async function markAllRead() {
    if (state.marking) return;

    const unread = state.notifications.filter((item) => !item.read);
    if (!unread.length) return;

    state.marking = true;
    refreshCounts();

    try {
      const response = await window.paulinaAdminFetch(apiUrl('/api/notifications/read'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unread.map((item) => item.id) })
      });

      if (!response.ok) throw new Error(`Mark read failed (${response.status})`);

      state.notifications = state.notifications.map((item) => ({ ...item, read: true }));
      window.AdminNotifications?.refreshBadge?.();
    } catch (error) {
      console.warn('[notifications] Could not mark notifications as read:', error);
    } finally {
      state.marking = false;
      render();
    }
  }

  /* ------------------------------------------------------------------------
     Open / delete
     ------------------------------------------------------------------------ */

  function findNotification(id) {
    return state.notifications.find((item) => String(item.id) === String(id)) || null;
  }

  function detailPairs(notification) {
    const source = Array.isArray(notification.details) ? notification.details : [];

    return source
      .map((detail) => {
        if (Array.isArray(detail)) {
          return [String(detail[0] || '').trim(), String(detail[1] || '').trim()];
        }
        if (detail && typeof detail === 'object') {
          return [
            String(detail.label || '').trim(),
            String(detail.value || '').trim()
          ];
        }
        return ['', ''];
      })
      .filter(([label, value]) => label && value);
  }

  function openNotification(id, trigger = null) {
    const notification = findNotification(id);
    if (!notification) return;

    state.openId = notification.id;
    lastFocused = trigger || document.activeElement;

    if (modalTitle) modalTitle.textContent = notification.title || 'Notification';
    if (modalMessage) {
      modalMessage.textContent = notification.message || '';
      modalMessage.hidden = !notification.message;
    }

    if (modalIcon) {
      modalIcon.innerHTML = `<i class="ph ${
        notification.type === 'review' ? 'ph-star' : 'ph-calendar-check'
      }" aria-hidden="true"></i>`;
      modalIcon.classList.toggle('is-review', notification.type === 'review');
    }

    if (modalMeta) {
      modalMeta.textContent = '';
      const created = document.createElement('span');
      created.textContent = formatTimestamp(notification.createdAt);
      modalMeta.appendChild(created);

      if (notification.reference) {
        const reference = document.createElement('span');
        reference.textContent = notification.reference;
        modalMeta.appendChild(reference);
      }

      if (notification.customerName) {
        const customer = document.createElement('span');
        customer.textContent = notification.customerName;
        modalMeta.appendChild(customer);
      }
    }

    if (modalDetails) {
      modalDetails.textContent = '';
      const rows = detailPairs(notification);

      rows.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'notification-detail-row';

        const term = document.createElement('dt');
        term.textContent = label;

        const description = document.createElement('dd');
        description.textContent = value;

        row.append(term, description);
        modalDetails.appendChild(row);
      });

      modalDetails.hidden = rows.length === 0;
    }

    if (modalLink) {
      const canOpenBooking =
        notification.type === 'booking' && notification.reference;
      modalLink.hidden = !canOpenBooking;
      if (canOpenBooking) {
        modalLink.href = `custom-requests.html?reference=${encodeURIComponent(
          notification.reference
        )}`;
      }
    }

    if (modalDelete) {
      modalDelete.disabled = false;
      modalDelete.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i> Delete';
    }

    if (modal) {
      modal.hidden = false;
      modal.classList.add('is-open');
    }
    document.body.classList.add('notification-modal-open');
    modalDialog?.focus?.({ preventScroll: true });

    if (!notification.read) markRead([notification.id]);
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.hidden = true;
    document.body.classList.remove('notification-modal-open');
    state.openId = null;
    lastFocused?.focus?.({ preventScroll: true });
  }

  async function deleteNotification(id, trigger = null) {
    if (state.deleting) return;

    const notification = findNotification(id);
    if (!notification) return;

    const label = notification.title || 'this notification';
    const message = `Delete "${label}"? This cannot be undone.`;
    const confirmed = window.PaulinaNotice?.confirm
      ? await window.PaulinaNotice.confirm({
          title: 'Delete this notification?',
          message,
          confirmLabel: 'Delete',
          cancelLabel: 'Keep',
          tone: 'danger'
        })
      : window.confirm(message);

    if (!confirmed) return;

    state.deleting = true;
    if (trigger) {
      trigger.disabled = true;
      trigger.classList.add('is-busy');
    }

    try {
      const response = await window.paulinaAdminFetch(apiUrl(`/api/notifications/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Delete failed (${response.status})`);
      }

      state.notifications = state.notifications.filter(
        (item) => String(item.id) !== String(id)
      );

      if (state.openId && String(state.openId) === String(id)) {
        closeModal();
      }

      window.AdminNotifications?.refreshBadge?.();
      render();
    } catch (error) {
      console.warn('[notifications] Could not delete notification:', error);
      const message = 'This notification could not be deleted. Please try again.';
      if (window.PaulinaNotice?.show) {
        await window.PaulinaNotice.show({
          title: 'Could not delete',
          message,
          tone: 'danger',
          icon: 'ph-warning-circle'
        });
      } else {
        window.alert(message);
      }
    } finally {
      state.deleting = false;
      if (trigger) {
        trigger.disabled = false;
        trigger.classList.remove('is-busy');
      }
    }
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  async function load() {
    try {
      const response = await window.paulinaAdminFetch(apiUrl('/api/notifications?limit=50'), {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });

      if (!response.ok) throw new Error(`Notifications request failed (${response.status})`);

      const data = await response.json();
      state.notifications = Array.isArray(data.notifications) ? data.notifications : [];
      state.loaded = true;
      render();
    } catch (error) {
      state.loaded = true;
      if (summary) summary.textContent = 'Notifications could not be loaded.';
      console.warn('[notifications] Could not load notifications:', error);
      render();
    }
  }

  document.querySelectorAll('.notifications-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.filter = tab.dataset.filter === 'unread' ? 'unread' : 'all';

      document.querySelectorAll('.notifications-tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });

      render();
    });
  });

  markAllButton?.addEventListener('click', markAllRead);

  modalClose?.addEventListener('click', closeModal);
  modalDone?.addEventListener('click', closeModal);

  modalDelete?.addEventListener('click', () => {
    if (state.openId) deleteNotification(state.openId, modalDelete);
  });

  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) closeModal();
  });

  if (typeof window !== 'undefined' && window.paulinaSupabase) {
    try {
      window.paulinaSupabase
        .channel('admin-notifications-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
          load();
        })
        .subscribe();
    } catch (e) {
      console.warn('[notifications] Realtime error:', e);
    }
  }

  window.setInterval(() => { if (!document.hidden && !state.openId && !state.marking && !state.deleting) load(); }, 5000);
  load();
})();
