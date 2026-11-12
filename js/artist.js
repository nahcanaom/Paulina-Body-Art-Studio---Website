/**
 * PAULINA BODY ART STUDIO - ARTIST SCRIPT
 * Handles the photo previews (portrait + favourite works) and the
 * "Book Your Appointment" CTA. Navbar account dropdown / mobile menu is
 * handled by header_and_footer.js.
 *
 * Structure (each unit has one reason to change):
 *   - createPiercingPreview: hydrates cards into accessible photo triggers.
 *   - createArtistPhotoPreview: same, for the artist portraits.
 *   - createBookingCta: the single place that knows where booking lives.
 *   - js/photo-viewer.js: the shared gallery-style zoom used on every page.
 */
import { makeActivatable } from '../components/dialog.js';
import { openPhoto } from './photo-viewer.js';

/* ==========================================================================
   CONFIGURATION
   ========================================================================== */

/** Per-page settings; the shared wiring below reads everything from here. */
const PAGE_CONFIG = {
  bookingUrl: 'booking.html',
  cardsSelector: '.piercings-grid',
  cardSelector: '.piercing-card',
  artistPhotoSelector: '.artist-image-wrapper',
  bookButtonSelectors: ['#bookBtn', '[data-booking-btn]'],
};

const DEFAULT_PIERCING_DESCRIPTION = 'A PAULINA Studio favourite.';
const DEFAULT_PIERCING_TITLE = 'piercing';

/* ==========================================================================
   DOM HELPERS
   ========================================================================== */

/** Reads the data-title / data-desc / data-img trio shared by every card. */
const readPiercing = (card) => {
  const title = card.dataset.title || card.querySelector('.piercing-name')?.textContent.trim() || '';
  return {
    title: title || DEFAULT_PIERCING_TITLE,
    description: card.dataset.desc || DEFAULT_PIERCING_DESCRIPTION,
    img: card.dataset.img || card.querySelector('img')?.src || '',
    imgAlt: card.querySelector('img')?.alt || title,
  };
};

/* ==========================================================================
   PIERCING PREVIEW
   ========================================================================== */

/**
 * Wires every favourite-piercing card to the shared photo viewer.
 *
 * @param {Object} options
 * @param {string} options.cards      Selector for the cards container.
 * @param {string} options.card       Selector for individual cards.
 * @param {string} options.bookingUrl Booking destination for the CTA.
 * @returns {{ refresh: Function } | undefined}
 */
const createPiercingPreview = ({ cards, card, bookingUrl }) => {
  if (!document.querySelector(cards)) return undefined;

  const hydrate = (element) => {
    if (element.dataset.piercingWired === 'true') return;
    element.dataset.piercingWired = 'true';

    const piercing = readPiercing(element);
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.setAttribute('aria-haspopup', 'dialog');
    element.setAttribute('aria-label', `View ${piercing.title}`);

    makeActivatable(element, (trigger) => {
      const data = readPiercing(trigger);
      openPhoto({
        src: data.img,
        alt: data.imgAlt,
        title: data.title,
        caption: 'Favorite work',
        description: data.description,
        ctaLabel: 'Book This Piercing \u2192',
        ctaHref: bookingUrl,
        trigger,
      });
    });
  };

  // Every artist block has its own favorites grid, so hydrate all of them.
  const refresh = () =>
    document.querySelectorAll(cards).forEach((grid) => grid.querySelectorAll(card).forEach(hydrate));
  refresh();

  return { refresh };
};

/* ==========================================================================
   ARTIST PORTRAIT PREVIEW
   ========================================================================== */

/**
 * Wires each artist portrait to the shared photo viewer. Profiles are rendered
 * from the dashboard after load, so the wiring is re-run whenever site content
 * updates.
 */
const createArtistPhotoPreview = ({ selector }) => {
  const readPortrait = (wrapper) => {
    const image = wrapper.querySelector('.artist-photo') || wrapper.querySelector('img');
    const card = wrapper.closest('.artist-profile-card') || wrapper.closest('.artist-block');
    const name = card?.querySelector('.artist-script-name')?.textContent.trim().replace(/\s+/g, ' ') || '';
    const role = card?.querySelector('.artist-role')?.textContent.trim() || '';
    const bio = card?.querySelector('.artist-bio')?.textContent.trim() || '';

    return {
      name: name || image?.alt || 'Studio artist',
      role,
      bio,
      img: image?.currentSrc || image?.src || '',
      imgAlt: image?.alt || name,
    };
  };

  const hydrate = (wrapper) => {
    if (wrapper.dataset.portraitWired === 'true') return;
    if (!wrapper.querySelector('.artist-photo, img')) return;

    wrapper.dataset.portraitWired = 'true';
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('aria-haspopup', 'dialog');
    wrapper.classList.add('artist-photo-trigger');

    const portrait = readPortrait(wrapper);
    wrapper.setAttribute('aria-label', `View ${portrait.name} portrait`);

    makeActivatable(wrapper, (trigger) => {
      const data = readPortrait(trigger);
      openPhoto({
        src: data.img,
        alt: data.imgAlt,
        title: data.name,
        caption: data.role || 'Studio artist',
        description: data.bio,
        trigger,
      });
    });
  };

  const refresh = () => document.querySelectorAll(selector).forEach(hydrate);
  refresh();

  return { refresh };
};

/* ==========================================================================
   BOOKING CTA
   ========================================================================== */

/**
 * Sends the visitor to the booking section from any CTA button.
 *
 * @param {Object}   options
 * @param {string}   options.url       Booking destination (single source of truth).
 * @param {string[]} options.selectors Buttons that trigger booking.
 * @param {Function} [options.beforeNavigate] Runs before leaving the page.
 */
const createBookingCta = ({ url, selectors, beforeNavigate }) => {
  const selector = selectors.join(', ');

  const navigate = () => {
    beforeNavigate?.();
    window.location.assign(url);
  };

  // Delegated so booking buttons inside artist blocks added by a live content
  // refresh work without re-binding every CTA.
  document.addEventListener('click', (event) => {
    const button = event.target.closest(selector);
    if (!button) return;
    event.preventDefault();
    navigate();
  });

  const buttons = Array.from(document.querySelectorAll(selector));
  return { navigate, buttons };
};

/* ==========================================================================
   BOOTSTRAP
   ========================================================================== */

const initArtistPage = (config) => {
  const preview = createPiercingPreview({
    cards: config.cardsSelector,
    card: config.cardSelector,
    bookingUrl: config.bookingUrl,
  });

  const portraits = createArtistPhotoPreview({
    selector: config.artistPhotoSelector,
  });

  createBookingCta({
    url: config.bookingUrl,
    selectors: config.bookButtonSelectors,
    // Leaving the page anyway, so closing the zoom is all that matters.
    beforeNavigate: () => window.paulinaPhotoViewer?.close(),
  });

  return { preview, portraits };
};

document.addEventListener('DOMContentLoaded', async () => {
  // Artist profiles and Favorite Works are published from the dashboard.
  if (window.__PAULINA_SITE_CONTENT__) {
    try {
      await window.__PAULINA_SITE_CONTENT__;
    } catch (error) {
      console.warn('[artist] Published content unavailable.', error);
    }
  }

  const app = initArtistPage(PAGE_CONFIG);

  // A live admin update replaces the cards in the Favorite Works grid. Hydrate the
  // new cards without disturbing the viewer that may already be open.
  document.addEventListener('paulina:content-updated', () => {
    app?.preview?.refresh();
    app?.portraits?.refresh();
  });
});
