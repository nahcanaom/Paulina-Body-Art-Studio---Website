/**
 * ============================================================================
 * HOME REVIEW SLIDESHOW — CONTINUOUS SCROLL
 * ============================================================================
 *
 * The review cards drift from right to left without stopping: there is no
 * interval, no per-slide timer and no dwell between slides. One animation
 * frame advances the track by `speed * elapsed` pixels, so the motion is
 * perfectly even at any refresh rate.
 *
 * The loop is seamless because cards are cloned onto the end of the track.
 * Once the track has moved a full lap of the real cards, the offset is
 * shifted back by exactly one lap inside the same frame — the cloned cards
 * that were on screen are replaced by the identical real cards, so nothing
 * visibly jumps and there is never a gap.
 *
 * Interaction:
 * - Drag with mouse or touch: the track follows the pointer and keeps
 *   drifting from wherever it is released (no snap, no pause).
 * - Hovering or keyboard focus pauses the drift, and it resumes instantly on
 *   leave, as before.
 * - A newly posted review re-renders the track; the loop re-measures itself.
 */

const DEFAULT_SPEED_PX_PER_SECOND = 40;
// Movement before a press is treated as a drag rather than a click.
const DRAG_START_THRESHOLD = 6;
// Movement after which the click that ends a drag is swallowed.
const DRAG_CLICK_THRESHOLD = 8;
// Resistance applied when pulling backwards past the first card.
const RUBBER_BAND = 0.35;
// A background tab hands back very large time deltas; cap them so the track
// does not lurch forward when the page becomes visible again.
const MAX_FRAME_MS = 64;
// Reduced motion keeps the drift but slows it right down.
const REDUCED_MOTION_SPEED_FACTOR = 0.35;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createReviewSlideshow({
  root,
  viewport,
  track,
  pixelsPerSecond = DEFAULT_SPEED_PX_PER_SECOND
} = {}) {
  if (!root || !viewport || !track) {
    return { refresh() {}, destroy() {} };
  }

  const controller = new AbortController();
  const { signal } = controller;

  const speed = prefersReducedMotion()
    ? pixelsPerSecond * REDUCED_MOTION_SPEED_FACTOR
    : pixelsPerSecond;

  let offset = 0;
  let step = 0;
  let gap = 0;
  let visibleCount = 1;
  let maxIndex = 0;
  let realCount = 0;
  let expectedClones = 0;
  let loopWidth = 0;
  let frame = 0;
  let lastFrameTime = 0;
  let lastPage = -1;
  let hovered = false;
  let focusWithin = false;

  // Drag state.
  let dragging = false;
  let pointerId = null;
  let lastPointerX = 0;
  let startPointerX = 0;
  let startPointerY = 0;
  let dragAxis = null;
  let suppressClick = false;

  // The transform is written every frame, so CSS easing would fight it.
  track.style.transition = 'none';

  // Clones are extra cards appended for the loop; they are never part of the
  // data set, the slide count, or the keyboard order.
  const realCards = () => [...track.querySelectorAll('.review-card:not([data-carousel-clone])')];
  const cloneCards = () => [...track.querySelectorAll('[data-carousel-clone]')];

  /* -----------------------------------------------------------------------
     Position
     ----------------------------------------------------------------------- */

  function paintOffset(value) {
    offset = value;
    track.style.transform = `translate3d(${offset.toFixed(2)}px, 0, 0)`;

    if (step <= 0) return;
    const page = Math.min(maxIndex, Math.max(0, Math.round(-offset / step)));
    if (page !== lastPage) {
      lastPage = page;
      root.dataset.carouselIndex = String(page);
    }
  }

  // Moving forwards past a full lap wraps to the identical start of the lap.
  // Backwards is bounded at the first card, where the drag rubber-bands.
  function wrapOffset(value) {
    if (loopWidth <= 0) return 0;

    let next = value;
    while (next <= -loopWidth) next += loopWidth;
    return Math.min(next, 0);
  }

  /* -----------------------------------------------------------------------
     Measuring, clones
     ----------------------------------------------------------------------- */

  function syncClones() {
    const cards = realCards();
    // One page beyond the visible window, so the right edge of the viewport is
    // still covered when the track sits at the very end of its lap.
    const needed = loopWidth > 0 ? Math.min(visibleCount + 1, cards.length) : 0;
    expectedClones = needed;

    if (cloneCards().length === needed) return;

    cloneCards().forEach((clone) => clone.remove());

    for (let i = 0; i < needed; i += 1) {
      const clone = cards[i].cloneNode(true);
      clone.dataset.carouselClone = 'true';
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('tabindex', '-1');
      track.append(clone);
    }
  }

  function measure() {
    const cards = realCards();
    const width = viewport.clientWidth;
    const styles = window.getComputedStyle(track);
    const parsedGap = parseFloat(styles.columnGap || styles.gap || '0');
    gap = Number.isFinite(parsedGap) ? parsedGap : 0;
    realCount = cards.length;

    if (!cards.length || width <= 0) {
      visibleCount = 1;
      step = 0;
      maxIndex = 0;
      loopWidth = 0;
      syncClones();
      return;
    }

    const perView = width >= 1040 ? 3 : width >= 720 ? 2 : 1;
    // With fewer cards than the layout allows, let them fill the row instead
    // of leaving dead space on the right.
    visibleCount = Math.min(perView, cards.length);
    const slideWidth = (width - gap * (visibleCount - 1)) / visibleCount;

    track.style.setProperty('--review-slide-width', `${slideWidth.toFixed(2)}px`);
    step = slideWidth + gap;
    maxIndex = Math.max(0, cards.length - visibleCount);
    loopWidth = maxIndex > 0 ? cards.length * step : 0;
    syncClones();
  }

  function refresh() {
    measure();

    if (maxIndex <= 0) {
      paintOffset(0);
    } else {
      paintOffset(wrapOffset(offset));
    }

    root.dataset.carouselPages = String(maxIndex + 1);
    root.dataset.carouselCards = String(realCount);
  }

  /* -----------------------------------------------------------------------
     The drift
     ----------------------------------------------------------------------- */

  function canDrift() {
    return loopWidth > 0 && !hovered && !focusWithin && !dragging && !document.hidden;
  }

  function tick(now) {
    frame = window.requestAnimationFrame(tick);

    const previous = lastFrameTime;
    lastFrameTime = now;

    // First frame only establishes the clock.
    if (!previous) return;
    if (!canDrift()) return;

    const delta = Math.min(MAX_FRAME_MS, Math.max(0, now - previous));
    if (!delta) return;

    paintOffset(wrapOffset(offset - (speed * delta) / 1000));
  }

  /* -----------------------------------------------------------------------
     Drag (mouse + touch) and keyboard
     ----------------------------------------------------------------------- */

  function endDrag() {
    if (!dragging) return;

    dragging = false;
    dragAxis = null;
    root.classList.remove('is-grabbing');

    if (pointerId !== null) {
      try {
        if (viewport.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
      } catch {
        /* capture may already be gone */
      }
    }
    pointerId = null;
  }

  viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (loopWidth <= 0) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      dragging = true;
      pointerId = event.pointerId;
      startPointerX = event.clientX;
      startPointerY = event.clientY;
      lastPointerX = event.clientX;
      dragAxis = null;
      suppressClick = false;

      // Pointer capture is deliberately NOT taken here. Capturing on press
      // retargets the compatibility `click` of a plain tap to the capturing
      // element (the viewport), so the card's delegated click handler never
      // runs and the review modal never opens. Capture begins once a
      // horizontal drag passes the click threshold instead.
    },
    { signal }
  );

  viewport.addEventListener(
    'pointermove',
    (event) => {
      if (!dragging || event.pointerId !== pointerId) return;

      const dx = event.clientX - startPointerX;
      const dy = event.clientY - startPointerY;

      if (!dragAxis) {
        if (Math.abs(dx) < DRAG_START_THRESHOLD && Math.abs(dy) < DRAG_START_THRESHOLD) return;
        dragAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';

        if (dragAxis === 'x') {
          root.classList.add('is-grabbing');
          lastPointerX = event.clientX;
        } else {
          // Vertical intent on touch: hand the gesture back to the page.
          endDrag();
          return;
        }
      }

      if (dragAxis !== 'x') return;

      if (event.cancelable) event.preventDefault();

      const movement = event.clientX - lastPointerX;
      lastPointerX = event.clientX;
      if (Math.abs(dx) > DRAG_CLICK_THRESHOLD && !suppressClick) {
        suppressClick = true;
        try {
          viewport.setPointerCapture(pointerId);
        } catch {
          /* capture is best-effort */
        }
      }

      let next = offset + movement;
      if (next > 0) {
        // Pulling backwards past the first card resists instead of wrapping.
        next *= RUBBER_BAND;
      } else {
        next = wrapOffset(next);
      }
      paintOffset(next);
    },
    { signal }
  );

  // Releases are watched on the window: a fast drag can leave the viewport
  // before capture is taken, and a stuck `dragging` flag would freeze the
  // drift. Both handlers are guarded by the drag state, so they are idempotent.
  window.addEventListener(
    'pointerup',
    (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const wasHorizontal = dragAxis === 'x';
      endDrag();

      // Release any rubber-banded overshoot; otherwise the drift simply
      // continues from where the pointer left it.
      if (wasHorizontal && offset > 0) paintOffset(0);
    },
    { signal }
  );

  window.addEventListener(
    'pointercancel',
    () => {
      if (!dragging) return;
      endDrag();
      if (offset > 0) paintOffset(0);
    },
    { signal }
  );

  // A drag ends with a click on whatever card the pointer finished over; that
  // click must not open the review modal. It is listened for on the viewport
  // because a captured drag reports its click on the capture element.
  viewport.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, signal }
  );

  // Native image dragging would steal the gesture from the pointer handlers.
  track.addEventListener('dragstart', (event) => event.preventDefault(), { signal });

  viewport.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        paintOffset(wrapOffset(offset - step));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        paintOffset(Math.min(0, offset + step));
      }
    },
    { signal }
  );

  /* -----------------------------------------------------------------------
     Pause / resume triggers
     ----------------------------------------------------------------------- */

  root.addEventListener(
    'mouseenter',
    () => {
      hovered = true;
    },
    { signal }
  );

  root.addEventListener(
    'mouseleave',
    () => {
      hovered = false;
      // Resuming must not credit the time spent hovering.
      lastFrameTime = 0;
    },
    { signal }
  );

  root.addEventListener(
    'focusin',
    (event) => {
      let keyboardFocus = false;
      try {
        keyboardFocus = event.target.matches(':focus-visible');
      } catch {
        keyboardFocus = false;
      }
      if (!keyboardFocus) return;

      focusWithin = true;

      // Bring an off-window card into view when it receives focus.
      const card = event.target.closest?.('.review-card');
      if (!card || card.hasAttribute('data-carousel-clone') || step <= 0) return;

      const cardIndex = realCards().indexOf(card);
      if (cardIndex < 0) return;

      const first = -offset / step;
      if (cardIndex < first || cardIndex > first + visibleCount - 1) {
        paintOffset(wrapOffset(-(cardIndex * step)));
      }
    },
    { signal }
  );

  root.addEventListener(
    'focusout',
    (event) => {
      if (root.contains(event.relatedTarget)) return;
      focusWithin = false;
      lastFrameTime = 0;
    },
    { signal }
  );

  /* -----------------------------------------------------------------------
     Responsive + dynamic structure
     ----------------------------------------------------------------------- */

  let resizeFrame = 0;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (dragging) return;

      // Keep the same card under the left edge across a layout change.
      const previousStep = step;
      const anchor = previousStep > 0 ? -offset / previousStep : 0;
      measure();
      paintOffset(wrapOffset(step > 0 ? -(anchor * step) : 0));
      root.dataset.carouselPages = String(maxIndex + 1);
      root.dataset.carouselCards = String(realCount);
    });
  });
  resizeObserver.observe(viewport);

  // A newly posted review re-renders the track. Watching it means the slide
  // widths, clone count, lap length and loop all follow the data.
  const mutationObserver = new MutationObserver(() => {
    if (realCards().length !== realCount || cloneCards().length !== expectedClones) {
      refresh();
    }
  });
  mutationObserver.observe(track, { childList: true });

  refresh();
  frame = window.requestAnimationFrame(tick);

  return {
    refresh,
    destroy() {
      endDrag();
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(resizeFrame);
      controller.abort();
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    }
  };
}
