/**
 * PAULINA BODY ART STUDIO — USER-FACING SYNCHRONIZED GALLERY
 * Dynamically fetches published works and splits the portfolio into the two
 * gallery tabs from the design reference:
 *
 *   PIERCING -> 01 FACE PIERCING, 02 BODY PIERCING
 *   TATTOOS  -> 01 FACE TATTOO,   02 BODY TATTOO
 *
 * Only the active tab renders, so the section numbering restarts at 01 in each
 * tab. The page stays in sync with admin uploads through SSE plus focus and
 * polling fallbacks.
 *
 * Cards show the photo itself — no blurred backdrop or decorative filler — and
 * the body part is shown as a permanent chip on every card. The lightbox keeps
 * the complete uncropped image.
 */

(function () {
  'use strict';

  // api-base.js points these at the Express server when the public page is
  // opened through Live Server instead of the site server.
  const API_ORIGIN =
    typeof window !== 'undefined' && window.PAULINA_API_BASE ? window.PAULINA_API_BASE : '';
  const SSE_ENDPOINT = `${API_ORIGIN}/api/gallery/stream`;

  // DOM Elements.
  const dynamicGalleryContainer = document.getElementById('dynamicGalleryContainer');
  const dynamicGalleryEmpty = document.getElementById('dynamicGalleryEmpty');

  const modalOverlay = document.getElementById('modalOverlay');
  const imageModal = document.getElementById('imageModal');
  const modalImage = document.getElementById('modalImage');
  const modalTitle = document.getElementById('modalTitle');
  const modalCategory = document.getElementById('modalCategory');
  const modalClose = document.getElementById('imageModalClose');

  // Tabs and the numbered sections each one renders, in order.
  const GALLERY_TABS = {
    piercing: {
      title: 'Piercing Gallery',
      emptyLabel: 'piercing',
      sections: ['Face Piercing', 'Body Piercing']
    },
    tattoo: {
      title: 'Tattoo Gallery',
      emptyLabel: 'tattoo',
      sections: ['Face Tattoo', 'Body Tattoo']
    }
  };

  // Head and face placements decide whether a tattoo belongs to the face or
  // the body section. Word boundaries keep "forearm" from matching "ear".
  const FACE_AREA_PATTERN =
    /\b(face|facial|forehead|temple|eyebrow|eyelid|eye|nose|nostril|septum|bridge|cheek|lip|labret|philtrum|medusa|chin|jaw|tongue|smiley|dimple|ear|helix|lobe|conch|tragus|daith|rook|industrial|snug|head)\b/i;

  // Used to turn a descriptive title such as "Nose" into a body-part label
  // when the admin has not filled in the dedicated Body part field.
  const BODY_PART_WORDS = [
    'nose', 'septum', 'nostril', 'bridge', 'eyebrow', 'eyelid', 'lip', 'labret',
    'medusa', 'philtrum', 'tongue', 'smiley', 'ear', 'helix', 'lobe', 'conch',
    'tragus', 'daith', 'rook', 'industrial', 'navel', 'belly', 'nipple', 'dermal',
    'collarbone', 'clavicle', 'chest', 'sternum', 'back', 'spine', 'shoulder',
    'arm', 'forearm', 'wrist', 'hand', 'finger', 'thigh', 'leg', 'ankle', 'foot',
    'neck', 'nape', 'throat', 'hip', 'dimples', 'ribs', 'stomach', 'waist'
  ];

  // State
  let publishedWorks = [];
  let refreshRequestId = 0;
  let openItemId = null;
  let activeTab = 'piercing';

  /**
   * Initialize
   */
  async function init() {
    bindTabs();
    syncTabState();
    bindModal();
    initRealtimeSync();
    initVisibilitySync();
    await fetchWorks({ showSkeleton: true });
  }

  /* -------------------------------------------------------------------------
     TABS
     ------------------------------------------------------------------------- */

  function bindTabs() {
    document.querySelectorAll('[data-gallery-tab]').forEach((tab) => {
      tab.addEventListener('click', () => setActiveTab(tab.dataset.galleryTab));
    });
  }

  function setActiveTab(tabName) {
    if (!GALLERY_TABS[tabName] || tabName === activeTab) return;
    activeTab = tabName;
    syncTabState();
    renderActiveCategory();
  }

  function syncTabState() {
    document.querySelectorAll('[data-gallery-tab]').forEach((tab) => {
      const isActive = tab.dataset.galleryTab === activeTab;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });

    const title = document.getElementById('galleryTitle');
    if (title) title.textContent = GALLERY_TABS[activeTab].title;

    // Point the tab panel at whichever tab is currently showing.
    const panel = document.getElementById('dynamicGalleryContainer');
    const activeTabElement = document.querySelector(`[data-gallery-tab="${activeTab}"]`);
    if (panel && activeTabElement?.id) {
      panel.setAttribute('aria-labelledby', activeTabElement.id);
    }
  }

  /**
   * Fetch published works from backend API.
   * `showSkeleton` is only used for the first load; realtime refreshes update
   * the grid in place without flashing placeholders.
   */
  async function fetchWorks({ showSkeleton = false } = {}) {
    const requestId = ++refreshRequestId;
    if (showSkeleton) renderLoadingSkeletons();

    try {
      const { readPublicContent, normalizeGalleryImage } = await import('./services/publicContent.js');
      const data = await readPublicContent('gallery');
      const images = data.success && Array.isArray(data.images) ? data.images : null;
      if (data.demo && !document.getElementById('demoNotice')) {
        const notice = document.createElement('p');
        notice.id = 'demoNotice';
        notice.textContent = 'Portfolio images shown are examples.';
        document.getElementById('galleryTitle')?.after(notice);
      }

      // Ignore a response that a newer refresh has already superseded.
      if (requestId !== refreshRequestId) return;

      if (Array.isArray(images)) {
        publishedWorks = images.map(normalizeGalleryImage);
        renderActiveCategory();
        syncOpenModal();
      }
    } catch (err) {
      if (requestId !== refreshRequestId) return;
      console.warn('[gallery] Could not fetch dynamic works:', err.message);

      // A background refresh failure must not erase photos already on screen.
      if (publishedWorks.length > 0) return;

      if (dynamicGalleryContainer) {
        dynamicGalleryContainer.innerHTML = '';
        if (dynamicGalleryEmpty) {
          dynamicGalleryEmpty.textContent = 'Our portfolio is currently loading. Please check back shortly.';
          dynamicGalleryEmpty.style.display = 'block';
        }
      }
    }
  }

  function mediaUrl(url) {
    if (!url) return '';
    return typeof window.paulinaMediaUrl === 'function' ? window.paulinaMediaUrl(url) : url;
  }

  /**
   * Resolves a work to one of the four tabbed sections. New rows store the
   * section directly in both category and subcategory; older rows that still
   * say "Tattoos", "Piercing", "Ear piercing", "Face tattoos" or "Body
   * tattoos" are folded into the right section here.
   */
  function gallerySectionFor(item) {
    const category = String(item.category || '').trim();
    const subcategory = String(item.subcategory || '').trim();
    const bodyPart = String(item.bodyPart || '').trim();
    const hint = `${category} ${subcategory}`.toLowerCase();

    if (/face\s*tattoo/.test(hint)) return 'Face Tattoo';
    if (/body\s*tattoo/.test(hint)) return 'Body Tattoo';
    if (/face\s*pierc|ear\s*pierc/.test(hint)) return 'Face Piercing';
    if (/body\s*pierc/.test(hint)) return 'Body Piercing';

    const isTattoo = /tattoo/.test(hint);
    const isPiercing = /pierc/.test(hint);

    if (isTattoo) {
      // A tattoo is a face piece when its placement, title or legacy
      // subcategory names a head or face area.
      const areaHint = `${bodyPart} ${item.title || ''} ${subcategory}`;
      return FACE_AREA_PATTERN.test(areaHint) ? 'Face Tattoo' : 'Body Tattoo';
    }

    if (isPiercing) return /\bbody\b/.test(hint) ? 'Body Piercing' : 'Face Piercing';
    if (/\bbody\b/.test(hint)) return 'Body Piercing';
    return 'Face Piercing';
  }

  /**
   * Bento span recipe per section size. `grid-auto-flow: dense` fills any
   * remaining slot with the next card, so a section always reads as a designed
   * composition rather than a plain uniform grid.
   */
  function bentoPatternFor(count) {
    if (count === 1) return ['solo'];
    if (count === 2) return ['half', 'half'];
    if (count === 3) return ['feature', 'tall', 'tall'];
    if (count === 4) return ['feature', 'normal', 'normal', 'wide'];
    if (count <= 8) {
      const pattern = ['feature', 'normal', 'tall', 'normal', 'wide', 'normal', 'tall', 'normal'];
      return Array.from({ length: count }, (_, index) => pattern[index % pattern.length]);
    }

    // Larger portfolios repeat a four-card band that tiles the grid exactly:
    // one feature, two stacked small works and one tall work.
    const band = ['feature', 'small', 'tall', 'small'];
    return Array.from({ length: count }, (_, index) => band[index % band.length]);
  }

  /**
   * Resolve the specific body part for a work.
   * Priority: admin Body part field -> descriptive title -> subcategory.
   */
  function bodyPartFor(item) {
    const explicit = String(item.bodyPart || '').trim();
    if (explicit) return explicit;

    const title = String(item.title || '').trim();
    if (title) {
      const lower = title.toLowerCase();
      const match = BODY_PART_WORDS.find((part) => new RegExp(`\\b${part}`, 'i').test(lower));
      if (match) return title;
    }

    const subcategory = String(item.subcategory || '').trim();
    const stripped = subcategory.replace(/\s*(piercings?|tattoos?)$/i, '').trim();
    return stripped || String(item.category || '').trim() || 'Studio work';
  }

  /**
   * Junk one-letter admin titles are kept in the data but are not useful as a
   * card heading, so they are omitted and the body-part chip carries the card.
   */
  function displayTitleFor(item) {
    const title = String(item.title || '').trim();
    return title.length > 2 && /[a-z0-9]/i.test(title) ? title : '';
  }

  /**
   * Render loading skeleton placeholders
   */
  function renderLoadingSkeletons() {
    if (!dynamicGalleryContainer) return;

    const skeletonClasses = ['feature', 'normal', 'tall', 'normal', 'wide', 'normal'];
    dynamicGalleryContainer.innerHTML = `
      <section class="bento-section bento-section--skeleton">
        <div class="bento-section__header">
          <span class="bento-skeleton-line bento-skeleton-line--number"></span>
          <span class="bento-skeleton-line bento-skeleton-line--title"></span>
        </div>
        <div class="bento-grid">
          ${skeletonClasses
            .map((variant) => `<div class="gallery-skeleton-card bento-card--${variant}"></div>`)
            .join('')}
        </div>
      </section>
    `;
    if (dynamicGalleryEmpty) dynamicGalleryEmpty.style.display = 'none';
  }

  /**
   * Render the active tab's numbered editorial sections.
   */
  function renderActiveCategory() {
    if (!dynamicGalleryContainer) return;

    dynamicGalleryContainer.innerHTML = '';

    if (publishedWorks.length === 0) {
      if (dynamicGalleryEmpty) {
        dynamicGalleryEmpty.textContent = 'No works are currently published. Check back soon!';
        dynamicGalleryEmpty.style.display = 'block';
      }
      return;
    }

    const tab = GALLERY_TABS[activeTab] || GALLERY_TABS.piercing;

    // Works are grouped into the active tab's sections only. Everything stays
    // in memory, so switching tabs re-renders instantly from the same data.
    const groups = new Map(tab.sections.map((name) => [name, []]));
    publishedWorks.forEach((item) => {
      const sectionName = gallerySectionFor(item);
      if (groups.has(sectionName)) groups.get(sectionName).push(item);
    });

    const sections = tab.sections
      .map((name) => [name, groups.get(name)])
      .filter(([, items]) => items.length > 0);

    if (!sections.length) {
      if (dynamicGalleryEmpty) {
        dynamicGalleryEmpty.textContent = `No ${tab.emptyLabel} works are published yet. Check back soon!`;
        dynamicGalleryEmpty.style.display = 'block';
      }
      return;
    }

    if (dynamicGalleryEmpty) dynamicGalleryEmpty.style.display = 'none';

    sections.forEach(([sectionName, items], sectionIndex) => {
      const sortedItems = [...items].sort((a, b) => {
        const orderDiff = Number(a.displayOrder || 0) - Number(b.displayOrder || 0);
        if (orderDiff !== 0) return orderDiff;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      const section = document.createElement('section');
      section.className = 'bento-section';
      section.setAttribute('aria-label', sectionName);

      const number = String(sectionIndex + 1).padStart(2, '0');
      const header = document.createElement('header');
      header.className = 'bento-section__header';
      header.innerHTML = `
        <span class="bento-section__number">${number}</span>
        <h2 class="bento-section__title">${escapeHtml(sectionName)}</h2>
        <span class="bento-section__rule" aria-hidden="true"></span>
        <span class="bento-section__count">${sortedItems.length} ${sortedItems.length === 1 ? 'piece' : 'pieces'}</span>
      `;

      const grid = document.createElement('div');
      grid.className = 'bento-grid';
      if (sortedItems.length <= 8) {
        grid.classList.add(`bento-grid--count-${sortedItems.length}`);
      }

      const pattern = bentoPatternFor(sortedItems.length);

      sortedItems.forEach((item, itemIndex) => {
        const bodyPart = bodyPartFor(item);
        const title = displayTitleFor(item);
        const variant = pattern[itemIndex] || 'normal';
        const image = mediaUrl(item.imageUrl);

        const card = document.createElement('article');
        card.className = `bento-card bento-card--${variant}`;
        card.setAttribute('data-id', item.id);
        card.setAttribute('data-title', item.title);
        card.setAttribute('data-category', item.subcategory || item.category);
        card.setAttribute('data-body-part', bodyPart);
        card.setAttribute('data-img', image);
        card.setAttribute('data-alt', item.altText || item.title);
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `View ${bodyPart}`);

        card.innerHTML = `
          <div class="bento-card__media">
            <img class="bento-card__photo" src="${escapeHtml(image)}"
                 alt="${escapeHtml(item.altText || (title ? `${title} — ${bodyPart}` : bodyPart))}" loading="lazy">
          </div>
          <span class="bento-card__expand" aria-hidden="true">
            <i class="ph ph-arrows-out-simple" aria-hidden="true"></i>
          </span>
          <span class="bento-card__view" aria-hidden="true">
            <i class="ph ph-magnifying-glass-plus" aria-hidden="true"></i> View
          </span>
          <div class="bento-card__info">
            <span class="bento-card__part">
              <i class="ph-fill ph-map-pin" aria-hidden="true"></i>${escapeHtml(bodyPart)}
            </span>
            <span class="bento-card__tap" aria-hidden="true">Tap to view</span>
          </div>
        `;

        card.addEventListener('click', () => openModal(item));
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openModal(item);
          }
        });

        grid.appendChild(card);
      });

      section.appendChild(header);
      section.appendChild(grid);
      dynamicGalleryContainer.appendChild(section);
    });
  }

  /**
   * Modal Lightbox Functionality
   */
  function openModal(item) {
    if (!modalOverlay || !imageModal) return;

    openItemId = item.id;
    modalImage.src = mediaUrl(item.imageUrl);
    modalImage.alt = item.altText || item.title;
    modalTitle.textContent = displayTitleFor(item) || bodyPartFor(item);
    modalCategory.textContent = `${bodyPartFor(item)} \u00b7 ${item.subcategory || item.category}`;

    let altElem = document.getElementById('modalAlt');
    if (!altElem) {
      altElem = document.createElement('p');
      altElem.id = 'modalAlt';
      altElem.className = 'modal-alt-text';
      modalCategory.insertAdjacentElement('afterend', altElem);
    }
    altElem.textContent = item.altText || '';

    let bookCta = document.getElementById('modalBookCta');
    if (!bookCta) {
      bookCta = document.createElement('a');
      bookCta.id = 'modalBookCta';
      bookCta.className = 'modal-book-cta';
      bookCta.textContent = 'Book an Appointment for this Style \u2192';
      imageModal.appendChild(bookCta);
    }
    const serviceParam = encodeURIComponent(item.title);
    bookCta.href = `booking.html?service=${serviceParam}`;

    modalOverlay.classList.add('active');
    modalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    openItemId = null;
    if (!modalOverlay) return;
    modalOverlay.classList.remove('active');
    modalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  /**
   * Keep the lightbox honest after a realtime refresh: update its fields if
   * the photo still exists, or close it if the admin deleted/unpublished it.
   */
  function syncOpenModal() {
    if (!openItemId || !modalOverlay?.classList.contains('active')) return;

    const item = publishedWorks.find((entry) => String(entry.id) === String(openItemId));
    if (!item) {
      closeModal();
      return;
    }

    const bodyPart = bodyPartFor(item);
    modalImage.src = mediaUrl(item.imageUrl);
    modalImage.alt = item.altText || item.title;
    modalTitle.textContent = displayTitleFor(item) || bodyPart;
    modalCategory.textContent = `${bodyPart} \u00b7 ${item.subcategory || item.category}`;

    const altElem = document.getElementById('modalAlt');
    if (altElem) altElem.textContent = item.altText || '';
  }

  function bindModal() {
    if (!modalOverlay) return;

    if (modalClose) {
      modalClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeModal();
      });
    }

    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
        closeModal();
      }
    });
  }

  /**
   * Real-time Server-Sent Events (SSE) synchronization:
   * When an admin updates visibility, uploads, or deletes in Admin,
   * this listener triggers a silent refresh on the live client view.
   */
  function initRealtimeSync() {
    try {
      const sse = new EventSource(SSE_ENDPOINT);
      sse.addEventListener('gallery_change', () => {
        // Refetch published items quietly and re-render in place.
        fetchWorks();
      });
      sse.onerror = () => {
        // EventSource reconnects automatically. The focus/poll fallbacks below
        // keep the page current while the stream is unavailable.
      };
    } catch (err) {
      console.warn('[gallery-sse] Realtime stream unavailable:', err);
    }
  }

  /**
   * Safety net for browsers, proxies, or static-server setups where SSE is
   * blocked. SSE remains the immediate update path.
   */
  function initVisibilitySync() {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') fetchWorks();
    };

    document.addEventListener('visibilitychange', refreshIfVisible);
    window.addEventListener('focus', refreshIfVisible);
    window.setInterval(refreshIfVisible, 30000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
