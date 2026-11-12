/**
 * PAULINA BODY ART STUDIO — HOME PAGE
 *
 * 1. Hero promo carousel: rotates every 1.5s, pauses while hovered or focused,
 *    and re-reads its slides whenever the dashboard publishes a new set of
 *    banners (the slides are rendered dynamically from site_settings).
 * 2. Studio policy accordions.
 * 3. Shared image preview modal and the review detail modal.
 *
 * The reviews list and the "Share your experience" composer live in
 * js/reviews-home.js, which reads real reviews from Supabase.
 */

const PROMO_AUTOPLAY_MS = 1500;

/* ==========================================================================
   1. HERO PROMO CAROUSEL
   ========================================================================== */

function initPromoCarousel() {
  const carousel = document.querySelector('.hero-right .promo-carousel');
  const stage = carousel?.querySelector('.promo-stage');
  if (!carousel || !stage) return;

  // Each rebuild replaces listeners and the timer, so a dashboard re-render
  // never leaves a second interval ticking behind the first.
  carousel.__promoController?.abort();
  clearInterval(carousel.__promoTimer);
  carousel.__promoTimer = 0;

  const controller = new AbortController();
  const { signal } = controller;
  carousel.__promoController = controller;

  const previous = carousel.querySelector('.promo-previous');
  const next = carousel.querySelector('.promo-next');
  const arrows = [previous, next].filter(Boolean);

  let index = Number(carousel.dataset.promoIndex) || 0;
  let paused = false;

  const slides = () => [...stage.querySelectorAll('.promo-slide')];

  function paint() {
    const items = slides();
    const total = items.length;

    if (!total) {
      carousel.dataset.promoIndex = '0';
      return;
    }

    index = ((index % total) + total) % total;

    arrows.forEach((arrow) => {
      arrow.style.visibility = total > 1 ? '' : 'hidden';
    });

    items.forEach((slide, position) => {
      const offset = (position - index + total) % total;
      let slot = 'hidden';
      if (offset === 0) slot = 'active';
      else if (offset === 1) slot = 'right';
      else if (offset === total - 1) slot = 'left';

      slide.dataset.position = slot;

      const isHidden = slot === 'hidden';
      slide.setAttribute('aria-hidden', String(isHidden));
      if (isHidden) slide.setAttribute('tabindex', '-1');
      else slide.setAttribute('tabindex', '0');

      const title = slide.dataset.title || 'promotion';
      slide.setAttribute(
        'aria-label',
        slot === 'active'
          ? `Open ${title}`
          : `Show promotion ${position + 1} of ${total}`
      );
    });

    carousel.dataset.promoIndex = String(index);
  }

  function syncImageRatios() {
    slides().forEach((slide) => {
      const image = slide.querySelector('img');
      if (!image) return;

      const apply = () => {
        if (image.naturalWidth && image.naturalHeight) {
          slide.style.setProperty(
            '--promo-image-ratio',
            `${image.naturalWidth} / ${image.naturalHeight}`
          );
        }
      };

      if (image.complete) apply();
      else image.addEventListener('load', apply, { once: true, signal });
    });
  }

  function stop() {
    clearInterval(carousel.__promoTimer);
    carousel.__promoTimer = 0;
  }

  function start() {
    stop();
    if (paused || document.hidden || slides().length < 2) return;

    carousel.__promoTimer = setInterval(() => {
      const total = slides().length;
      if (total < 2) {
        stop();
        return;
      }
      index = (index + 1) % total;
      paint();
    }, PROMO_AUTOPLAY_MS);
  }

  function change(step) {
    const total = slides().length;
    if (total < 2) return;
    index = (index + step + total) % total;
    paint();
    // Manual navigation restarts the dwell, the same way hover does.
    start();
  }

  previous?.addEventListener('click', () => change(-1), { signal });
  next?.addEventListener('click', () => change(1), { signal });

  carousel.addEventListener(
    'mouseenter',
    () => {
      paused = true;
      stop();
    },
    { signal }
  );

  carousel.addEventListener(
    'mouseleave',
    () => {
      paused = false;
      start();
    },
    { signal }
  );

  carousel.addEventListener(
    'focusin',
    () => {
      paused = true;
      stop();
    },
    { signal }
  );

  carousel.addEventListener(
    'focusout',
    (event) => {
      if (carousel.contains(event.relatedTarget)) return;
      paused = false;
      start();
    },
    { signal }
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) stop();
      else start();
    },
    { signal }
  );

  // The admin panel publishes the banner list; site-content re-renders the
  // stage from it. Every change re-indexes the carousel and its navigation.
  if (!stage.__promoObserver) {
    stage.__promoObserver = new MutationObserver(() => {
      cancelAnimationFrame(stage.__promoRebuild);
      stage.__promoRebuild = requestAnimationFrame(() => initPromoCarousel());
    });
  }
  stage.__promoObserver.observe(stage, { childList: true });

  paint();
  syncImageRatios();
  start();
}

/* ==========================================================================
   2. STUDIO POLICY ACCORDIONS
   ========================================================================== */

function initAccordions() {
  const accordionHeaders = document.querySelectorAll('.accordion-header');

  accordionHeaders.forEach((header) => {
    header.addEventListener('click', () => {
      const currentItem = header.parentElement;
      const isActive = currentItem.classList.contains('active');

      document.querySelectorAll('.accordion-item').forEach((item) => {
        item.classList.remove('active');
      });

      if (!isActive) {
        currentItem.classList.add('active');
      }
    });
  });
}

/* ==========================================================================
   3. MODALS — IMAGE PREVIEW + REVIEW DETAIL
   ========================================================================== */

function initPreviewModals() {
  const modalOverlay = document.getElementById('modalOverlay');
  const testimonialModal = document.getElementById('testimonialModal');
  if (!modalOverlay) return;

  const testiModalAvatar = document.getElementById('testiModalAvatar');
  const testiModalName = document.getElementById('testiModalName');
  const testiModalStars = document.getElementById('testiModalStars');
  const testiModalDate = document.getElementById('testiModalDate');
  const testiModalText = document.getElementById('testiModalText');

  const testimonialModalClose = document.getElementById('testimonialModalClose');
  const shareModalClose = document.getElementById('shareModalClose');

  function hideAllBoxes() {
    document.querySelectorAll('.modal-box').forEach((box) => {
      box.classList.remove('active');
      box.style.display = '';
    });
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
    hideAllBoxes();
  }

  function showBox(box) {
    if (!box) return;
    hideAllBoxes();
    box.style.display = 'block';
    box.classList.add('active');
    modalOverlay.classList.add('active');
  }

  // Captions tell the visitor what kind of picture they are looking at, the
  // same way the gallery labels its zoom cards.
  const PREVIEW_CAPTIONS = {
    studio: 'Studio',
    service: 'Service',
    promo: 'Promotion',
    pricelist: 'Price list',
    artist: 'Artist',
  };

  function openImagePreview(card) {
    if (!card) return;

    const cardImage = card.querySelector('img');
    if (!cardImage) return;

    const title = card.dataset.title || card.querySelector('h3')?.textContent || '';
    const desc = card.dataset.desc || '';

    // Every photo opens in the shared gallery-style viewer, so the zoom behaves
    // and looks the same here as it does in the gallery.
    window.paulinaPhotoViewer?.open({
      src: card.dataset.img || cardImage.currentSrc || cardImage.src,
      alt: cardImage.alt || title,
      title,
      caption: PREVIEW_CAPTIONS[card.dataset.modalType] || '',
      description: desc,
      trigger: card,
    });
  }

  // Content cards are rendered asynchronously and replaced whenever the admin
  // publishes an update, so click/keyboard handling is delegated to the
  // document instead of bound to the initial elements.
  document.addEventListener('click', (event) => {
    const card = event.target.closest('.zoom-card, .artist-card, .pricelist-container');
    if (card) openImagePreview(card);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.zoom-card, .artist-card, .pricelist-container');
    if (!card) return;
    event.preventDefault();
    openImagePreview(card);
  });

  // Promo slides come from the dashboard and are replaced on every sync, so
  // their clicks are handled by delegation on the stage they live in.
  const promoStage = document.querySelector('.hero-right .promo-stage');
  if (promoStage) {
    promoStage.addEventListener('click', (event) => {
      const slide = event.target.closest('.promo-slide');
      if (slide) openImagePreview(slide);
    });

    promoStage.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const slide = event.target.closest('.promo-slide');
      if (!slide) return;
      event.preventDefault();
      openImagePreview(slide);
    });
  }

  testimonialModalClose?.addEventListener('click', closeModal);
  shareModalClose?.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modalOverlay.classList.contains('active')) {
      closeModal();
    }
  });

  // js/reviews-home.js fills the detail modal before displaying it.
  window.paulinaModal = {
    open: showBox,
    close: closeModal,
    setTestimonial(review) {
      if (!testimonialModal) return;
      if (testiModalAvatar) {
        testiModalAvatar.src = review.avatarUrl || '';
        testiModalAvatar.alt = review.name || 'Reviewer';
      }
      if (testiModalName) testiModalName.textContent = review.name || '';
      if (testiModalStars) testiModalStars.textContent = review.stars || '';
      if (testiModalDate) testiModalDate.textContent = review.date || '';
      if (testiModalText) testiModalText.textContent = review.text || '';
    }
  };
}

/* ==========================================================================
   4. HERO CALLS TO ACTION
   ========================================================================== */

function initHeroActions() {
  // "Explore services" scrolls to the services section; "Book an appointment"
  // opens the booking form. Both used to be inert buttons.
  document.getElementById('exploreBtn')?.addEventListener('click', () => {
    document.getElementById('services')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('bookNowBtn')?.addEventListener('click', () => {
    window.location.assign('booking.html');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initPromoCarousel();
  initAccordions();
  initPreviewModals();
  initHeroActions();

  // Hero banners and other copy are fetched after the first paint; re-index
  // the carousel once that render lands so its navigation matches the data.
  window.__PAULINA_SITE_CONTENT__?.finally(() => initPromoCarousel());

  // Re-index when an admin publishes new banners or images while the page is
  // open. Delegated card handlers above survive the re-render.
  document.addEventListener('paulina:content-updated', () => initPromoCarousel());
});
