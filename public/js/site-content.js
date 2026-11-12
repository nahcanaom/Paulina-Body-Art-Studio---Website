/**
 * PAULINA BODY ART STUDIO — PUBLIC CONTENT SYNC
 * --------------------------------------------
 * All public content is published from the admin dashboard and stored in
 * Supabase. This module reads the public (anon) tables and renders them in
 * place:
 *
 *   site_settings('home')  -> hero copy, contact details, promo banners
 *   site_settings('booking') -> booking guidance and policies
 *   artist_profiles        -> artist page profiles
 *   faqs                   -> FAQ page + aftercare category questions
 *   site_images            -> every content image on the public pages
 *
 * There are no static content fallbacks: if a row is unpublished or deleted in
 * the dashboard, it disappears from the public site. Brand logos and decorative
 * florals are design assets, not dashboard-managed content.
 */

import { supabase, isSupabaseConfigured } from './supabase-config.js';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

const hasText = (value) => typeof value === 'string' && value.trim() !== '';
const mediaUrl = (url) => (window.paulinaMediaUrl ? window.paulinaMediaUrl(url) : url);
const toggleDisplay = (element, show) => {
  if (!element) return;
  element.hidden = !show;
  element.style.display = show ? '' : 'none';
};
const AFTERCARE_CATEGORY = 'aftercare';

// Every payment method the booking page offers has its own QR slot. GCash keeps
// the original `booking-qr` section so existing uploads stay where they are; the
// other methods use their own section names.
const PAYMENT_QR_SECTIONS = [
  ['Gcash', 'booking-qr'],
  ['Maya', 'booking-qr-maya'],
  ['Bpi', 'booking-qr-bpi'],
  ['Gotyme', 'booking-qr-gotyme'],
  ['Maribank', 'booking-qr-maribank']
];

async function loadSetting(key) {
  const { data, error } = await supabase
    .from('site_settings')
    .select('key,value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw error;
  return data?.value && typeof data.value === 'object' ? data.value : null;
}

async function loadTable(table) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function sortByOrder(items) {
  return [...items].sort((a, b) => {
    const orderA = Number(a.display_order ?? a.displayOrder ?? 0);
    const orderB = Number(b.display_order ?? b.displayOrder ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

/* -------------------------------------------------------------------------
   HOME COPY
   ------------------------------------------------------------------------- */

function applyHomeCopy(home) {
  const eyebrow = document.querySelector('.sub-tagline');
  if (eyebrow && hasText(home.eyebrow)) {
    // Keep the accent styling the static markup applies to the ampersand.
    eyebrow.innerHTML = escapeHtml(home.eyebrow.trim()).replace('&amp;', '<span>&amp;</span>');
  }

  const headline = document.querySelector('.hero-title');
  if (headline) {
    const lines = [home.headline1, home.headline2, home.headline3];
    const spans = [...headline.querySelectorAll('span')];
    spans.forEach((span, index) => {
      if (hasText(lines[index])) span.textContent = lines[index].trim();
    });
  }

  const description = document.querySelector('.hero-description');
  if (description && (hasText(home.description) || hasText(home.quoteAttribution))) {
    let quote = hasText(home.description) ? home.description.trim() : '';
    // Saved copy often already includes its own quotation marks.
    const pairs = [
      ['\u201C', '\u201D'],
      ['"', '"'],
      ['\u2018', '\u2019'],
      ["'", "'"]
    ];
    for (const [open, close] of pairs) {
      if (quote.length > 1 && quote.startsWith(open) && quote.endsWith(close)) {
        quote = quote.slice(open.length, -close.length).trim();
        break;
      }
    }
    const attribution = hasText(home.quoteAttribution) ? home.quoteAttribution.trim() : '';
    description.innerHTML =
      (quote ? `\u201C${escapeHtml(quote)}\u201D` : '') +
      (attribution ? ` <span>\u2014 ${escapeHtml(attribution)}</span>` : '');
  }

  applyStudioHours(home.hours);
}

function applyStudioHours(hours) {
  const wrapper = document.querySelector('[data-site-hours]');
  if (!wrapper || !hours || typeof hours !== 'object') return;

  const values = {
    weekdays: hasText(hours.weekdays) ? hours.weekdays.trim() : '',
    saturday: hasText(hours.saturday) ? hours.saturday.trim() : '',
    sunday: hasText(hours.sunday) ? hours.sunday.trim() : '',
    note: hasText(hours.note) ? hours.note.trim() : ''
  };

  let hasOpeningHours = false;

  wrapper.querySelectorAll('.studio-hours-row').forEach((row) => {
    const value = row.querySelector('[data-site-hours-value]');
    const key = value?.dataset.siteHoursValue;
    const text = key ? values[key] : '';
    if (value) value.textContent = text;
    row.hidden = !text;
    if (text) hasOpeningHours = true;
  });

  const note = wrapper.querySelector('[data-site-hours-value="note"]');
  if (note) {
    note.textContent = values.note;
    note.hidden = !values.note;
  }

  wrapper.hidden = !hasOpeningHours;
}

function renderHeroBanners(home) {
  const stage = document.querySelector('.hero-right .promo-stage');
  const carousel = document.querySelector('.hero-right .promo-carousel');
  if (!stage) return;

  const banners = sortByOrder(
    (Array.isArray(home.banners) ? home.banners : []).filter(
      (banner) => banner && banner.isPublished !== false && hasText(banner.imageUrl)
    )
  );

  if (!banners.length) {
    stage.innerHTML = '';
    toggleDisplay(carousel, false);
    return;
  }

  toggleDisplay(carousel, true);

  stage.innerHTML = banners
    .map((banner, index) => {
      const title = hasText(banner.title) ? banner.title.trim() : 'Promotion';
      const alt = hasText(banner.alt) ? banner.alt.trim() : title;
      const position = index === 0 ? 'active' : index === 1 ? 'right' : index === banners.length - 1 ? 'left' : 'hidden';
      const label =
        index === 0
          ? `Open ${title}`
          : `Show ${title} (promotion ${index + 1} of ${banners.length})`;

      return `
        <div class="promo-slide" data-modal-type="promo" data-title="${escapeHtml(title)}"
             data-position="${position}" role="button" tabindex="${position === 'hidden' ? '-1' : '0'}"
             aria-hidden="${position === 'hidden' ? 'true' : 'false'}"
             aria-roledescription="slide" aria-label="${escapeHtml(label)}">
          <img src="${escapeHtml(mediaUrl(banner.imageUrl))}" alt="${escapeHtml(alt)}">
        </div>
      `;
    })
    .join('');
}

function applySiteContact(home) {
  const contact = home.contact && typeof home.contact === 'object' ? home.contact : null;
  if (!contact) return;

  if (hasText(contact.email)) {
    document.querySelectorAll('.footer-contact-details a[href^="mailto:"]').forEach((link) => {
      link.href = `mailto:${contact.email.trim()}`;
      const label = link.querySelector('span');
      if (label) label.textContent = contact.email.trim();
    });
  }

  if (hasText(contact.phone)) {
    document.querySelectorAll('.footer-contact-details a[href^="tel:"]').forEach((link) => {
      link.href = `tel:${contact.phone.replace(/[^\d+]/g, '')}`;
      const label = link.querySelector('span');
      if (label) label.textContent = contact.phone.trim();
    });
  }

  if (hasText(contact.address)) {
    document.querySelectorAll('.footer-contact-details a[aria-label="Google Maps"]').forEach((link) => {
      if (hasText(contact.mapsUrl)) link.href = contact.mapsUrl.trim();
      const label = link.querySelector('span');
      if (label) label.textContent = contact.address.trim();
    });
  }

  const socials = [
    ['Instagram', contact.instagram],
    ['Facebook', contact.facebook],
    ['TikTok', contact.tiktok]
  ];

  socials.forEach(([label, url]) => {
    if (!hasText(url)) return;
    document.querySelectorAll(`.social-links a[aria-label="${label}"]`).forEach((link) => {
      link.href = url.trim();
    });
  });

  // Contact details can also appear outside the footer (for example the
  // aftercare information dialog). Those links opt in with a data attribute.
  if (hasText(contact.email)) {
    document.querySelectorAll('[data-site-contact-email]').forEach((link) => {
      link.href = `mailto:${contact.email.trim()}`;
      const label = link.querySelector('span');
      if (label) label.textContent = contact.email.trim();
    });
  }

  if (hasText(contact.phone)) {
    document.querySelectorAll('[data-site-contact-phone]').forEach((link) => {
      link.href = `tel:${contact.phone.replace(/[^\d+]/g, '')}`;
      const label = link.querySelector('span');
      if (label) label.textContent = contact.phone.trim();
    });
  }
}

/* -------------------------------------------------------------------------
   SITE IMAGES
   ------------------------------------------------------------------------- */

function publishedSiteImages(rows) {
  return sortByOrder(
    rows.filter(
      (row) =>
        row &&
        row.is_published !== false &&
        hasText(row.section) &&
        hasText(row.image_url)
    )
  );
}

function zoomCardHtml(item, type) {
  const title = hasText(item.title) ? item.title.trim() : 'Studio image';
  const alt = hasText(item.alt_text) ? item.alt_text.trim() : title;
  const description = hasText(item.description) ? item.description.trim() : '';
  const image = mediaUrl(item.image_url.trim());

  return `
    <div class="zoom-card" data-modal-type="${escapeHtml(type)}" data-title="${escapeHtml(title)}"
         data-img="${escapeHtml(image)}" data-desc="${escapeHtml(description)}"
         role="button" tabindex="0" aria-label="Enlarge ${escapeHtml(title)}">
      <img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy">
    </div>
  `;
}

function serviceCardHtml(item) {
  const title = hasText(item.title) ? item.title.trim() : 'Studio service';
  const alt = hasText(item.alt_text) ? item.alt_text.trim() : title;
  const description = hasText(item.description) ? item.description.trim() : '';
  const image = mediaUrl(item.image_url.trim());
  const label = hasText(item.subtitle)
    ? item.subtitle.trim()
    : hasText(item.title)
      ? item.title.trim()
      : '';

  return `
    <div class="zoom-card" data-modal-type="service" data-title="${escapeHtml(title)}"
         data-img="${escapeHtml(image)}" data-desc="${escapeHtml(description)}"
         role="button" tabindex="0" aria-label="Enlarge ${escapeHtml(title)}">
      <div class="service-image">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy">
      </div>
      ${label ? `<p class="service-label">${escapeHtml(label)}</p>` : ''}
    </div>
  `;
}

function artistPortraitHtml(item) {
  const title = hasText(item.title) ? item.title.trim() : 'Studio artist';
  const alt = hasText(item.alt_text) ? item.alt_text.trim() : title;
  const image = mediaUrl(item.image_url.trim());
  const name = hasText(item.title) ? item.title.trim() : '';

  return `
    <div class="artist-card" data-modal-type="artist" role="button" tabindex="0"
         aria-label="Enlarge ${escapeHtml(title)} portrait">
      <div class="artist-image">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy">
      </div>
      ${name ? `<div class="artist-section-name"><h3>${escapeHtml(name)}</h3></div>` : ''}
    </div>
  `;
}

function favouriteWorkHtml(item) {
  const title = hasText(item.title) ? item.title.trim() : 'Favorite work';
  const alt = hasText(item.alt_text) ? item.alt_text.trim() : title;
  const description = hasText(item.description) ? item.description.trim() : '';
  const image = mediaUrl(item.image_url.trim());

  return `
    <article class="piercing-card" data-title="${escapeHtml(title)}"
             data-desc="${escapeHtml(description)}" data-img="${escapeHtml(image)}">
      <div class="piercing-img-box">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy">
      </div>
      <span class="piercing-name">${escapeHtml(title)}</span>
    </article>
  `;
}

function renderSiteImageGallery(container, items) {
  const section = container.dataset.siteImages;

  if (!items.length) {
    container.innerHTML = '';
    toggleDisplay(container, false);
    return;
  }

  toggleDisplay(container, true);

  switch (section) {
    case 'home-services':
      container.innerHTML = items.map(serviceCardHtml).join('');
      break;
    case 'home-artists':
      container.innerHTML = items.map(artistPortraitHtml).join('');
      break;
    case 'artist-favorites':
      container.innerHTML = items.map(favouriteWorkHtml).join('');
      break;
    case 'home-studio':
    default:
      container.innerHTML = items.map((item) => zoomCardHtml(item, 'studio')).join('');
      break;
  }
}

function applySiteImages(rows, available = true) {
  // When the image table cannot be reached, leave the authored markup untouched
  // so every page keeps its bundled fallback artwork instead of showing gaps.
  if (!available) return;

  const images = publishedSiteImages(rows);
  const bySection = new Map();

  images.forEach((item) => {
    const section = item.section.trim();
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section).push(item);
  });

  const itemsFor = (section) => bySection.get(section) || [];

  document.querySelectorAll('[data-site-images]').forEach((container) => {
    renderSiteImageGallery(container, itemsFor(container.dataset.siteImages));
  });

  document.querySelectorAll('[data-site-image]').forEach((image) => {
    // Remember the authored fallback before the first admin image replaces it.
    if (image.dataset.siteImageFallbackSrc === undefined) {
      image.dataset.siteImageFallbackSrc = image.getAttribute('src') || '';
      image.dataset.siteImageFallbackAlt = image.getAttribute('alt') || '';
    }

    const section = image.dataset.siteImage;
    const item = itemsFor(section)[0];
    const keepHidden = image.dataset.siteImageKeepHidden === 'true';

    if (!item) {
      // Functional images (the booking QR code and studio photos) keep their
      // bundled fallback so the booking flow still works if an admin removes
      // that group, while decorative sections hide cleanly.
      if (image.dataset.siteImageFallback === 'true' && image.dataset.siteImageFallbackSrc) {
        image.src = image.dataset.siteImageFallbackSrc;
        image.alt = image.dataset.siteImageFallbackAlt || '';
        delete image.dataset.siteImageSrc;
        delete image.dataset.siteImageAlt;
        if (!keepHidden) toggleDisplay(image, true);
        const wrapper = image.closest('.pricelist-container, .image-side');
        if (wrapper) toggleDisplay(wrapper, true);
        return;
      }

      image.removeAttribute('src');
      delete image.dataset.siteImageSrc;
      delete image.dataset.siteImageAlt;
      if (!keepHidden) {
        toggleDisplay(image, false);
        const wrapper = image.closest('.pricelist-container, .image-side');
        if (wrapper) toggleDisplay(wrapper, false);
      }
      return;
    }

    const source = mediaUrl(item.image_url.trim());
    image.src = source;
    image.alt = hasText(item.alt_text) ? item.alt_text.trim() : item.title || '';
    // Other page controllers (for example booking.js) read these values when
    // they reset an image so admin-managed artwork is never overwritten.
    image.dataset.siteImageSrc = source;
    image.dataset.siteImageAlt = image.alt;
    if (!keepHidden) toggleDisplay(image, true);
    const wrapper = image.closest('.pricelist-container, .image-side');
    if (wrapper) toggleDisplay(wrapper, true);
  });

  // Each payment method has its own QR card on the booking page. Cache the
  // published source and alt text for every method on the QR element so the
  // page controller can swap cards without another request, and leave the key
  // missing when a method has no published image so the bundled art is used.
  document.querySelectorAll('[data-site-qr]').forEach((image) => {
    PAYMENT_QR_SECTIONS.forEach(([method, section]) => {
      const item = itemsFor(section)[0];
      if (!item) {
        delete image.dataset[`siteQr${method}Src`];
        delete image.dataset[`siteQr${method}Alt`];
        return;
      }
      image.dataset[`siteQr${method}Src`] = mediaUrl(item.image_url.trim());
      image.dataset[`siteQr${method}Alt`] = hasText(item.alt_text)
        ? item.alt_text.trim()
        : item.title || '';
    });
  });

  document.querySelectorAll('[data-site-image-link]').forEach((link) => {
    const item = itemsFor(link.dataset.siteImageLink)[0];
    const image = link.querySelector('img');

    if (!item) {
      toggleDisplay(link, false);
      if (image) {
        delete image.dataset.siteImageSrc;
        delete image.dataset.siteImageAlt;
      }
      return;
    }

    const source = mediaUrl(item.image_url.trim());
    toggleDisplay(link, true);
    link.href = source;
    if (image) {
      image.src = source;
      image.alt = hasText(item.alt_text) ? item.alt_text.trim() : item.title || '';
      image.dataset.siteImageSrc = source;
      image.dataset.siteImageAlt = image.alt;
      toggleDisplay(image, true);
    }
  });

  // Some images have a different artwork per view (the aftercare hero swaps
  // between the tattoo and piercing guide). Cache both variants on the element
  // so the page controller can switch without another network request.
  document.querySelectorAll('[data-site-image-tattoo][data-site-image-piercing]').forEach((image) => {
    const variants = [
      ['Tattoo', itemsFor(image.dataset.siteImageTattoo)[0]],
      ['Piercing', itemsFor(image.dataset.siteImagePiercing)[0]]
    ];

    variants.forEach(([mode, item]) => {
      if (!item) {
        delete image.dataset[`siteImage${mode}Src`];
        delete image.dataset[`siteImage${mode}Alt`];
        return;
      }
      image.dataset[`siteImage${mode}Src`] = mediaUrl(item.image_url.trim());
      image.dataset[`siteImage${mode}Alt`] = hasText(item.alt_text)
        ? item.alt_text.trim()
        : item.title || '';
    });

    const activeItem = document.body.classList.contains('piercing-view')
      ? variants[1][1]
      : variants[0][1];
    if (activeItem) {
      image.src = mediaUrl(activeItem.image_url.trim());
      image.alt = hasText(activeItem.alt_text) ? activeItem.alt_text.trim() : activeItem.title || '';
      toggleDisplay(image, true);
    }
  });
}

/* -------------------------------------------------------------------------
   ARTISTS
   ------------------------------------------------------------------------- */

function buildArtistCard(artist) {
  const figure = document.createElement('div');
  figure.className = 'artist-profile-card';

  const photo = hasText(artist.avatar_url) ? mediaUrl(artist.avatar_url.trim()) : '';
  const name = hasText(artist.name) ? artist.name.trim() : '';
  const parts = name.split(/\s+/);
  const first = parts.shift() || name;
  const rest = parts.join(' ');
  const role = hasText(artist.role) ? artist.role.trim() : '';
  const bio = hasText(artist.bio) ? artist.bio.trim() : '';
  const specialties = Array.isArray(artist.specialties)
    ? artist.specialties.filter(hasText)
    : [];
  const instagram = hasText(artist.instagram_url) ? artist.instagram_url.trim() : '';

  let handle = '';
  if (instagram) {
    try {
      handle = new URL(instagram).pathname.replace(/\/+$/, '').split('/').pop() || '';
    } catch {
      handle = '';
    }
  }

  figure.innerHTML = `
    ${photo ? `<div class="artist-image-wrapper">
      <img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" class="artist-photo">
    </div>` : ''}
    <div class="artist-details">
      <div class="artist-name-group">
        <h2 class="artist-script-name">${escapeHtml(first)}${
          rest ? ` <span class="artist-serif-name">${escapeHtml(rest)}</span>` : ''
        }</h2>
        ${role ? `<p class="artist-role">${escapeHtml(role)}</p>` : ''}
      </div>
      ${bio ? `<p class="artist-bio">${escapeHtml(bio)}</p>` : ''}
      ${
        specialties.length
          ? `<ul class="artist-specialties">${specialties
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join('')}</ul>`
          : ''
      }
      ${
        instagram
          ? `<a href="${escapeHtml(instagram)}" target="_blank" rel="noreferrer" class="artist-social-link"
                title="Instagram" aria-label="Instagram">
               <i class="ph-fill ph-instagram-logo" aria-hidden="true"></i>
               <span>${escapeHtml(handle || 'Instagram')}</span>
             </a>`
          : ''
      }
    </div>
  `;

  return figure;
}

const FAVORITE_WORKS_SECTION = 'artist-favorites';

/** Groups published Favorite Works rows by the artist they belong to. */
function favoriteWorksByArtist(rows) {
  const grouped = new Map();

  rows
    .filter(
      (row) =>
        row &&
        row.section === FAVORITE_WORKS_SECTION &&
        row.is_published !== false &&
        hasText(row.image_url)
    )
    .forEach((row) => {
      const artistId = String(row.artist_id || row.artistId || '');
      if (!grouped.has(artistId)) grouped.set(artistId, []);
      grouped.get(artistId).push(row);
    });

  return grouped;
}

/**
 * Builds one self-contained artist block: the profile, that artist's own
 * Favorite Works (only when they have published works) and a booking CTA.
 * Works are assigned to an artist in Edit Website > Artists > Favorite Works.
 */
function buildArtistBlock(artist, works) {
  const block = document.createElement('article');
  block.className = 'artist-block';
  block.dataset.artistId = artist.id;

  block.appendChild(buildArtistCard(artist));

  const name = hasText(artist.name) ? artist.name.trim() : 'Artist';
  const ordered = sortByOrder(works);

  if (ordered.length) {
    const favoriteSection = document.createElement('section');
    favoriteSection.className = 'artist-favorite-works';
    favoriteSection.setAttribute('aria-label', `${name} Favorite Works`);
    favoriteSection.innerHTML = `
      <div class="section-florals" aria-hidden="true">
        <img class="section-flower floral-size-medium floral-left-middle floral-bg1"
          src="../../assets/images/flower_bg1.png" alt="">
        <img class="section-flower floral-size-small floral-right-middle floral-bg2"
          src="../../assets/images/flower_bg2.png" alt="">
      </div>

      <div class="section-divider-heading">
        <h2>Favorite Works</h2>
        <div class="divider-line" aria-hidden="true"></div>
      </div>

      <div class="piercings-grid">${ordered.map(favouriteWorkHtml).join('')}</div>
    `;

    block.appendChild(favoriteSection);
  }

  const cta = document.createElement('div');
  cta.className = 'btn-container';
  cta.innerHTML = '<button type="button" class="btn booking-btn" data-booking-btn>BOOK YOUR APPOINTMENT</button>';
  block.appendChild(cta);

  return block;
}

function applyArtists(rows, imageRows = []) {
  const section = document.querySelector('.artist-profile-section');
  if (!section) return;

  const list = section.querySelector('[data-artist-list]');
  if (!list) return;

  const artists = sortByOrder(
    rows.filter((row) => row && row.is_published !== false && hasText(row.name))
  );

  // If nothing has been published yet, keep the static profile already in the
  // markup instead of deleting it. This protects the public page from losing
  // content when the table is empty or temporarily unavailable.
  if (!artists.length) {
    const empty = section.querySelector('[data-artist-empty]');
    if (empty) empty.hidden = false;
    return;
  }

  const empty = section.querySelector('[data-artist-empty]');
  if (empty) empty.hidden = true;

  const grouped = favoriteWorksByArtist(imageRows);
  const artistIds = new Set(artists.map((artist) => String(artist.id)));

  // Works saved before the artist link existed (or whose artist was removed)
  // stay visible on the first artist until they are assigned in the dashboard.
  const unassigned = sortByOrder(
    [...grouped.entries()]
      .filter(([artistId]) => !artistId || !artistIds.has(artistId))
      .flatMap(([, rows]) => rows)
  );

  list.innerHTML = '';
  artists.forEach((artist, index) => {
    const linked = sortByOrder(grouped.get(String(artist.id)) || []);
    const works = index === 0 ? sortByOrder(linked.concat(unassigned)) : linked;
    list.appendChild(buildArtistBlock(artist, works));
  });
}

/* -------------------------------------------------------------------------
   FAQS
   ------------------------------------------------------------------------- */

const normalizedQuestion = (question) => question.replace(/\s+/g, ' ').toLowerCase();

function faqItems(rows) {
  const seen = new Set();

  return sortByOrder(
    rows.filter((row) => row && row.is_published !== false && hasText(row.question))
  )
    .map((faq) => ({
      question: faq.question.trim(),
      answer: String(faq.answer ?? '').trim(),
      category: String(faq.category ?? '').trim()
    }))
    .filter((faq) => {
      const key = normalizedQuestion(faq.question);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const isAftercareFaq = (faq) => faq.category.toLowerCase() === AFTERCARE_CATEGORY;

function renderFaqList(list, faqs) {
  if (!list) return;

  if (!faqs.length) {
    list.innerHTML = '<p class="faq-empty">No questions published yet. Please check back soon.</p>';
    return;
  }

  list.innerHTML = faqs
    .map(
      (faq) => `
      <div class="faq-item">
        <button class="faq-header" aria-expanded="false">
          <span>${escapeHtml(faq.question)}</span>
          <i class="ph ph-caret-down faq-icon" aria-hidden="true"></i>
        </button>
        <div class="faq-content">
          <p class="faq-text">${escapeHtml(faq.answer)}</p>
        </div>
      </div>
    `
    )
    .join('');
}

function getAftercareFaqIcon(question) {
  const q = String(question || '').toLowerCase();
  if (q.includes('when') || q.includes('time') || q.includes('schedule')) {
    return 'ph-clock';
  }
  if (q.includes('sign') || q.includes('symptom') || q.includes('warning') || q.includes('need')) {
    return 'ph-warning-circle';
  }
  if (q.includes('important') || q.includes('why')) {
    return 'ph-user-circle-check';
  }
  if (q.includes('who') || q.includes('perform') || q.includes('piercer') || q.includes('shield')) {
    return 'ph-shield-check';
  }
  return 'ph-info';
}

function formatAftercareAnswer(answer) {
  const lines = String(answer || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const hasBullets = lines.some((l) => l.startsWith('•') || l.startsWith('-') || l.startsWith('*'));
  if (hasBullets || lines.length > 1) {
    const items = lines
      .map((line) => {
        const clean = line.replace(/^[•\-*]\s*/, '').trim();
        return `<li>${escapeHtml(clean)}</li>`;
      })
      .join('');
    return `<ul class="faq-bullets">${items}</ul>`;
  }
  return `<p class="faq-text">${escapeHtml(answer)}</p>`;
}

function renderAftercareFaqList(list, faqs) {
  if (!list) return;

  if (!faqs.length) {
    if (!list.children.length) {
      list.innerHTML = '<p class="faq-empty">No downsizing guidance published yet.</p>';
    }
    return;
  }

  list.innerHTML = faqs
    .map(
      (faq) => `
      <div class="faq-item">
        <button class="faq-header" type="button" aria-expanded="false">
          <span class="faq-icon"><i class="ph ${getAftercareFaqIcon(faq.question)}" aria-hidden="true"></i></span>
          <span class="faq-title">${escapeHtml(faq.question)}</span>
          <i class="ph ph-caret-down chevron-icon" aria-hidden="true"></i>
        </button>
        <div class="faq-content">
          <div class="faq-content-inner">
            ${formatAftercareAnswer(faq.answer)}
          </div>
        </div>
      </div>
    `
    )
    .join('');
}

function applyFaqs(rows) {
  const faqs = faqItems(rows);
  const generalFaqs = faqs.filter((faq) => !isAftercareFaq(faq));
  const aftercareFaqs = faqs.filter(isAftercareFaq);

  renderFaqList(document.querySelector('.faq-accordion-list'), generalFaqs);

  document.querySelectorAll('[data-faq-category="Aftercare"]').forEach((list) => {
    renderAftercareFaqList(list, aftercareFaqs);
  });
}

/* -------------------------------------------------------------------------
   BOOKING INFO
   ------------------------------------------------------------------------- */

function applyBookingInfo(booking) {
  if (!booking || typeof booking !== 'object') return;

  const subtitle = document.getElementById('stepSubtitle');
  if (subtitle && hasText(booking.intro)) subtitle.textContent = booking.intro.trim();

  const paymentMethod = document.getElementById('paymentMethod');
  const methods = String(booking.paymentMethods || '')
    .split(',')
    .map((method) => method.trim())
    .filter(Boolean);

  if (paymentMethod && methods.length) {
    // Each supported method has its own QR design asset (assets/images/qr-*),
    // so they always stay selectable even if the saved list has drifted. The
    // admin's saved order is preserved, and any bundled method missing from the
    // saved list is appended so its QR card remains reachable.
    const supportedMethods = ['GCash', 'Maya', 'BPI', 'GoTyme', 'Maribank'];
    const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    const canonical = (value) =>
      supportedMethods.find((method) => slug(method) === slug(value)) || value.trim();

    const orderedMethods = [];
    [...methods, ...supportedMethods].forEach((method) => {
      const name = canonical(method);
      if (!name) return;
      if (!orderedMethods.some((existing) => slug(existing) === slug(name))) {
        orderedMethods.push(name);
      }
    });

    paymentMethod.innerHTML = orderedMethods
      .map((method) => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`)
      .join('');
  }

  const depositNote = document.querySelector('#paymentMethod ~ .field-note');
  if (depositNote && (hasText(booking.depositAmount) || hasText(booking.depositNote))) {
    const amount = hasText(booking.depositAmount) ? `\u20B1${booking.depositAmount.trim()}` : 'A';
    const note = hasText(booking.depositNote) ? booking.depositNote.trim() : '';
    depositNote.textContent = `NOTE: ${amount} down payment required to secure your slot.${
      note ? ` ${note}` : ''
    }`;
  }

  const panel = document.getElementById('bookingInfoPanel');
  const policyList = document.getElementById('bookingPolicyList');
  if (!panel || !policyList) return;

  const policies = [
    ['Booking window', booking.leadTime],
    ['Rescheduling', booking.reschedulePolicy],
    ['Cancellations', booking.cancellationPolicy],
    ['On the day', booking.arrivalInstructions]
  ].filter(([, value]) => hasText(value));

  if (!policies.length) {
    panel.hidden = true;
    return;
  }

  policyList.innerHTML = policies
    .map(
      ([label, value]) =>
        `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value.trim())}</li>`
    )
    .join('');
  panel.hidden = false;
}

/* -------------------------------------------------------------------------
   BOOTSTRAP
   ------------------------------------------------------------------------- */

let lastContentFingerprint = '';
let refreshInFlight = null;
let refreshQueued = false;

const fingerprintTable = (result) => {
  if (result.status !== 'fulfilled') return null;
  const rows = Array.isArray(result.value) ? result.value : [result.value];
  return [...rows]
    .filter(Boolean)
    .sort((a, b) => String(a.id || a.key || '').localeCompare(String(b.id || b.key || '')));
};

export async function applySiteContent() {
  if (!isSupabaseConfigured()) return false;

  const settled = await Promise.allSettled([
    loadSetting('home'),
    loadTable('artist_profiles'),
    loadTable('faqs'),
    loadSetting('booking'),
    loadTable('site_images')
  ]);

  const [home, artists, faqs, booking, images] = settled;
  const fingerprint = JSON.stringify([
    fingerprintTable(home),
    fingerprintTable(artists),
    fingerprintTable(faqs),
    fingerprintTable(booking),
    fingerprintTable(images)
  ]);

  // Polling and focus refreshes run frequently. Skip the DOM work entirely
  // when the published data has not changed so carousels and scroll state are
  // not reset for visitors who are simply browsing.
  if (fingerprint === lastContentFingerprint) return false;
  lastContentFingerprint = fingerprint;

  if (home.status === 'fulfilled' && home.value) {
    applyHomeCopy(home.value);
    renderHeroBanners(home.value);
    applySiteContact(home.value);
  }

  const imageRows = images.status === 'fulfilled' ? images.value : [];

  if (artists.status === 'fulfilled') applyArtists(artists.value, imageRows);
  if (faqs.status === 'fulfilled') applyFaqs(faqs.value);
  if (booking.status === 'fulfilled') applyBookingInfo(booking.value);
  // An unavailable image table behaves like an empty one so the public site
  // hides the sections instead of showing blank gaps.
  applySiteImages(imageRows, images.status === 'fulfilled');

  // Page controllers (FAQ accordions, artist previews, lightboxes) listen for
  // this event to re-bind content that was just re-rendered.
  document.dispatchEvent(
    new CustomEvent('paulina:content-updated', { detail: { changedAt: Date.now() } })
  );

  return true;
}

function refreshSiteContent() {
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }

  refreshInFlight = applySiteContent()
    .catch((error) => {
      console.warn('[site-content] Could not load published content:', error?.message || error);
      return false;
    })
    .finally(() => {
      refreshInFlight = null;
      if (refreshQueued) {
        refreshQueued = false;
        refreshSiteContent();
      }
    });

  return refreshInFlight;
}

window.refreshSiteContent = refreshSiteContent;

let refreshTimer = null;
function scheduleContentRefresh() {
  if (refreshTimer) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    refreshSiteContent();
  }, 350);
}

function startContentRefreshLoop() {
  if (!isSupabaseConfigured()) return;

  // Supabase Realtime gives near-instant updates when the admin publishes.
  // Polling + focus/visibility checks keep working on projects where Realtime
  // has not been enabled for these tables.
  try {
    const channel = supabase.channel('paulina-site-content');
    ['site_settings', 'artist_profiles', 'faqs', 'site_images'].forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleContentRefresh
      );
    });
    channel.subscribe();
  } catch (error) {
    console.warn('[site-content] Realtime unavailable, using polling.', error?.message || error);
  }

  window.addEventListener('focus', scheduleContentRefresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleContentRefresh();
  });
  window.setInterval(scheduleContentRefresh, 30000);
}

if (document.readyState === 'loading') {
  window.__PAULINA_SITE_CONTENT__ = new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(refreshSiteContent()), { once: true });
  });
  document.addEventListener('DOMContentLoaded', startContentRefreshLoop, { once: true });
} else {
  window.__PAULINA_SITE_CONTENT__ = refreshSiteContent();
  startContentRefreshLoop();
}
