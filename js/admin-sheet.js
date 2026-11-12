/**
 * PAULINA BODY ART STUDIO — MOBILE BOTTOM SHEET CONTROLLER
 *
 * Turns the admin side panels into thumb-driven bottom sheets on small screens
 * without changing how they behave on desktop.
 *
 * Markup contract:
 *   <aside id="myPanel" data-sheet="myPanel"> ... </aside>
 *   <div data-sheet-backdrop="myPanel"></div>
 *
 * Optional children inside the sheet:
 *   [data-sheet-grip]  Swipeable grab area.
 *   [data-sheet-close] Any control that dismisses the sheet.
 *
 * API:
 *   window.AdminSheet.open('myPanel', { trigger })
 *   window.AdminSheet.close('myPanel')
 *   window.AdminSheet.isMobile()
 */
(function () {
  'use strict';

  var MOBILE_QUERY = '(max-width: 720px)';
  var mql = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
  var sheets = new Map();
  var initialised = false;

  function isMobile() {
    return mql ? mql.matches : window.innerWidth <= 720;
  }

  function isOpen(sheet) {
    return Boolean(sheet && sheet.isOpen);
  }

  function openSheetList() {
    return Array.from(sheets.values()).filter(isOpen);
  }

  function hideForAssistiveTech(sheet) {
    sheet.element.setAttribute('aria-hidden', 'true');
    sheet.element.setAttribute('inert', '');
  }

  function showForAssistiveTech(sheet) {
    sheet.element.removeAttribute('aria-hidden');
    sheet.element.removeAttribute('inert');
  }

  function markAsModal(sheet, active) {
    if (active) {
      if (!sheet.element.hasAttribute('data-sheet-base-role')) {
        sheet.element.setAttribute(
          'data-sheet-base-role',
          sheet.element.getAttribute('role') || ''
        );
      }
      sheet.element.setAttribute('role', 'dialog');
      sheet.element.setAttribute('aria-modal', 'true');
      return;
    }

    var baseRole = sheet.element.getAttribute('data-sheet-base-role');
    if (baseRole) sheet.element.setAttribute('role', baseRole);
    else sheet.element.removeAttribute('role');

    sheet.element.removeAttribute('aria-modal');
    sheet.element.removeAttribute('data-sheet-base-role');
  }

  /**
   * Open a panel sheet. No-op above the mobile breakpoint, where the panel is
   * already visible in the page layout.
   */
  function open(id, options) {
    var sheet = sheets.get(id);
    if (!sheet || !isMobile()) return false;

    // Only one sheet is ever open, so the backdrop stack stays predictable.
    openSheetList().forEach(function (other) {
      if (other !== sheet) close(other.element.id, { restoreFocus: false });
    });

    sheet.trigger =
      (options && options.trigger) || document.activeElement || sheet.trigger || null;

    sheet.isOpen = true;
    sheet.element.classList.add('is-open');
    showForAssistiveTech(sheet);
    markAsModal(sheet, true);

    if (!sheet.element.hasAttribute('tabindex')) {
      sheet.element.setAttribute('tabindex', '-1');
    }

    if (sheet.backdrop) {
      sheet.backdrop.classList.add('is-open');
      sheet.backdrop.removeAttribute('aria-hidden');
    }

    document.body.classList.add('sheet-open');

    var focusTarget = sheet.element.querySelector(
      '[data-sheet-close], [data-autofocus], input:not([type="hidden"]), select, textarea, button, a[href]'
    );

    window.requestAnimationFrame(function () {
      (focusTarget || sheet.element).focus({ preventScroll: true });
    });

    return true;
  }

  /**
   * Close a panel sheet and, when possible, return focus to its trigger.
   */
  function close(id, options) {
    var sheet = sheets.get(id);
    if (!sheet || !sheet.isOpen) return;

    var restoreFocus = !options || options.restoreFocus !== false;
    var trigger = sheet.trigger;

    sheet.isOpen = false;
    sheet.trigger = null;
    sheet.element.classList.remove('is-open');
    sheet.element.style.removeProperty('transform');

    if (sheet.backdrop) {
      sheet.backdrop.classList.remove('is-open');
      sheet.backdrop.setAttribute('aria-hidden', 'true');
    }

    // Keep hidden sheets out of the tab order / accessibility tree on mobile.
    if (isMobile()) hideForAssistiveTech(sheet);
    markAsModal(sheet, false);

    if (!openSheetList().length) {
      document.body.classList.remove('sheet-open');
    }

    if (restoreFocus && trigger && trigger.isConnected) {
      trigger.focus({ preventScroll: true });
    }
  }

  /**
   * Swipe the grab handle down to dismiss, with velocity + distance guards so
   * a slow small movement snaps back instead of closing.
   */
  function bindSwipe(sheet, grip) {
    var startY = 0;
    var deltaY = 0;
    var startedAt = 0;
    var dragging = false;

    grip.addEventListener('pointerdown', function (event) {
      if (!isOpen(sheet) || event.button > 0) return;

      dragging = true;
      startY = event.clientY;
      deltaY = 0;
      startedAt = performance.now();
      sheet.element.style.transition = 'none';

      if (grip.setPointerCapture) {
        try {
          grip.setPointerCapture(event.pointerId);
        } catch (error) {
          /* Pointer capture is an enhancement; ignore if unavailable. */
        }
      }
    });

    grip.addEventListener('pointermove', function (event) {
      if (!dragging) return;

      deltaY = Math.max(0, event.clientY - startY);
      sheet.element.style.transform = 'translateY(' + deltaY + 'px)';
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;

      var elapsed = Math.max(1, performance.now() - startedAt);
      var velocity = deltaY / elapsed;
      var shouldClose = deltaY > 110 || (deltaY > 36 && velocity > 0.55);

      sheet.element.style.transition = '';

      if (shouldClose) {
        close(sheet.element.id);
      } else {
        sheet.element.style.removeProperty('transform');
      }

      deltaY = 0;
    }

    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
    grip.addEventListener('lostpointercapture', endDrag);
  }

  /**
   * Keep panel state in sync with the viewport: hidden sheets on mobile,
   * ordinary in-page panels on desktop.
   */
  function syncViewport() {
    if (isMobile()) {
      sheets.forEach(function (sheet) {
        if (!sheet.isOpen) {
          hideForAssistiveTech(sheet);
        }

        if (sheet.backdrop) {
          sheet.backdrop.setAttribute('aria-hidden', 'true');
        }
      });
      return;
    }

    sheets.forEach(function (sheet) {
      sheet.isOpen = false;
      sheet.trigger = null;
      sheet.element.classList.remove('is-open');
      sheet.element.style.removeProperty('transform');
      showForAssistiveTech(sheet);
      markAsModal(sheet, false);

      if (sheet.backdrop) {
        sheet.backdrop.classList.remove('is-open');
        sheet.backdrop.removeAttribute('aria-hidden');
      }
    });

    document.body.classList.remove('sheet-open');
  }

  function init() {
    if (initialised) return;
    initialised = true;

    document.querySelectorAll('[data-sheet]').forEach(function (element) {
      var id = element.id;
      if (!id) return;

      var sheet = {
        element: element,
        backdrop: document.querySelector('[data-sheet-backdrop="' + id + '"]'),
        trigger: null,
        isOpen: false
      };

      sheets.set(id, sheet);

      element.querySelectorAll('[data-sheet-close]').forEach(function (button) {
        button.addEventListener('click', function () {
          close(id);
        });
      });

      if (sheet.backdrop) {
        sheet.backdrop.addEventListener('click', function () {
          close(id);
        });
      }

      var grip = element.querySelector('[data-sheet-grip]');
      if (grip) bindSwipe(sheet, grip);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;

      // A dialog stacked above a sheet owns the Escape key: let its own
      // controller close it without also dismissing the sheet underneath.
      var modalAbove = Array.prototype.some.call(
        document.querySelectorAll('.dialog-overlay.active, .modal-backdrop'),
        function (element) {
          var styles = window.getComputedStyle(element);
          return styles.display !== 'none' && styles.visibility !== 'hidden';
        }
      );
      if (modalAbove) return;

      var openSheets = openSheetList();
      if (!openSheets.length) return;

      event.preventDefault();
      close(openSheets[openSheets.length - 1].element.id);
    });

    if (mql) {
      if (mql.addEventListener) mql.addEventListener('change', syncViewport);
      else if (mql.addListener) mql.addListener(syncViewport);
    }

    syncViewport();
  }

  window.AdminSheet = {
    open: open,
    close: close,
    isMobile: isMobile
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
