/* ==========================================================================
   JAVASCRIPT STATE ENGINE — Admin Custom Requests
   ========================================================================== */

import { createDialog } from '../components/dialog.js';
import { confirmNotice, showNotice } from './notice.js';
import { supabase } from './supabase-config.js';

if (supabase) {
  try {
    supabase
      .channel('admin-custom-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_requests' }, () => {
        loadRequests();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        loadRequests();
      })
      .subscribe();
  } catch (err) {
    console.warn('[custom-requests] Realtime sync error:', err);
  }
}

const REQUESTS_PATH = '/api/custom-requests';
const API_TIMEOUT_MS = 8000;
// The admin page is often opened through a static server (Live Server) while
// Express starts or restarts in another terminal. These delays reconnect on
// their own so the list fills in without a manual reload.
const AUTO_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000];

// Single source of truth for the page. The tabs are derived views over this
// list, so switching tabs never needs another network request.
const requestState = {
  requests: [],
  tab: 'needs-review',
  selectedReference: null,
  loading: true,
  loadError: '',
  retrying: false,
  detailError: '',
  pendingDecision: false,
  deleting: false
};

let retryTimer = null;
let retryAttempt = 0;

let declineDialog = null;
let referenceLightbox = null;

/* --------------------------------------------------------------------------
   API helpers
   -------------------------------------------------------------------------- */

// Same-origin is tried first. When the admin page is opened through Live Server
// instead of the Express server, fall back to the local API on port 3000.
function getApiEndpoints(path) {
  const { protocol, hostname, port } = window.location;

  if (protocol === 'file:') {
    return [`http://127.0.0.1:3000${path}`];
  }

  const endpoints = [path];

  if (protocol === 'http:' && port !== '3000') {
    endpoints.push(`http://${hostname || '127.0.0.1'}:3000${path}`);
  }

  return [...new Set(endpoints)];
}

async function callRequestsApi(path, options = {}) {
  const endpoints = getApiEndpoints(path);
  let lastError = null;

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const isLastEndpoint = index === endpoints.length - 1;
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      response = await fetch(endpoint, {
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
        method: options.method || 'GET',
        body: options.body,
        signal: controller.signal
      });
    } catch (error) {
      lastError = error;
      continue;
    } finally {
      clearTimeout(timeout);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    // A static host answers unknown API paths with an HTML 404; try the next one.
    if (!contentType.includes('application/json')) {
      lastError = new Error(`No custom request API response at ${endpoint} (HTTP ${response.status}).`);
      if (!isLastEndpoint) continue;
      break;
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      lastError = error;
      if (!isLastEndpoint) continue;
      break;
    }

    // A JSON 404 from Express means the server predates these routes or is
    // still starting, so the generic "API route not found" would hide the
    // real cause.
    if (response.status === 404 && data && typeof data === 'object' && /api route not found/i.test(data.error || '')) {
      data.error = 'The studio server is running an older build. Restart it with "npm start" and this page will reconnect on its own.';
    }

    return {
      ok: response.ok && data.success !== false,
      status: response.status,
      // A missing route, a stub 404 page or a crashed server all mean the API
      // is not ready yet, so trying again in a moment is safe.
      retryable: response.status === 404 || response.status >= 500,
      data
    };
  }

  console.error('Custom request API could not be reached:', lastError);
  return {
    ok: false,
    status: 0,
    retryable: true,
    data: {
      success: false,
      error: 'Could not reach the studio server. Make sure it is running with "npm start".'
    }
  };
}

/* --------------------------------------------------------------------------
   Data helpers
   -------------------------------------------------------------------------- */

function findRequest(reference) {
  return requestState.requests.find((request) => request.reference === reference) || null;
}

function isPendingRequest(request) {
  return request.status !== 'accepted' && request.status !== 'declined';
}

// A booking stays in the review queue until the studio accepts or declines it;
// merely opening a request must never hide it from the queue.
function needsReview(request) {
  return isPendingRequest(request);
}

function getVisibleRequests() {
  if (requestState.tab === 'all') return requestState.requests;
  return requestState.requests.filter(needsReview);
}

function formatTimeAgo(value) {
  const created = new Date(value || '');
  if (Number.isNaN(created.getTime())) return '';

  const minutes = Math.max(0, Math.round((Date.now() - created.getTime()) / 60000));

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}hr ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getClientName(name) {
  return String(name || '').trim() || 'Studio client';
}

/* --------------------------------------------------------------------------
   Rendering — request list
   -------------------------------------------------------------------------- */

function buildRequestCard(request) {
  const card = document.createElement('article');
  card.className = 'request-card';
  card.dataset.reference = request.reference;

  if (request.reference === requestState.selectedReference) {
    card.classList.add('is-active');
  }

  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'request-card-select';
  select.setAttribute('aria-pressed', String(request.reference === requestState.selectedReference));

  const head = document.createElement('span');
  head.className = 'request-card-head';

  const name = document.createElement('span');
  name.className = 'request-card-name';
  name.textContent = getClientName(request.fullName);

  head.append(name);

  const tag = document.createElement('span');
  tag.className = 'request-card-tag';
  tag.textContent = request.placement || request.serviceType || 'Service TBD';

  const service = document.createElement('span');
  service.className = 'request-card-service';
  service.textContent = request.style || request.service || 'Studio appointment';

  select.append(head, tag, service);
  select.addEventListener('click', () => selectRequest(request.reference, card));

  // The timestamp and its trash control live in the right-hand column, so the
  // delete icon sits directly underneath the time and can never be clicked as
  // part of selecting the request.
  const tools = document.createElement('div');
  tools.className = 'request-card-tools';

  const time = document.createElement('span');
  time.className = 'request-card-time';
  time.textContent = formatTimeAgo(request.createdAt);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'request-card-delete';
  remove.title = `Delete ${getClientName(request.fullName)}'s booking`;
  remove.setAttribute('aria-label', remove.title);
  remove.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i>';
  remove.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteBooking(request, remove);
  });

  tools.append(time, remove);
  card.append(select, tools);

  return card;
}

function renderEmptyList(message, { showRetry = false, note = '' } = {}) {
  const empty = document.createElement('div');
  empty.className = 'request-empty';

  const icon = document.createElement('i');
  icon.className = requestState.loadError ? 'ph ph-warning-circle' : 'ph ph-check-circle';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('p');
  text.textContent = message;

  empty.append(icon, text);

  if (note) {
    const noteText = document.createElement('p');
    noteText.className = 'request-empty-note';
    noteText.textContent = note;
    empty.appendChild(noteText);
  }

  if (showRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'request-retry';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => loadRequests({ resetRetries: true }));
    empty.appendChild(retry);
  }

  return empty;
}

function renderTabs() {
  document.getElementById('needsReviewCount').textContent = String(
    requestState.requests.filter(needsReview).length
  );
  document.getElementById('allCount').textContent = String(requestState.requests.length);

  document.querySelectorAll('.request-tab').forEach((tab) => {
    const isActive = tab.dataset.tab === requestState.tab;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
}

function renderList() {
  const list = document.getElementById('requestList');
  if (!list) return;

  renderTabs();
  list.textContent = '';

  if (requestState.loading) {
    list.appendChild(renderEmptyList('Loading requests…'));
    return;
  }

  if (requestState.loadError) {
    list.appendChild(
      renderEmptyList(requestState.loadError, {
        showRetry: true,
        note: requestState.retrying ? 'Reconnecting to the studio server…' : ''
      })
    );
    return;
  }

  const visible = getVisibleRequests();

  if (!visible.length) {
    list.appendChild(
      renderEmptyList(
        requestState.tab === 'needs-review'
          ? 'You are all caught up. No bookings are waiting for a decision.'
          : 'No bookings yet. New requests will appear here.'
      )
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((request) => fragment.appendChild(buildRequestCard(request)));
  list.appendChild(fragment);
}

/* --------------------------------------------------------------------------
   Rendering — request detail
   -------------------------------------------------------------------------- */

function setDetailText(id, value, fallback = '—') {
  const element = document.getElementById(id);
  if (element) element.textContent = value || fallback;
}

function openReferenceLightbox(url, fileName, trigger, label = '') {
  const image = document.getElementById('referenceLightboxImage');
  const caption = document.getElementById('referenceLightboxName');
  const figure = document.getElementById('referenceLightbox')?.querySelector('.lightbox');

  if (image) {
    image.src = url;
    image.alt = label ? `${label}: ${fileName}` : fileName;
  }
  if (caption) caption.textContent = label ? `${label} — ${fileName}` : fileName;
  if (figure) {
    figure.setAttribute(
      'aria-label',
      label ? `${label} preview` : 'Client reference picture'
    );
  }

  referenceLightbox?.open({ trigger });
}

function buildReferenceThumb(url, fileName, { label = '', variant = '' } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `reference-thumb${variant ? ` reference-thumb--${variant}` : ''}`;
  button.title = label ? `View ${label.toLowerCase()} — ${fileName}` : `View ${fileName}`;
  button.setAttribute('aria-label', button.title);

  const image = document.createElement('img');
  image.className = 'reference-thumb-image';
  image.src = url;
  image.alt = label ? `${label}: ${fileName}` : fileName;
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    button.classList.add('is-missing');
    image.remove();
    const missing = document.createElement('span');
    missing.className = 'reference-thumb-fallback';
    missing.textContent = 'Preview unavailable';
    button.prepend(missing);
  });

  const caption = document.createElement('span');
  caption.className = 'reference-thumb-name';
  caption.textContent = fileName;

  button.append(image, caption);
  button.addEventListener('click', () => openReferenceLightbox(url, fileName, button, label));

  return button;
}

// Piercings, standard tattoos and troubleshooting bookings never collect a
// reference picture, so the whole section stays out of their detail panel.
// The service type is checked here as well so a single bad server flag can
// never surface an empty "Client References" block.
function showsReferenceSection(request) {
  const serviceType = String(request.serviceType || '').trim().toLowerCase();

  if (serviceType === 'piercing' || serviceType === 'troubleshooting') return false;
  if (serviceType && serviceType !== 'tattoo') return false;

  return request.isCustomTattoo === true;
}

function renderReferences(request) {
  const section = document.getElementById('detailReferencesSection');
  const container = document.getElementById('detailReferences');
  if (!container) return;

  const showsReferences = showsReferenceSection(request);
  section?.classList.toggle('hidden', !showsReferences);

  container.textContent = '';
  if (!showsReferences) return;

  const urls = Array.isArray(request.referenceUrls) ? request.referenceUrls.filter(Boolean) : [];
  const fileNames = Array.isArray(request.references) ? request.references.filter(Boolean) : [];

  if (!urls.length) {
    const empty = document.createElement('span');
    empty.className = 'reference-chip reference-chip-empty';
    empty.textContent = fileNames.length
      ? `Reference picture unavailable (${fileNames[0]})`
      : 'No reference uploaded';
    container.appendChild(empty);
    return;
  }

  urls.forEach((url, index) => {
    container.appendChild(buildReferenceThumb(url, fileNames[index] || `Reference ${index + 1}`));
  });
}

// Payment proof rides along with every booking (payment step upload), so it is
// shown for any service type, not only custom tattoos.
function renderReceipt(request) {
  const section = document.getElementById('detailReceiptSection');
  const container = document.getElementById('detailReceipt');
  if (!section || !container) return;

  const urls = Array.isArray(request.receiptUrls) ? request.receiptUrls.filter(Boolean) : [];
  const fileName = String(request.receiptName || '').trim();

  section.classList.toggle('hidden', !urls.length && !fileName);
  container.textContent = '';
  if (!urls.length) {
    const empty = document.createElement('span');
    empty.className = 'reference-chip reference-chip-empty';
    empty.textContent = fileName
      ? `Payment proof unavailable (${fileName})`
      : 'No payment proof uploaded';
    container.appendChild(empty);
    return;
  }

  urls.forEach((url, index) => {
    container.appendChild(
      buildReferenceThumb(url, fileName || `Payment proof ${index + 1}`, {
        label: 'Payment proof',
        variant: 'receipt'
      })
    );
  });
}

function getDecisionFeedback(request) {
  const recipient = request.email || 'the customer';

  if (request.status === 'accepted') {
    return {
      isError: request.decisionEmailSent === false,
      message: request.decisionEmailSent === false
        ? `Request accepted, but the confirmation email to ${recipient} could not be sent.${request.decisionEmailError ? ` ${request.decisionEmailError}` : ''}`
        : `Request accepted. A confirmation email was sent to ${recipient}.`
    };
  }

  if (request.status === 'declined') {
    const reason = request.declineReason ? ` Reason: ${request.declineReason}` : '';
    return {
      isError: request.decisionEmailSent === false,
      message: request.decisionEmailSent === false
        ? `Request declined, but the notification email to ${recipient} could not be sent.${request.decisionEmailError ? ` ${request.decisionEmailError}` : ''}${reason}`
        : `Request declined. The client was notified at ${recipient}.${reason}`
    };
  }

  return null;
}

function renderDetail() {
  const emptyState = document.getElementById('detailEmptyState');
  const card = document.getElementById('detailCard');
  const actions = document.getElementById('detailActions');
  const feedback = document.getElementById('detailFeedback');
  if (!emptyState || !card || !actions || !feedback) return;

  const request = requestState.selectedReference
    ? findRequest(requestState.selectedReference)
    : null;

  if (!request) {
    emptyState.classList.remove('hidden');
    card.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  card.classList.remove('hidden');

  setDetailText('detailName', getClientName(request.fullName));
  setDetailText('detailPhone', request.phone);
  setDetailText('detailEmail', request.email);
  setDetailText('detailNotes', request.notes, 'No notes provided.');
  setDetailText('detailSize', request.tattooSize, 'Not specified');
  setDetailText('detailPlacement', request.placement || request.serviceType, 'Not specified');
  setDetailText('detailTime', request.time);
  setDetailText('detailDate', request.date);

  renderReferences(request);
  renderReceipt(request);

  const decision = getDecisionFeedback(request);
  if (decision) {
    feedback.textContent = decision.message;
    feedback.classList.toggle('is-error', decision.isError);
    feedback.classList.remove('hidden');
    actions.classList.add('hidden');
  } else if (requestState.detailError) {
    feedback.textContent = requestState.detailError;
    feedback.classList.add('is-error');
    feedback.classList.remove('hidden');
    actions.classList.remove('hidden');
  } else {
    feedback.textContent = '';
    feedback.classList.add('hidden');
    feedback.classList.remove('is-error');
    actions.classList.remove('hidden');
  }

  const acceptButton = document.getElementById('btnAcceptRequest');
  const declineButton = document.getElementById('btnDeclineRequest');
  if (acceptButton) {
    acceptButton.disabled = requestState.pendingDecision;
    acceptButton.querySelector('span').textContent = requestState.pendingDecision ? 'Sending…' : 'Accept';
  }
  if (declineButton) declineButton.disabled = requestState.pendingDecision;
}

/* --------------------------------------------------------------------------
   Interaction
   -------------------------------------------------------------------------- */

function setTab(tab) {
  if (tab !== 'needs-review' && tab !== 'all') return;
  requestState.tab = tab;
  renderList();
}

function selectRequest(reference, trigger = null) {
  const request = findRequest(reference);
  if (!request) return;

  requestState.selectedReference = reference;
  requestState.detailError = '';
  renderList();
  renderDetail();

  // On phones the detail panel is a bottom sheet. Re-query the freshly
  // rendered card so focus can return to it when the sheet closes.
  const activeCard = document.querySelector(
    `.request-card[data-reference="${reference.replace(/"/g, '\\"')}"]`
  );

  window.AdminSheet?.open('requestDetailSheet', { trigger: activeCard || trigger });
}

function showDetailError(message) {
  requestState.detailError = message;
  renderDetail();
}

async function submitDecision(decision, reason = '') {
  const request = findRequest(requestState.selectedReference);
  if (!request || requestState.pendingDecision) return false;

  requestState.pendingDecision = true;
  requestState.detailError = '';
  renderDetail();

  try {
    const result = await callRequestsApi(
      `${REQUESTS_PATH}/${encodeURIComponent(request.reference)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, reason })
      }
    );

    if (!result.ok || !result.data.request) {
      showDetailError(result.data?.error || 'The decision could not be saved. Please try again.');
      return false;
    }

    Object.assign(request, result.data.request);
    renderList();
    return true;
  } finally {
    requestState.pendingDecision = false;
    renderDetail();
  }
}

// The list is a local projection of the server data, so a successful DELETE
// only needs to drop one item from state and repaint. The active tab is left
// untouched, which lets an admin keep deleting consecutive bookings.
function removeRequestFromState(reference) {
  const index = requestState.requests.findIndex((item) => item.reference === reference);
  if (index === -1) return false;

  requestState.requests.splice(index, 1);

  if (requestState.selectedReference === reference) {
    requestState.selectedReference = null;
    requestState.detailError = '';
  }

  return true;
}

function getDeleteButtons() {
  return Array.from(document.querySelectorAll('#requestList .request-card-delete'));
}

async function deleteBooking(request, button = null) {
  if (!request || requestState.deleting) return;

  const label = getClientName(request.fullName);
  const confirmed = await confirmNotice({
    title: `Delete ${label}'s booking?`,
    message: `Booking ${request.reference} and any pictures uploaded with it will be permanently removed. This cannot be undone.`,
    confirmLabel: 'Delete booking',
    cancelLabel: 'Keep booking',
    tone: 'danger'
  });
  if (!confirmed) return;

  // Remember where the clicked control sat in the list. Once this card is gone
  // the same position holds the next booking, which keeps keyboard focus in a
  // useful place for repeated deletions.
  const buttonIndex = button ? getDeleteButtons().indexOf(button) : -1;

  requestState.deleting = true;
  if (button) {
    button.disabled = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
  }

  try {
    const result = await callRequestsApi(
      `${REQUESTS_PATH}/${encodeURIComponent(request.reference)}`,
      { method: 'DELETE' }
    );

    if (!result.ok) {
      const message = result.data?.error || 'The booking could not be deleted. Please try again.';
      if (requestState.selectedReference === request.reference) {
        showDetailError(message);
      } else {
        await showNotice({
          title: 'Could not delete booking',
          message,
          confirmLabel: 'OK',
          tone: 'danger'
        });
      }
      return;
    }

    const selectedRemoved = requestState.selectedReference === request.reference;
    removeRequestFromState(request.reference);

    if (selectedRemoved) {
      renderDetail();
      window.AdminSheet?.close('requestDetailSheet');
    }

    // Re-render in place, keeping the current tab, filters and scroll position
    // so several bookings can be removed in a row without leaving the page or
    // jumping back to the top of the list.
    const list = document.getElementById('requestList');
    const previousScrollTop = list ? list.scrollTop : 0;
    renderList();
    if (list) list.scrollTop = previousScrollTop;

    if (buttonIndex !== -1) {
      const remainingButtons = getDeleteButtons();
      const nextButton = remainingButtons[Math.min(buttonIndex, remainingButtons.length - 1)];
      nextButton?.focus({ preventScroll: true });
    }
  } finally {
    requestState.deleting = false;
    if (button) {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
    }
  }
}

async function acceptRequest() {
  const request = findRequest(requestState.selectedReference);
  if (!request) return;

  await submitDecision('accept');
}

function openDeclineDialog() {
  const request = findRequest(requestState.selectedReference);
  if (!request || !declineDialog) return;

  const clientName = document.getElementById('declineClientName');
  const reasonField = document.getElementById('declineReason');
  const error = document.getElementById('declineError');

  if (clientName) clientName.textContent = getClientName(request.fullName);
  if (reasonField) {
    reasonField.value = '';
    reasonField.classList.remove('is-error');
  }
  if (error) error.textContent = '';

  declineDialog.open({ trigger: document.getElementById('btnDeclineRequest') });
  reasonField?.focus({ preventScroll: true });
}

async function confirmDecline() {
  const reasonField = document.getElementById('declineReason');
  const error = document.getElementById('declineError');
  const confirmButton = document.getElementById('btnConfirmDecline');
  if (!reasonField || !error || !confirmButton) return;

  const reason = reasonField.value.trim();

  if (!reason) {
    error.textContent = 'Please enter a reason for declining this request.';
    reasonField.classList.add('is-error');
    reasonField.focus({ preventScroll: true });
    return;
  }

  error.textContent = '';
  reasonField.classList.remove('is-error');
  confirmButton.disabled = true;
  confirmButton.textContent = 'Sending…';

  try {
    const saved = await submitDecision('decline', reason);
    if (saved) declineDialog?.close();
  } finally {
    confirmButton.disabled = false;
    confirmButton.textContent = 'Decline & notify client';
  }
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

function clearScheduledRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  requestState.retrying = false;
}

function scheduleRetry() {
  const delay = AUTO_RETRY_DELAYS_MS[retryAttempt];
  if (delay === undefined) return false;

  retryAttempt += 1;
  requestState.retrying = true;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    loadRequests();
  }, delay);

  return true;
}

async function loadRequests({ resetRetries = false } = {}) {
  clearScheduledRetry();
  if (resetRetries) retryAttempt = 0;

  requestState.loading = true;
  requestState.loadError = '';
  renderList();

  const result = await callRequestsApi(REQUESTS_PATH);
  requestState.loading = false;

  if (!result.ok) {
    requestState.loadError = result.data?.error || 'Custom requests could not be loaded.';
    // Reconnect by itself once the studio server comes back up.
    if (result.retryable) scheduleRetry();
    renderList();
    return;
  }

  retryAttempt = 0;
  requestState.requests = Array.isArray(result.data.requests) ? result.data.requests : [];

  // Keep the current selection if it still exists after a reload.
  if (requestState.selectedReference && !findRequest(requestState.selectedReference)) {
    requestState.selectedReference = null;
  }

  renderList();
  renderDetail();

  // Arriving from a notification opens that booking straight away.
  const requestedReference = new URLSearchParams(window.location.search).get('reference');
  if (requestedReference && findRequest(requestedReference)) {
    selectRequest(requestedReference);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  declineDialog = createDialog({
    overlay: document.getElementById('declineDialog'),
    selector: '[role="dialog"]'
  });

  referenceLightbox = createDialog({
    overlay: document.getElementById('referenceLightbox'),
    selector: '[role="dialog"]'
  });

  document.querySelectorAll('.request-tab').forEach((tab) => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });

  document.getElementById('btnAcceptRequest')?.addEventListener('click', acceptRequest);
  document.getElementById('btnDeclineRequest')?.addEventListener('click', openDeclineDialog);
  document.getElementById('btnConfirmDecline')?.addEventListener('click', confirmDecline);
  document.getElementById('declineReason')?.addEventListener('input', (event) => {
    const error = document.getElementById('declineError');
    event.target.classList.remove('is-error');
    if (error) error.textContent = '';
  });

  loadRequests();
});
