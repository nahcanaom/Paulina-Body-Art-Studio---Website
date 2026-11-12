/**
 * PAULINA BODY ART STUDIO - SHARED DIALOG CONTROLLER
 *
 * A small, framework-free implementation of the WAI-ARIA "Dialog (Modal)"
 * pattern, shared by every page that shows a modal overlay.
 *
 * Responsibilities (single):
 *   - Opening / closing the overlay and plumbing the a11y attributes.
 *   - Locking background scroll while open.
 *   - Returning focus to the element that opened the dialog.
 *   - Closing on Escape, backdrop click and [data-dialog-close] buttons.
 *
 * It deliberately knows nothing about piercing data, bookings or pages:
 * callers pass in the overlay element and an optional `onOpen` hook that
 * fills the dialog with content (Open/Closed principle).
 *
 * Usage:
 *   const dialog = createDialog({
 *     overlay: document.getElementById('imageModal'),
 *     closeButtons: '[data-dialog-close]',
 *     className: 'active',
 *   });
 *   dialog.open({ onOpen: () => { ... }, trigger, returnFocus: true });
 *   dialog.close();
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const DEFAULT_CLOSE_SELECTOR = '[data-dialog-close]';

/**
 * Creates a dialog controller bound to a single overlay element.
 *
 * @param {Object}        options
 * @param {HTMLElement}   options.overlay      The fixed overlay element.
 * @param {string}        [options.selector]   Selector for the dialog box inside the overlay.
 * @param {string}        [options.closeButtons] Selector for elements that close the dialog.
 * @param {string}        [options.className]  Class toggled on the overlay while open.
 * @param {string}        [options.bodyClass]  Class toggled on <body> while open.
 * @param {Function}      [options.onOpen]     Called before the overlay becomes visible.
 * @param {Function}      [options.onClose]    Called after the dialog has closed.
 * @param {boolean}       [options.trapFocus]  Keep Tab / Shift+Tab inside the dialog.
 * @returns {Object|null} The controller, or null when there is no overlay.
 */
export const createDialog = ({
  overlay,
  selector = '[role="dialog"]',
  closeButtons = DEFAULT_CLOSE_SELECTOR,
  className = 'active',
  bodyClass = 'dialog-open',
  onOpen,
  onClose,
  trapFocus = true,
} = {}) => {
  if (!overlay) return null;

  const dialogBox = overlay.querySelector(selector) || overlay;
  let trigger = null;
  let shouldReturnFocus = false;

  const isOpen = () => overlay.classList.contains(className);

  const getFocusableElements = () => Array.from(dialogBox.querySelectorAll(FOCUSABLE_SELECTOR));

  const lockScroll = (locked) => {
    document.body.classList.toggle(bodyClass, locked);
    document.body.style.overflow = locked ? 'hidden' : '';
  };

  const open = ({ trigger: opener = null, onOpen: openHook, returnFocus = true } = {}) => {
    if (isOpen()) return;

    trigger = opener || document.activeElement;
    shouldReturnFocus = returnFocus;

    (openHook || onOpen)?.({ dialog: dialogBox, overlay });

    overlay.classList.add(className);
    overlay.setAttribute('aria-hidden', 'false');
    lockScroll(true);

    (dialogBox.querySelector('[autofocus]') || getFocusableElements()[0] || dialogBox).focus({
      preventScroll: true,
    });
  };

  const close = ({ restoreFocus = shouldReturnFocus } = {}) => {
    if (!isOpen()) return;

    overlay.classList.remove(className);
    overlay.setAttribute('aria-hidden', 'true');
    lockScroll(false);

    if (restoreFocus && trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
    }

    trigger = null;
    shouldReturnFocus = false;
    onClose?.({ dialog: dialogBox, overlay });
  };

  /* --- Wiring: every listener is bound once, at construction time. ------- */

  overlay.querySelectorAll(closeButtons).forEach((button) => {
    button.addEventListener('click', () => close());
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    // Focus trap: keep Tab / Shift+Tab inside the dialog.
    if (!trapFocus || event.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !dialogBox.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogBox.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });

  return { open, close, isOpen, element: overlay, dialog: dialogBox };
};

/**
 * Makes any element behave like a native button for pointer + keyboard users
 * (Enter / Space), so cards do not need duplicate open handlers.
 *
 * @param {HTMLElement} element
 * @param {Function}    activate
 */
export const makeActivatable = (element, activate) => {
  element.addEventListener('click', () => activate(element));
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(element);
    }
  });
};
