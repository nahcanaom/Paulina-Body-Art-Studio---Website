/**
 * PAULINA BODY ART STUDIO - SHARED PHOTO VIEWER
 *
 * One zoom experience for every photo on the public site, styled after the
 * gallery lightbox: a blurred espresso overlay, a deep-cherry card, the photo
 * on top, a serif title, a lowercase caption, an optional description and an
 * optional call to action.
 *
 * Every page used to own a slightly different preview dialog (home's modal,
 * the artist page's book modal, the aftercare <dialog>, the reviews lightbox).
 * They all call this module instead, so the design and the interaction
 * (backdrop click, close button, Escape, focus restoration, scroll lock) are
 * identical everywhere.
 *
 * Usage:
 *   window.paulinaPhotoViewer.open({
 *     src, alt, title, caption, description, ctaLabel, ctaHref, trigger,
 *   });
 */

let viewer = null;
let lastTrigger = null;

const build = () => {
  const overlay = document.createElement('div');
  overlay.className = 'photo-viewer';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="photo-viewer__box" role="dialog" aria-modal="true"
         aria-labelledby="photoViewerTitle" tabindex="-1">
      <button type="button" class="photo-viewer__close" aria-label="Close photo preview">&times;</button>
      <div class="photo-viewer__media">
        <img class="photo-viewer__image" src="" alt="">
      </div>
      <h3 class="photo-viewer__title" id="photoViewerTitle"></h3>
      <p class="photo-viewer__caption"></p>
      <p class="photo-viewer__description"></p>
      <p class="photo-viewer__alt"></p>
      <a class="photo-viewer__cta" hidden></a>
    </div>
  `;

  document.body.appendChild(overlay);

  const box = overlay.querySelector('.photo-viewer__box');
  const closeButton = overlay.querySelector('.photo-viewer__close');

  closeButton?.addEventListener('click', closePhoto);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closePhoto();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !overlay.classList.contains('is-open')) return;
    event.preventDefault();
    closePhoto();
  });

  viewer = { overlay, box, closeButton };
  return viewer;
};

export const openPhoto = ({
  src,
  alt = '',
  title = '',
  caption = '',
  description = '',
  note = '',
  ctaLabel = '',
  ctaHref = '',
  trigger = null,
} = {}) => {
  if (!src) return;

  const { overlay, box, closeButton } = viewer || build();
  lastTrigger = trigger || document.activeElement;

  overlay.querySelector('.photo-viewer__image').src = src;
  overlay.querySelector('.photo-viewer__image').alt = alt || title;

  const titleEl = overlay.querySelector('.photo-viewer__title');
  titleEl.textContent = title;
  titleEl.hidden = !title;

  const captionEl = overlay.querySelector('.photo-viewer__caption');
  captionEl.textContent = caption;
  captionEl.hidden = !caption;

  const descriptionEl = overlay.querySelector('.photo-viewer__description');
  descriptionEl.textContent = description;
  descriptionEl.hidden = !description;

  const noteEl = overlay.querySelector('.photo-viewer__alt');
  noteEl.textContent = note;
  noteEl.hidden = !note;

  const cta = overlay.querySelector('.photo-viewer__cta');
  if (ctaLabel && ctaHref) {
    cta.textContent = ctaLabel;
    cta.href = ctaHref;
    cta.hidden = false;
  } else {
    cta.removeAttribute('href');
    cta.hidden = true;
  }

  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('photo-viewer-open');

  (closeButton || box).focus({ preventScroll: true });
};

export const closePhoto = () => {
  if (!viewer || !viewer.overlay.classList.contains('is-open')) return;

  viewer.overlay.classList.remove('is-open');
  viewer.overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('photo-viewer-open');

  if (lastTrigger?.isConnected) {
    lastTrigger.focus({ preventScroll: true });
  }
  lastTrigger = null;
};

/** Stable entry point for the classic page scripts. */
window.paulinaPhotoViewer = { open: openPhoto, close: closePhoto };

export default window.paulinaPhotoViewer;
