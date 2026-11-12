/**
 * PAULINA BODY ART STUDIO — "THIS PHOTO CAN BE VIEWED" AFFORDANCE
 * ============================================================================
 * Every photo on the public site that opens something (a preview modal, the
 * product dialog, a full-size file) carries a persistent badge in its corner.
 * The badge is what tells touch users the image is tappable, since hover
 * states do not exist on a phone.
 *
 * The gallery keeps its own richer version (expand badge + "Tap to view"
 * caption inside the card footer), so bento cards are skipped here.
 *
 * The whole thing is delegated and re-runs whenever the site content or a
 * filtered list is re-rendered, which is what keeps dashboard-driven images
 * (promotions, studio shots, artists, favourites, catalogue) covered too.
 */

import { openPhoto } from './photo-viewer.js';

const VIEW_TARGETS = [
  '.promo-slide',            // hero promotion cards (dashboard banners)
  '.pricelist-container',    // piercing price list image
  '.zoom-card',              // studio + service photos (dashboard images)
  '.artist-card',            // home artist portraits (dashboard images)
  '.artist-image-wrapper',   // artist page portrait
  '.piercing-card',          // artist page favourite works (dashboard images)
  '.hero-artwork',           // aftercare hero photograph
  'a.square-image',          // aftercare guide links (only real links)
  '.product-media',          // catalogue product photos
  '[data-view-photo]'        // client review photos
];

const PHOTO_TRIGGER_SELECTOR = '[data-view-photo]';
const TARGET_SELECTOR = VIEW_TARGETS.join(',');
const BADGE_CLASS = 'media-view-badge';

function isGalleryCard(element) {
  return Boolean(element.closest('.bento-card'));
}

/**
 * Targets that flow in a grid keep their own position; only static boxes need
 * `position: relative` so the badge anchors to the photo.
 */
function ensurePositioned(target) {
  if (window.getComputedStyle(target).position === 'static') {
    target.classList.add('media-view-target--static');
  }
}

function addBadge(target) {
  if (!target || target.dataset.viewBadge === 'true') return;
  if (isGalleryCard(target)) return;

  // Nothing to view: an empty or broken image, or a catalogue placeholder.
  if (!target.querySelector('img')) return;
  if (target.classList.contains('media-missing')) return;

  target.dataset.viewBadge = 'true';
  target.classList.add('media-view-target');
  ensurePositioned(target);

  const badge = document.createElement('span');
  badge.className = BADGE_CLASS;
  badge.setAttribute('aria-hidden', 'true');
  badge.innerHTML = '<i class="ph ph-arrows-out-simple"></i>';
  target.appendChild(badge);
}

function decorate(root = document) {
  root.querySelectorAll(TARGET_SELECTOR).forEach(addBadge);
}

/* -------------------------------------------------------------------------
   REVIEW PHOTOS
   Client-uploaded review photos have no viewer of their own on the reviews
   page, so they open in the shared gallery-style viewer.
   ------------------------------------------------------------------------- */

function hydratePhotoTriggers(root = document) {
  root.querySelectorAll(PHOTO_TRIGGER_SELECTOR).forEach((trigger) => {
    if (trigger.dataset.viewPhotoWired === 'true') return;
    trigger.dataset.viewPhotoWired = 'true';
    trigger.classList.add('media-view-target');
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    if (!trigger.getAttribute('aria-label')) {
      trigger.setAttribute(
        'aria-label',
        trigger.dataset.viewTitle ? `View ${trigger.dataset.viewTitle}` : 'View attached photo'
      );
    }
    ensurePositioned(trigger);
  });
}

function openReviewPhoto(trigger) {
  const image = trigger.querySelector('img');
  openPhoto({
    src: image?.currentSrc || image?.src || '',
    alt: image?.alt || 'Attached photo',
    title: trigger.dataset.viewTitle || 'Review photo',
    caption: trigger.dataset.viewCaption || 'Attached to a client review',
    description: trigger.dataset.viewDesc || '',
    trigger,
  });
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest(PHOTO_TRIGGER_SELECTOR);
  if (!trigger) return;
  // The photo sits inside a clickable review card on the home page; viewing
  // the photo must not also open the review detail dialog.
  event.preventDefault();
  event.stopPropagation();

  openReviewPhoto(trigger);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const trigger = event.target.closest?.(PHOTO_TRIGGER_SELECTOR);
  if (!trigger) return;
  event.preventDefault();
  openReviewPhoto(trigger);
});

/* -------------------------------------------------------------------------
   BOOT + RE-RUNS
   ------------------------------------------------------------------------- */

let scheduled = 0;

function refresh() {
  window.cancelAnimationFrame(scheduled);
  scheduled = window.requestAnimationFrame(() => {
    hydratePhotoTriggers();
    decorate();
  });
}

function init() {
  refresh();

  // Dashboard content and filtered grids replace their children, so new photos
  // are decorated as soon as they land.
  const observer = new MutationObserver((mutations) => {
    const hasNewNodes = mutations.some((mutation) => mutation.addedNodes.length > 0);
    if (hasNewNodes) refresh();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('paulina:content-updated', refresh);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
