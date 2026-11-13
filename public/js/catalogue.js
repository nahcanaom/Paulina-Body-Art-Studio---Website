/**
 * PAULINA BODY ART STUDIO - CATALOGUE SCRIPT
 * Dynamic catalogue rendering with search, filters, and order modal.
 *
 * Products come from /api/catalogue, the same Express store the admin
 * Catalogue page writes to. Reading Supabase directly here used to show a
 * different (admin-only) dataset than the public site.
 * Local demo records are supplied by Express only when PAULINA_ENV=demo.
 */

// -------------------------------------------------------------------------
// 1. Load products from the public API
// -------------------------------------------------------------------------

let products = [];
let liveMode = false;

function normalizeCatalogProduct(item) {
  if (!item) return null;
  const categories = Array.isArray(item.category)
    ? item.category
    : [item.category, item.subcategory].filter(Boolean);

  const media = (url) => (window.paulinaMediaUrl ? window.paulinaMediaUrl(url) : url);
  let rawImg = media(
    item.imageUrl || item.image_url || item.image || (Array.isArray(item.images) && item.images[0]) || ''
  );
  let rawImages = (Array.isArray(item.images) && item.images.length > 0 ? item.images : [rawImg]).map(media);

  return {
    id: item.id,
    name: item.name || item.title || 'Untitled Piercing',
    material: item.material || 'ASTM F136 Titanium',
    price: Number(item.price ?? 600),
    category: categories.length > 0 ? categories : ['Ear', 'Helix'],
    subcategory: item.subcategory || 'Helix',
    sizes: Array.isArray(item.sizes) && item.sizes.length > 0 ? item.sizes : ['4mm', '3mm', '2mm'],
    activeSize: item.activeSize || (Array.isArray(item.sizes) && item.sizes[0]) || '4mm',
    image: rawImg,
    images: rawImages,
    socialMedia: item.socialMedia || item.social_media || 'Instagram'
  };
}

async function loadProducts() {
  try {
    const res = await fetch(window.paulinaApiUrl('/api/catalogue'));
    if (res.ok) {
      const data = await res.json();
      // An empty published catalogue is a valid response: render it instead of
      // falling back to demo products that do not exist on the live site.
      if (data.success && Array.isArray(data.items)) {
        if (data.demo && !document.getElementById('demoNotice')) {
          const notice = document.createElement('p');
          notice.id = 'demoNotice';
          notice.style.cssText = 'color:#faf6f0;padding:12px 0;grid-column:1/-1';
          notice.textContent = 'Local demo — bundled jewellery photos; prices, sizes and placement are samples.';
          document.getElementById('productGrid')?.before(notice);
        }
        products = data.items.map(normalizeCatalogProduct).filter(Boolean);
        liveMode = true;
        window.__PAULINA_CATALOGUE_LIVE = true;
        window.__PAULINA_PRODUCTS = products;
        renderProducts();
        return;
      }
    }
  } catch (err) {
    console.warn('[catalogue] Local API unavailable, checking alternatives:', err.message);
  }

  // No backend means no catalogue: render the empty state instead of demo
  // products that are not published from the admin dashboard.
  products = [];
  liveMode = false;
  window.__PAULINA_CATALOGUE_LIVE = false;
  window.__PAULINA_PRODUCTS = products;
  renderProducts();
}

function initRealtimeSync() {
  try {
    const evtSource = new EventSource(window.paulinaApiUrl('/api/catalogue/stream'));
    evtSource.addEventListener('catalogue_change', async () => {
      console.log('[SSE] Synchronizing catalogue updates from admin...');
      const res = await fetch(window.paulinaApiUrl('/api/catalogue'));
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
          const activeMap = new Map();
          products.forEach((p) => {
            if (p.activeSize) activeMap.set(String(p.id), p.activeSize);
          });
          products = data.items.map((item) => {
            const norm = normalizeCatalogProduct(item);
            if (activeMap.has(String(norm.id))) {
              norm.activeSize = activeMap.get(String(norm.id));
            }
            return norm;
          });
          renderProducts();
          if (currentModalProductId) {
            const modalProd = products.find((p) => String(p.id) === String(currentModalProductId));
            if (modalProd) {
              openOrderModal(modalProd.id);
            }
          }
        }
      }
    });
  } catch (err) {
    console.warn('[SSE] Catalogue sync not supported:', err);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initRealtimeSync();
  await loadProducts();
  applySearchDeepLink();
});

// -------------------------------------------------------------------------
// 2. State
// -------------------------------------------------------------------------

let searchQuery = "";
let activeCategories = [];
let currentSort = "az";

// Pagination: the grid starts with six products until "Load More" is pressed.
const PRODUCTS_PER_PAGE = 6;
let visibleProductCount = PRODUCTS_PER_PAGE;
let lastFilteredCount = 0;
let lastRenderSignature = null;

let currentModalImages = [];
let currentModalImageIndex = 0;
let currentModalFailedImages = new Set();
const failedProductImagePaths = new Set();
let lastModalTrigger = null;

let currentModalProductId = null;

let toastTimer;

// -------------------------------------------------------------------------
// 3. DOM elements
// -------------------------------------------------------------------------

const productGrid = document.getElementById("productGrid");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");

const filterCheckboxes = document.querySelectorAll(".filter-cb");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const noResults = document.getElementById("noResults");
const resetSearchBtn = document.getElementById("resetSearchBtn");

const filterTriggerBtn = document.getElementById("filterTriggerBtn");
const filterBadge = document.getElementById("filterBadge");
const closeFiltersBtn = document.getElementById("closeFiltersBtn");
const filterBackdrop = document.getElementById("filterBackdrop");
const filtersPanel = document.getElementById("filtersPanel");

const orderModal = document.getElementById("orderModal");
const modalContainer = document.getElementById("modalContainer");
const closeModalBtn = document.getElementById("closeModalBtn");

const modalItemName = document.getElementById("modalItemName");
const modalItemMaterial = document.getElementById("modalItemMaterial");
const modalItemPrice = document.getElementById("modalItemPrice");

const modalSizeOptions = document.getElementById("modalSizeOptions");
const modalMainImage = document.getElementById("modalMainImage");
const modalThumbnailBar = document.getElementById("modalThumbnailBar");
const modalImageCounter = document.getElementById("modalImageCounter");
const modalGalleryStatus = document.getElementById("modalGalleryStatus");
const modalMedia = document.querySelector(".modal-media");

const modalPrevImageBtn = document.getElementById("modalPrevImageBtn");
const modalNextImageBtn = document.getElementById("modalNextImageBtn");

const toast = document.getElementById("toast");

// -------------------------------------------------------------------------
// 4. Render products
// -------------------------------------------------------------------------

function renderProducts() {
  if (!productGrid) return;

  let filtered = products.filter(product => {
    const query = searchQuery.toLowerCase();

    const matchesSearch =
      product.name.toLowerCase().includes(query) ||
      product.material.toLowerCase().includes(query) ||
      product.category.some(category =>
        category.toLowerCase().includes(query)
      );

    const matchesCategory =
      activeCategories.length === 0 ||
      activeCategories.some(category =>
        product.category.includes(category) ||
        (category === "Titanium" &&
          product.material.toLowerCase().includes("titanium")) ||
        (category === "Gold" &&
          product.material.toLowerCase().includes("gold")) ||
        (category === "Surgical Steel" &&
          product.material.toLowerCase().includes("steel"))
      );

    return matchesSearch && matchesCategory;
  });

  // Sort
  filtered.sort((a, b) => {
    if (currentSort === "az") {
      return a.name.localeCompare(b.name);
    }
    if (currentSort === "za") {
      return b.name.localeCompare(a.name);
    }
    if (currentSort === "price-low") {
      return a.price - b.price;
    }
    if (currentSort === "price-high") {
      return b.price - a.price;
    }
    return 0;
  });

  // A new search, filter or sort starts the list again from the first page.
  const renderSignature = JSON.stringify([searchQuery, activeCategories, currentSort]);

  if (renderSignature !== lastRenderSignature) {
    lastRenderSignature = renderSignature;
    visibleProductCount = PRODUCTS_PER_PAGE;
  }

  lastFilteredCount = filtered.length;

  // No results
  if (filtered.length === 0) {
    productGrid.innerHTML = "";
    noResults.classList.remove("hidden");
    loadMoreBtn?.closest(".load-more-row")?.classList.add("hidden");
    return;
  }

  noResults.classList.add("hidden");

  // Product cards (first page only until "Load More" reveals the rest)
  const visibleProducts = filtered.slice(0, visibleProductCount);

  productGrid.innerHTML = visibleProducts.map(product => {
    const isLive = window.__PAULINA_CATALOGUE_LIVE && products === window.__PAULINA_PRODUCTS;
    const imgSrc = isLive && product.image
      ? product.image
      : (product.images && product.images.length > 0 ? product.images[0] : '');

    return `<div class="product-card">
      <button type="button" class="product-media" data-action="open-order" data-product-id="${product.id}" aria-label="View ${product.name} details">
        <img src="${imgSrc}" alt="${product.name}" class="product-image" loading="lazy" onerror="this.style.display='none'; this.parentElement.classList.add('media-missing');">
      </button>
      <div>
        <div class="product-headline">
          <h3 class="product-name">${product.name}</h3>
          <span class="product-price">₱ ${product.price.toLocaleString("en-PH")}</span>
        </div>
        <p class="product-material">${product.material}</p>
        <div class="size-pills">
          ${product.sizes.map(size => {
            const isActive = product.activeSize === size;
            return `<button type="button" data-action="select-size" data-product-id="${product.id}" data-size="${size}" aria-pressed="${isActive}" class="size-pill${isActive ? " is-active" : ""}">${size}</button>`;
          }).join("")}
        </div>
      </div>
      <button type="button" data-action="open-order" data-product-id="${product.id}" class="order-btn">Order via Instagram</button>
    </div>`;
  }).join("");

  updateLoadMoreButton(filtered.length);
}

function updateLoadMoreButton(totalProducts) {
  if (!loadMoreBtn) return;

  const hasMore = totalProducts > visibleProductCount;

  loadMoreBtn.closest(".load-more-row")?.classList.toggle("hidden", !hasMore);
  loadMoreBtn.disabled = !hasMore;
}

// -------------------------------------------------------------------------
// 5. Product size and card click events
// -------------------------------------------------------------------------

productGrid?.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");

  if (!button) return;

  const productId = button.dataset.productId;
  const product = products.find(item => String(item.id) === String(productId));

  if (!product) return;

  if (button.dataset.action === "select-size") {
    product.activeSize = button.dataset.size;
    renderProducts();
  }

  if (button.dataset.action === "open-order") {
    openOrderModal(productId);
  }
});

// -------------------------------------------------------------------------
// 6. Modal image gallery
// -------------------------------------------------------------------------

function getProductImages(product) {
  const gallery = [product.image, ...(Array.isArray(product.images) ? product.images : [])].filter(
    Boolean
  );

  return [...new Set(gallery)].filter(image => !failedProductImagePaths.has(image));
}

function preloadModalImage(src) {
  if (!src) return;
  const image = new Image();
  image.src = src;
}

function preloadAdjacentModalImages() {
  if (currentModalImages.length < 2) return;

  const nextIndex = (currentModalImageIndex + 1) % currentModalImages.length;
  const previousIndex = (currentModalImageIndex - 1 + currentModalImages.length) % currentModalImages.length;

  preloadModalImage(currentModalImages[nextIndex]);
  preloadModalImage(currentModalImages[previousIndex]);
}

function renderModalGallery() {
  if (!modalMainImage || !modalThumbnailBar) return;

  // No photography at all: show the styled placeholder.
  if (!currentModalImages.length) {
    modalMainImage.removeAttribute("src");
    modalMainImage.alt = "";

    modalMedia?.classList.add("media-missing");
    modalThumbnailBar.innerHTML = "";

    modalPrevImageBtn?.classList.add("hidden");
    modalNextImageBtn?.classList.add("hidden");

    if (modalImageCounter) {
      modalImageCounter.classList.add("hidden");
    }

    if (modalGalleryStatus) {
      modalGalleryStatus.textContent = "No photos available yet.";
    }

    return;
  }

  // Keep the index inside the list at all times.
  currentModalImageIndex = (currentModalImageIndex % currentModalImages.length + currentModalImages.length) % currentModalImages.length;

  const activeImage = currentModalImages[currentModalImageIndex];
  const productName = modalItemName?.textContent?.trim() || "Piercing";
  const availableImages = currentModalImages.filter(image => !currentModalFailedImages.has(image));
  const availableTotal = Math.max(availableImages.length, 1);
  const availablePosition = Math.max(availableImages.indexOf(activeImage) + 1, 1);

  modalMainImage.src = activeImage;
  modalMainImage.alt = `${productName} — photo ${availablePosition} of ${availableTotal}`;

  // Reset the placeholder state whenever a new source is loaded.
  modalMainImage.style.visibility = "visible";

  if (modalMainImage.complete && modalMainImage.naturalWidth > 0) {
    modalMainImage.classList.remove("is-loading");
  } else {
    modalMainImage.classList.add("is-loading");
  }

  modalMedia?.classList.remove("media-missing");

  modalThumbnailBar.innerHTML = currentModalImages
    .map((image, index) => {
      if (currentModalFailedImages.has(image)) return "";

      return `<button type="button" data-gallery-index="${index}" aria-label="View photo ${index + 1} of ${currentModalImages.length}" aria-pressed="${index === currentModalImageIndex}" class="modal-thumb${index === currentModalImageIndex ? " is-active" : ""}">

        <img src="${image}" alt="" class="modal-thumb-img" onerror="this.parentElement.classList.add('is-missing')">
      </button>`;
    })
    .join("");

  const hasMultipleImages = availableImages.length > 1;

  modalPrevImageBtn?.classList.toggle("hidden", !hasMultipleImages);
  modalNextImageBtn?.classList.toggle("hidden", !hasMultipleImages);

  if (modalImageCounter) {
    modalImageCounter.textContent = `${availablePosition} / ${availableTotal}`;
    modalImageCounter.classList.toggle("hidden", !hasMultipleImages);
  }

  if (modalGalleryStatus) {
    modalGalleryStatus.textContent = `Photo ${availablePosition} of ${availableTotal}: ${productName}`;
  }

  // Keep the selected thumbnail centred in the strip without scrolling the modal.
  const activeThumb = modalThumbnailBar.querySelector(".modal-thumb.is-active");

  if (activeThumb && modalThumbnailBar) {
    const centredLeft = activeThumb.offsetLeft - (modalThumbnailBar.clientWidth - activeThumb.offsetWidth) / 2;

    modalThumbnailBar.scrollTo({
      left: Math.max(0, centredLeft),
      behavior: "smooth",
    });
  }

  preloadAdjacentModalImages();
}

function stepModalGallery(direction) {
  const total = currentModalImages.length;

  if (total < 2) return;

  // Skip any photo that failed to load.
  for (let step = 1; step < total; step += 1) {
    const index = (currentModalImageIndex + direction * step + total) % total;

    if (!currentModalFailedImages.has(currentModalImages[index])) {
      currentModalImageIndex = index;
      renderModalGallery();
      return;
    }
  }

  // Every photo failed: fall back to the CSS placeholder.
  modalMainImage.classList.remove("is-loading");
  modalMainImage.style.visibility = "hidden";

  modalMedia?.classList.add("media-missing");
  modalPrevImageBtn?.classList.add("hidden");
  modalNextImageBtn?.classList.add("hidden");
  modalImageCounter?.classList.add("hidden");
}

function handleModalImageError() {
  const failedImage = currentModalImages[currentModalImageIndex];

  if (failedImage) {
    currentModalFailedImages.add(failedImage);
    failedProductImagePaths.add(failedImage);
  }

  // Try the next working photo before giving up.
  for (let step = 1; step < currentModalImages.length; step += 1) {
    const nextIndex = (currentModalImageIndex + step) % currentModalImages.length;

    if (!currentModalFailedImages.has(currentModalImages[nextIndex])) {
      currentModalImageIndex = nextIndex;
      renderModalGallery();
      return;
    }
  }

  // Every photo failed: fall back to the CSS placeholder.
  modalMainImage.classList.remove("is-loading");
  modalMainImage.style.visibility = "hidden";

  modalMedia?.classList.add("media-missing");
  modalPrevImageBtn?.classList.add("hidden");
  modalNextImageBtn?.classList.add("hidden");
  modalImageCounter?.classList.add("hidden");
}

modalMainImage?.addEventListener("load", () => {
  modalMainImage.classList.remove("is-loading");
  modalMainImage.style.visibility = "";
  modalMedia?.classList.remove("media-missing");
});

modalMainImage?.addEventListener("error", handleModalImageError);

// -------------------------------------------------------------------------
// 7. Size options inside modal
// -------------------------------------------------------------------------

function renderModalSizes(product) {
  if (!modalSizeOptions) return;

  // Sizes are reference only: each product has a single photo, so the modal
  // lists the available sizes without letting shoppers switch between them.
  modalSizeOptions.innerHTML = product.sizes.map(size => {
    const isActive = product.activeSize === size;

    return `<span class="size-pill${isActive ? " is-active" : ""}" aria-disabled="true">${size}</span>`;
  }).join("");
}

// -------------------------------------------------------------------------
// 8. Open order modal
// -------------------------------------------------------------------------

function openOrderModal(productId) {
  const product = products.find(item => String(item.id) === String(productId));

  if (!product || !orderModal || !modalContainer) return;

  modalItemName.textContent = product.name;
  modalItemMaterial.textContent = product.material;

  renderModalSizes(product);

  modalItemPrice.textContent = `₱ ${Number(product.price).toLocaleString("en-PH")}`;

  const igOrderBtn = document.getElementById("igOrderBtn");
  if (igOrderBtn) {
    if (product.socialMedia && product.socialMedia.startsWith("http")) {
      igOrderBtn.href = product.socialMedia;
    } else {
      igOrderBtn.href = "https://www.instagram.com/paulinabodyart/";
    }
  }

  currentModalImages = getProductImages(product);
  currentModalImageIndex = 0;
  currentModalFailedImages = new Set();
  currentModalProductId = productId;

  lastModalTrigger =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  renderModalGallery();

  orderModal.classList.add("is-open");
  orderModal.setAttribute("aria-hidden", "false");

  modalContainer.scrollTop = 0;

  document.body.classList.add("overflow-hidden");

  closeModalBtn?.focus({ preventScroll: true });
}

// -------------------------------------------------------------------------
// 9. Close order modal
// -------------------------------------------------------------------------

function closeOrderModal() {
  if (!orderModal || !modalContainer) return;

  orderModal.classList.remove("is-open");
  orderModal.setAttribute("aria-hidden", "true");

  currentModalProductId = null;

  document.body.classList.remove("overflow-hidden");

  if (lastModalTrigger?.isConnected) {
    lastModalTrigger.focus({ preventScroll: true });
  }

  lastModalTrigger = null;
}

closeModalBtn?.addEventListener("click", closeOrderModal);

// Close Button
orderModal?.addEventListener("click", event => {
  if (event.target === orderModal) {
    closeOrderModal();
  }
});

// Click Inside Modal
modalContainer?.addEventListener("click", event => {
  event.stopPropagation();
});

// Keyboard Support: Escape closes, arrow keys change photo
document.addEventListener("keydown", event => {
  if (!orderModal?.classList.contains("is-open")) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeOrderModal();
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepModalGallery(-1);
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    stepModalGallery(1);
  }
});

// -------------------------------------------------------------------------
// 9. Image navigation
// -------------------------------------------------------------------------

modalPrevImageBtn?.addEventListener("click", event => {
  event.stopPropagation();
  stepModalGallery(-1);
});

modalNextImageBtn?.addEventListener("click", event => {
  event.stopPropagation();
  stepModalGallery(1);
});

// Swipe between photos on touch devices
let modalSwipeStartX = null;
let modalSwipeStartY = null;

modalMedia?.addEventListener("touchstart", event => {
  if (event.touches.length !== 1) return;

  modalSwipeStartX = event.touches[0].clientX;
  modalSwipeStartY = event.touches[0].clientY;
}, { passive: true });

modalMedia?.addEventListener("touchend", event => {
  if (modalSwipeStartX === null || event.changedTouches.length === 0) {
    return;
  }

  const deltaX = event.changedTouches[0].clientX - modalSwipeStartX;
  const deltaY = event.changedTouches[0].clientY - modalSwipeStartY;

  modalSwipeStartX = null;
  modalSwipeStartY = null;

  if (Math.abs(deltaX) < 45 || Math.abs(deltaX) < Math.abs(deltaY)) {
    return;
  }

  stepModalGallery(deltaX < 0 ? 1 : -1);
}, { passive: true });

modalThumbnailBar?.addEventListener("click", event => {
  const thumbnail = event.target.closest("[data-gallery-index]");

  if (!thumbnail) return;

  const index = Number(thumbnail.dataset.galleryIndex);

  if (!Number.isInteger(index) || index === currentModalImageIndex) return;

  currentModalImageIndex = index;
  renderModalGallery();
});

// Modal Size Selection
modalSizeOptions?.addEventListener("click", event => {
  const pill = event.target.closest("[data-modal-size]");

  if (!pill || currentModalProductId == null) return;

  const product = products.find(item => item.id === currentModalProductId);

  if (!product) return;

  product.activeSize = pill.dataset.modalSize;

  renderModalSizes(product);
  renderProducts();
});

// -------------------------------------------------------------------------
// 10. Toast notification
// -------------------------------------------------------------------------

function showToast(message) {
  const toastMsg = document.getElementById("toastMsg");

  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;

  toast.classList.add("show-toast");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show-toast");
  }, 3000);
}

// -------------------------------------------------------------------------
// 11. Search with debounced, real-time suggestions
// -------------------------------------------------------------------------

const searchSuggestions = document.getElementById("searchSuggestions");
const SUGGESTION_DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 6;

let suggestionTimer = null;
let suggestionRequest = null;
let suggestionResults = [];
let activeSuggestionIndex = -1;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function highlightSuggestion(label, query) {
  const text = String(label ?? "");
  const needle = String(query ?? "").trim();
  const index = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;

  if (index === -1) return escapeHtml(text);

  return [
    escapeHtml(text.slice(0, index)),
    `<mark>${escapeHtml(text.slice(index, index + needle.length))}</mark>`,
    escapeHtml(text.slice(index + needle.length))
  ].join("");
}

function hideSuggestions() {
  if (!searchSuggestions) return;

  searchSuggestions.hidden = true;
  searchSuggestions.innerHTML = "";
  suggestionResults = [];
  activeSuggestionIndex = -1;
  searchInput?.setAttribute("aria-expanded", "false");
  searchInput?.removeAttribute("aria-activedescendant");
}

function setActiveSuggestion(index) {
  if (!searchSuggestions || suggestionResults.length === 0) return;

  const options = searchSuggestions.querySelectorAll(".suggestion-option");
  activeSuggestionIndex = (index + options.length) % options.length;

  options.forEach((option, optionIndex) => {
    const isActive = optionIndex === activeSuggestionIndex;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-selected", String(isActive));

    if (isActive) {
      searchInput?.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  });
}

function renderSuggestions(query, items) {
  if (!searchSuggestions) return;

  suggestionResults = items.slice(0, SUGGESTION_LIMIT);
  activeSuggestionIndex = -1;

  if (suggestionResults.length === 0) {
    hideSuggestions();
    return;
  }

  searchSuggestions.innerHTML = suggestionResults.map((item, index) => {
    const meta = [item.category, item.subcategory].filter(Boolean).join(" · ");

    return `<a class="suggestion-option" id="suggestion-${escapeHtml(item.id)}" role="option" aria-selected="false" href="?q=${encodeURIComponent(item.name)}" data-suggestion-id="${escapeHtml(item.id)}" data-suggestion-index="${index}">
      <img class="suggestion-thumb" src="${escapeHtml(item.image)}" alt="" loading="lazy">
      <span class="suggestion-copy">
        <span class="suggestion-name">${highlightSuggestion(item.name, query)}</span>
        <span class="suggestion-meta">
          <span class="suggestion-category">${escapeHtml(meta)}</span>
          <span class="suggestion-price">₱ ${Number(item.price).toLocaleString("en-PH")}</span>
        </span>
      </span>
    </a>`;
  }).join("");

  searchSuggestions.hidden = false;
  searchInput?.setAttribute("aria-expanded", "true");
}

async function requestSuggestions(query) {
  if (!query) {
    hideSuggestions();
    return;
  }

  suggestionRequest?.abort();

  const controller = new AbortController();
  suggestionRequest = controller;

  try {
    const response = await fetch(
      window.paulinaApiUrl(`/api/catalogue/suggest?q=${encodeURIComponent(query)}&limit=${SUGGESTION_LIMIT}`),
      { signal: controller.signal, headers: { Accept: "application/json" } }
    );

    if (!response.ok) throw new Error(`Suggestions request failed (${response.status})`);

    const data = await response.json();

    if (!data.success || !Array.isArray(data.suggestions)) {
      throw new Error("Unexpected suggestions response");
    }

    renderSuggestions(query, data.suggestions);
  } catch (error) {
    if (error.name === "AbortError") return;

    // No backend? Match against the already-loaded catalogue instead.
    const needle = query.toLowerCase();
    const localMatches = products
      .filter(product =>
        product.name.toLowerCase().includes(needle) ||
        product.category.some(category => category.toLowerCase().includes(needle)) ||
        product.material.toLowerCase().includes(needle)
      )
      .map(product => ({
        id: product.id,
        name: product.name,
        category: product.category[0],
        subcategory: product.subcategory,
        price: product.price,
        image: product.image
      }));

    renderSuggestions(query, localMatches);
  } finally {
    if (suggestionRequest === controller) suggestionRequest = null;
  }
}

function selectSuggestion(item) {
  if (!item) return;

  hideSuggestions();

  if (searchInput) searchInput.value = item.name;

  searchQuery = item.name;
  renderProducts();
  openOrderModal(item.id);
}

searchInput?.addEventListener("input", event => {
  const query = event.target.value.trim();

  searchQuery = query;
  renderProducts();

  clearTimeout(suggestionTimer);

  if (!query) {
    hideSuggestions();
    return;
  }

  suggestionTimer = setTimeout(() => requestSuggestions(query), SUGGESTION_DEBOUNCE_MS);
});

searchInput?.addEventListener("keydown", event => {
  if (!searchSuggestions || searchSuggestions.hidden) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveSuggestion(activeSuggestionIndex + 1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveSuggestion(activeSuggestionIndex - 1);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    hideSuggestions();
    return;
  }

  if (event.key === "Enter" && activeSuggestionIndex >= 0) {
    event.preventDefault();
    selectSuggestion(suggestionResults[activeSuggestionIndex]);
  }
});

searchSuggestions?.addEventListener("click", event => {
  const option = event.target.closest("[data-suggestion-id]");

  if (!option) return;

  event.preventDefault();

  const item = suggestionResults.find(suggestion => String(suggestion.id) === String(option.dataset.suggestionId));

  selectSuggestion(item);
});

document.addEventListener("click", event => {
  if (!searchSuggestions || searchSuggestions.hidden) return;
  if (event.target.closest(".search-box")) return;

  hideSuggestions();
});

// Deep links keep a search shareable and crawlable: catalogue.html?q=helix
function applySearchDeepLink() {
  let params;

  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }

  const query = (params.get("q") || "").trim();

  if (query && searchInput) {
    searchInput.value = query;
    searchQuery = query;
    renderProducts();
    document.title = `${query} — Piercing Catalogue | PAULINA Body Art Studio`;
  }

  const productId = (params.get("product") || "").trim();

  if (productId && products.some(product => String(product.id) === String(productId))) {
    openOrderModal(productId);
  }
}

// -------------------------------------------------------------------------
// 12. Sorting
// -------------------------------------------------------------------------

sortSelect?.addEventListener("change", event => {
  currentSort = event.target.value;
  renderProducts();
});

// -------------------------------------------------------------------------
// 13. Filter checkboxes
// -------------------------------------------------------------------------

filterCheckboxes.forEach(checkbox => {
  checkbox.addEventListener("change", () => {
    activeCategories = Array.from(filterCheckboxes)
      .filter(item => item.checked)
      .map(item => item.value);

    updateFilterBadge();
    renderProducts();
  });
});

// -------------------------------------------------------------------------
// 14. Clear and reset filters
// -------------------------------------------------------------------------

function clearFilters() {
  filterCheckboxes.forEach(checkbox => {
    checkbox.checked = false;
  });

  activeCategories = [];
  searchQuery = "";

  if (searchInput) {
    searchInput.value = "";
  }

  updateFilterBadge();
  renderProducts();
}

clearFiltersBtn?.addEventListener("click", clearFilters);
resetSearchBtn?.addEventListener("click", clearFilters);

// -------------------------------------------------------------------------
// 15. Mobile filters: badge + off-canv as drawer
// -------------------------------------------------------------------------

function updateFilterBadge() {
  if (!filterBadge) return;

  const count = Array.from(filterCheckboxes).filter(item => item.checked).length;

  filterBadge.textContent = `(${count})`;
  filterBadge.hidden = count === 0;

  filterTriggerBtn?.setAttribute(
    "aria-label",
    count === 0
      ? "Filter and sort"
      : `Filter and sort, ${count} filter${count === 1 ? "" : "s"} active`
  );
}

function openFiltersDrawer() {
  if (!filtersPanel) return;

  filtersPanel.classList.add("is-open");
  filterBackdrop?.classList.add("is-open");
  filterTriggerBtn?.setAttribute("aria-expanded", "true");
  document.body.classList.add("overflow-hidden");
  document.body.classList.add("filters-drawer-open");

  closeFiltersBtn?.focus();
}

function closeFiltersDrawer() {
  filtersPanel?.classList.remove("is-open");
  filterBackdrop?.classList.remove("is-open");
  filterTriggerBtn?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("overflow-hidden");
  document.body.classList.remove("filters-drawer-open");

  filterTriggerBtn?.focus();
}

filterTriggerBtn?.addEventListener("click", openFiltersDrawer);
closeFiltersBtn?.addEventListener("click", closeFiltersDrawer);
filterBackdrop?.addEventListener("click", closeFiltersDrawer);

// Close the drawer automatically when crossing into the desktop layout
const desktopFilterQuery = window.matchMedia("(min-width: 769px)");

desktopFilterQuery.addEventListener("change", event => {
  if (event.matches) {
    closeFiltersDrawer();
  }
});

// -------------------------------------------------------------------------
// 16. Load more products
// -------------------------------------------------------------------------

if (loadMoreBtn) {
  loadMoreBtn.textContent = "LOAD MORE";
  loadMoreBtn.disabled = false;

  loadMoreBtn.classList.remove("is-disabled");

  loadMoreBtn.addEventListener("click", () => {
    if (lastFilteredCount <= visibleProductCount) return;

    visibleProductCount = lastFilteredCount;
    renderProducts();

    showToast("More piercings loaded!");
  });
}

// -------------------------------------------------------------------------
// 17. Back to top
// -------------------------------------------------------------------------

const backToTopBtn = document.getElementById("backToTopBtn");

function toggleBackToTop() {
  if (!backToTopBtn) return;

  backToTopBtn.classList.toggle("is-visible", window.scrollY > 400);
}

window.addEventListener("scroll", toggleBackToTop, { passive: true });

backToTopBtn?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

toggleBackToTop();

// -------------------------------------------------------------------------
// 18. Initialise catalogue
// -------------------------------------------------------------------------

renderProducts();
updateFilterBadge();
