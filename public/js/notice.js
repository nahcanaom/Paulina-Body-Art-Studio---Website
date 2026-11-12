/**
 * PAULINA BODY ART STUDIO — BRANDED NOTICE / CONFIRM DIALOG
 *
 * Replaces native window.confirm / window.alert prompts with a centered,
 * on-brand modal that follows the site's typography and colour palette.
 *
 * Usage:
 *   const ok = await confirmNotice({
 *     title: 'Delete this review?',
 *     message: 'This cannot be undone.',
 *     confirmLabel: 'Delete review',
 *     cancelLabel: 'Keep review',
 *     tone: 'danger'
 *   });
 *
 *   await showNotice({ title: 'Saved', message: 'Your changes were saved.' });
 */

import { createDialog } from '../components/dialog.js';

let overlay = null;
let dialog = null;
let controller = null;
let elements = null;
let activeResolve = null;

function settle(value) {
  if (!activeResolve) return;
  const resolve = activeResolve;
  activeResolve = null;
  resolve(value);
}

function ensureNotice() {
  if (elements) return elements;

  overlay = document.createElement('div');
  overlay.className = 'pa-notice-overlay';
  overlay.id = 'paNoticeOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="pa-notice" role="dialog" aria-modal="true"
         aria-labelledby="paNoticeTitle" aria-describedby="paNoticeMessage">
      <span class="pa-notice-icon" aria-hidden="true"><i class="ph ph-bell-ringing"></i></span>
      <h2 class="pa-notice-title" id="paNoticeTitle"></h2>
      <p class="pa-notice-message" id="paNoticeMessage"></p>
      <div class="pa-notice-actions">
        <button type="button" class="pa-notice-btn pa-notice-btn-secondary" data-notice-cancel>Cancel</button>
        <button type="button" class="pa-notice-btn pa-notice-btn-primary" data-notice-confirm>OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  dialog = overlay.querySelector('.pa-notice');
  elements = {
    overlay,
    dialog,
    icon: overlay.querySelector('.pa-notice-icon'),
    title: overlay.querySelector('.pa-notice-title'),
    message: overlay.querySelector('.pa-notice-message'),
    cancel: overlay.querySelector('[data-notice-cancel]'),
    confirm: overlay.querySelector('[data-notice-confirm]')
  };

  controller = createDialog({
    overlay,
    selector: '.pa-notice',
    className: 'active',
    bodyClass: 'pa-notice-open',
    onClose: () => settle(false)
  });

  elements.cancel.addEventListener('click', () => {
    settle(false);
    controller?.close();
  });

  elements.confirm.addEventListener('click', () => {
    settle(true);
    controller?.close();
  });

  return elements;
}

function openNotice({
  title = 'Notice',
  message = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  tone = 'default',
  icon = ''
} = {}) {
  const ui = ensureNotice();

  // A second notice should never stack on top of an unresolved one.
  if (controller?.isOpen()) controller.close();

  ui.title.textContent = title;
  ui.message.textContent = message;
  ui.confirm.textContent = confirmLabel;
  ui.cancel.textContent = cancelLabel;
  ui.cancel.hidden = !cancelLabel;
  ui.dialog.classList.toggle('is-danger', tone === 'danger');
  ui.icon.className = `pa-notice-icon${tone === 'danger' ? ' is-danger' : ''}`;

  const iconName = icon || (tone === 'danger' ? 'ph-trash' : 'ph-bell-ringing');
  ui.icon.innerHTML = `<i class="ph ${iconName}" aria-hidden="true"></i>`;

  return new Promise((resolve) => {
    activeResolve = resolve;
    controller?.open({ returnFocus: true });
    ui.confirm.focus({ preventScroll: true });
  });
}

/**
 * Centered confirmation modal.
 * Resolves true when confirmed, false when cancelled / dismissed.
 */
export function confirmNotice(options = {}) {
  return openNotice({
    cancelLabel: 'Cancel',
    confirmLabel: 'OK',
    ...options
  });
}

/**
 * Centered information modal with a single acknowledgement button.
 */
export function showNotice(options = {}) {
  return openNotice({
    cancelLabel: '',
    confirmLabel: 'OK',
    ...options
  });
}

// Also expose a small global for non-module pages.
window.PaulinaNotice = { confirm: confirmNotice, show: showNotice };
