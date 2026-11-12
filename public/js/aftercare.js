/**
 * PAULINA BODY ART STUDIO - AFTERCARE SCRIPT
 * Handles the tattoo/piercing toggle, hero content swapping, and the
 * image/info modal behavior for the aftercare page.
 * Navbar mobile toggle is handled by header_and_footer.js for shared pages,
 * but aftercare uses a custom navbar so this script covers its own toggle.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Hero artwork, guide images and downsizing questions render asynchronously
  // from the admin dashboard. Wait for the first render before binding.
  if (window.__PAULINA_SITE_CONTENT__) {
    try {
      await window.__PAULINA_SITE_CONTENT__;
    } catch (error) {
      console.warn('[aftercare] Published content unavailable.', error);
    }
  }

  /* =====================================================================
     1. MOBILE MENU TOGGLE
     ===================================================================== */
  const menuToggle = document.querySelector('.nav-toggle');
  const navigation = document.querySelector('.nav-links');

  const closeMenu = () => {
    if (navigation) {
      navigation.classList.remove('is-open');
    }
    if (menuToggle) {
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Open navigation');
    }
  };

  if (menuToggle && navigation) {
    menuToggle.addEventListener('click', () => {
      const open = menuToggle.getAttribute('aria-expanded') !== 'true';
      navigation.classList.toggle('is-open', open);
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });

    navigation.addEventListener('click', (event) => {
      if (event.target.closest('a, .account-button')) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && navigation.classList.contains('is-open')) {
        closeMenu();
        menuToggle.focus();
      }
    });

    window.matchMedia('(min-width: 901px)')?.addEventListener('change', (event) => {
      if (event.matches) {
        closeMenu();
      }
    });
  }

  /* =====================================================================
     2. TATTOO / PIERCING CARE TOGGLE
     ===================================================================== */
  const piercingButton = document.querySelector('#piercing-button');
  const tattooButton = document.querySelector('#tattoo-button');
  const heroTitle = document.querySelector('#hero-title');
  const heroCopy = document.querySelector('.hero-copy > p');
  const heroImage = document.querySelector('.hero-image');

  const tattooCopy = heroCopy.textContent;
  const tattooImage = {
    src: heroImage.getAttribute('src'),
    alt: heroImage.alt,
    width: heroImage.getAttribute('width'),
    height: heroImage.getAttribute('height'),
  };
  const piercingHeroImage = {
    src: '../../assets/images/piercing-artist.png',
    alt: 'A PAULINA Studio piercer carefully working with a client',
    width: 609,
    height: 576,
  };

  // The admin can publish a different hero image for the tattoo and piercing
  // views. site-content.js caches both variants on the element's dataset.
  const heroVariant = (mode, fallback) => ({
    src: heroImage.dataset[`siteImage${mode}Src`] || fallback.src,
    alt: heroImage.dataset[`siteImage${mode}Alt`] || fallback.alt,
    width: fallback.width,
    height: fallback.height,
  });

  const selectCare = (piercing) => {
    document.body.classList.toggle('piercing-view', piercing);
    document.querySelector('#tattoo-panel').hidden = piercing;
    document.querySelector('#piercing-panel').hidden = !piercing;
    piercingButton.setAttribute('aria-pressed', String(piercing));
    tattooButton.setAttribute('aria-pressed', String(!piercing));

    heroTitle.innerHTML = piercing
      ? 'Piercing<br>Aftercare'
      : 'Tattoo<br>Aftercare';

    heroCopy.textContent = piercing
      ? 'A new piercing is a minor adjustment, but it still needs extra care. If you clean it properly, stay patient, and practice good hygiene, your piercing will heal more comfortably and with fewer complications.'
      : tattooCopy;

    const nextHeroImage = piercing
      ? heroVariant('Piercing', piercingHeroImage)
      : heroVariant('Tattoo', tattooImage);
    heroImage.src = nextHeroImage.src;
    heroImage.alt = nextHeroImage.alt;
    heroImage.width = nextHeroImage.width;
    heroImage.height = nextHeroImage.height;

    document.title = (piercing ? 'Piercing' : 'Tattoo') + ' Aftercare | PAULINA Body Art Studio';
  };

  piercingButton?.addEventListener('click', () => selectCare(true));
  tattooButton?.addEventListener('click', () => selectCare(false));

  
  /* =====================================================================
     4. PHOTO ZOOM (guide images + hero artwork)
     Uses the shared gallery-style viewer, so aftercare photos zoom exactly
     like the gallery photos do.
     ===================================================================== */
  const openImage = (trigger, image, caption) => {
    if (!image) return;
    window.paulinaPhotoViewer?.open({
      src: image.currentSrc || image.src,
      alt: image.alt,
      title: image.alt,
      caption,
      trigger,
    });
  };

  // Image links are updated in place by the admin sync, so resolve the image at
  // click time rather than capturing it when the page first loads.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('.square-image');
    if (!link) return;
    const image = link.querySelector('img');
    if (!image) return;
    event.preventDefault();
    openImage(link, image, 'Aftercare guide');
  });

  document.querySelectorAll('.square-image').forEach((link) => {
    const image = link.querySelector('img');
    link.setAttribute('aria-haspopup', 'dialog');
    if (image) link.setAttribute('aria-label', 'Enlarge ' + image.alt);
  });

  const heroArtwork = document.querySelector('.hero-artwork');
  if (heroArtwork) {
    const heroCaption = () =>
      (document.body.classList.contains('piercing-view') ? 'Piercing' : 'Tattoo') + ' aftercare';

    heroArtwork.setAttribute('role', 'button');
    heroArtwork.setAttribute('tabindex', '0');
    heroArtwork.setAttribute('aria-label', 'Enlarge studio photograph');
    heroArtwork.setAttribute('aria-haspopup', 'dialog');
    heroArtwork.addEventListener('click', () => openImage(heroArtwork, heroImage, heroCaption()));
    heroArtwork.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openImage(heroArtwork, heroImage, heroCaption());
      }
    });
  }

  /* =====================================================================
     5. DOWNSIZING FAQ ACCORDION
     Matches the functional behavior of the FAQ accordions on faqs.html:
     - Click toggles .active class and aria-expanded
     - Only one item open at a time (accordion behavior)
     - Chevron icon rotates 180deg when open
     ===================================================================== */
  // The downsizing questions are re-rendered from the dashboard, so the
  // accordion listens on the document and resolves the list at click time.
  document.addEventListener('click', (event) => {
    const header = event.target.closest('.downsizing-faq .faq-header');
    if (!header) return;

    const list = header.closest('.downsizing-faq');
    const currentItem = header.parentElement;
    const isActive = currentItem.classList.contains('active');

    list.querySelectorAll('.faq-item').forEach(item => {
      item.classList.remove('active');
      const btn = item.querySelector('.faq-header');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });

    if (!isActive) {
      currentItem.classList.add('active');
      header.setAttribute('aria-expanded', 'true');
    }
  });

  /* =====================================================================
     6. NUMERAL STYLING
     CSS cannot target digits inside a text node, so wrap every run of
     numerals in a span. The .numeral class renders them in #FFFFFF.
     This runs again when admin content is re-rendered.
     ===================================================================== */
  const numeralPattern = /\d+(?:[.,:]\d+)*(?:\s*[–—-]\s*\d+(?:[.,:]\d+)*)?/g;

  const wrapNumerals = () => {
    const numeralWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/\d/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (!node.parentElement || node.parentElement.closest('script, style, noscript, .no-numeral, .numeral, .downsizing-faq')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const numeralNodes = [];
    while (numeralWalker.nextNode()) numeralNodes.push(numeralWalker.currentNode);

    numeralNodes.forEach((node) => {
      const text = node.nodeValue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;

      for (const match of text.matchAll(numeralPattern)) {
        if (match.index > cursor) {
          fragment.append(text.slice(cursor, match.index));
        }

        const numeral = document.createElement('span');
        numeral.className = 'numeral';
        numeral.textContent = match[0];
        fragment.append(numeral);

        cursor = match.index + match[0].length;
      }

      if (!cursor) return;
      if (cursor < text.length) {
        fragment.append(text.slice(cursor));
      }

      node.replaceWith(fragment);
    });
  };

  wrapNumerals();
  document.addEventListener('paulina:content-updated', wrapNumerals);
});
