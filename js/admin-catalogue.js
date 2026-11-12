/**
 * PAULINA BODY ART STUDIO — ADMIN CATALOGUE MANAGEMENT
 * Client-side Controller for Admin Catalogue Interface
 * Following the functional logic and implementation pattern of Gallery Management.
 */

(function () {
  'use strict';

  // API Endpoints
  const API_BASE = '/api/admin/catalogue';
  const SSE_ENDPOINT = '/api/catalogue/stream';

  // DOM Elements
  const catalogueGrid = document.getElementById('catalogueGrid');
  const emptyState = document.getElementById('catalogueEmptyState');
  const statusCounts = document.getElementById('statusCounts');
  const searchInput = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');
  const visibilityFilter = document.getElementById('visibilityFilter');
  const sortOrder = document.getElementById('sortOrder');
  const categoryPillsContainer = document.getElementById('categoryPills');

  // Pill count tags
  const countAll = document.getElementById('countAll');

  // Upload Dropzone
  const uploadDropzone = document.getElementById('uploadDropzone');
  const chooseFilesBtn = document.getElementById('chooseFilesBtn');
  const fileUploadInput = document.getElementById('fileUploadInput');
  const uploadProgressCard = document.getElementById('uploadProgressCard');
  const uploadProgressBar = document.getElementById('uploadProgressBar');
  const uploadStatusText = document.getElementById('uploadStatusText');

  // Edit Side Panel
  const editItemId = document.getElementById('editItemId');
  const editPanelTitle = document.getElementById('editPanelTitle');
  const editSelectedLabel = document.getElementById('editSelectedLabel');
  const editHeaderBadge = document.getElementById('editHeaderBadge');
  const editImagePreview = document.getElementById('editImagePreview');
  const changeImageBtn = document.getElementById('changeImageBtn');
  const changeImageInput = document.getElementById('changeImageInput');
  const editGalleryPrev = document.getElementById('editGalleryPrev');
  const editGalleryNext = document.getElementById('editGalleryNext');
  const editProductViewsSection = document.getElementById('editProductViewsSection');
  const editProductViewsStrip = document.getElementById('editProductViewsStrip');
  const editProductViewsStatus = document.getElementById('editProductViewsStatus');
  const editNameInput = document.getElementById('editNameInput');
  const editSizesRow = document.getElementById('editSizesRow');
  const editSocialMediaSelect = document.getElementById('editSocialMediaSelect');
  const editVisibilityToggle = document.getElementById('editVisibilityToggle');
  const visibilitySubtitle = document.getElementById('visibilitySubtitle');
  const editFeedbackMsg = document.getElementById('editFeedbackMsg');
  const saveChangesBtn = document.getElementById('saveChangesBtn');
  const discardChangesBtn = document.getElementById('discardChangesBtn');

  // Delete Modal
  const deleteModal = document.getElementById('deleteModal');
  const deleteTargetTitle = document.getElementById('deleteTargetTitle');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

  // State
  let catalogueData = [];
  let currentSelected = null;
  let currentSelectedSizes = ['4mm', '3mm', '2mm'];
  let currentActiveSize = '4mm';
  let currentEditImages = [];
  let currentEditImageIndex = 0;
  let deleteCandidateId = null;
  let activeFilter = {
    category: 'all',
    search: '',
    visibility: 'all',
    sort: 'newest'
  };

  /**
   * Helper: Escape HTML string
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Initialize Catalogue View
   */
  async function init() {
    bindEvents();
    initRealtime();
    await fetchCatalogue();
  }

  /**
   * Fetch catalogue list from backend API
   */
  async function fetchCatalogue() {
    try {
      const params = new URLSearchParams();
      if (activeFilter.category && activeFilter.category !== 'all') {
        params.set('category', activeFilter.category);
      }
      if (activeFilter.visibility && activeFilter.visibility !== 'all') {
        params.set('visibility', activeFilter.visibility);
      }
      if (activeFilter.search) {
        params.set('search', activeFilter.search);
      }
      if (activeFilter.sort) {
        params.set('sort', activeFilter.sort);
      }

      const res = await fetch(`${API_BASE}?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success) {
        catalogueData = data.items || [];
        updateStats(data.stats);
        renderGrid(catalogueData);

        // Auto-select first item or maintain selection
        if (catalogueData.length > 0) {
          if (!currentSelected || !catalogueData.some((i) => String(i.id) === String(currentSelected.id))) {
            selectItem(catalogueData[0]);
          } else {
            const updatedCurrent = catalogueData.find((i) => String(i.id) === String(currentSelected.id));
            selectItem(updatedCurrent);
          }
        } else {
          clearEditPanel();
        }
      }
    } catch (err) {
      console.error('[admin-catalogue] Failed to load items:', err);
      statusCounts.textContent = 'Failed to load catalogue items. Check connection.';
    }
  }

  /**
   * Update header badges and counts
   */
  function updateStats(stats) {
    if (!stats) return;
    const { total = 0, published = 0, draft = 0 } = stats;

    if (countAll) {
      countAll.textContent = `(${total})`;
    }

    statusCounts.textContent = `${total} images - ${published} published`;
  }

  /**
   * Render cards grid
   */
  function renderGrid(items) {
    catalogueGrid.innerHTML = '';

    if (!items || items.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    items.forEach((item) => {
      const isSelected = currentSelected && String(currentSelected.id) === String(item.id);
      const card = document.createElement('article');
      card.className = `catalogue-card ${isSelected ? 'selected' : ''}`;
      card.setAttribute('data-id', item.id);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      const isPub = item.isPublished;
      const badgeClass = isPub ? 'badge-published' : 'badge-draft';
      const badgeText = isPub ? 'Published' : 'Draft';

      const sizes = Array.isArray(item.sizes) && item.sizes.length > 0 ? item.sizes : ['4mm', '3mm', '2mm'];
      const activeSize = item.activeSize || sizes[0];

      const sizesHtml = sizes
        .map((s) => {
          const isActive = s === activeSize;
          return `<span class="size-pill-tag ${isActive ? 'active' : ''}" data-size="${escapeHtml(s)}">${escapeHtml(s)}</span>`;
        })
        .join('');

      card.innerHTML = `
        <div class="card-media-wrapper">
          <span class="badge-status ${badgeClass}">${badgeText}</span>
          <img src="${escapeHtml(item.thumbnailUrl || item.imageUrl)}" alt="${escapeHtml(item.name || item.title)}" loading="lazy">
        </div>
        <div class="card-content">
          <h4 class="card-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h4>
          <div class="card-sizes-row">
            ${sizesHtml}
          </div>
          <button type="button" class="btn-order-instagram">ORDER VIA INSTAGRAM</button>
          <div class="card-actions">
            <button type="button" class="btn-card-edit" title="Edit this item">
              <i class="ph ph-pencil-simple" aria-hidden="true"></i> Edit
            </button>
            <button type="button" class="btn-card-delete" title="Delete this item">
              <i class="ph ph-trash" aria-hidden="true"></i> Delete
            </button>
          </div>
        </div>
      `;

      // Interactive size click on card
      card.querySelectorAll('.size-pill-tag').forEach((pill) => {
        pill.addEventListener('click', async (e) => {
          e.stopPropagation();
          const chosen = pill.getAttribute('data-size');
          item.activeSize = chosen;
          card.querySelectorAll('.size-pill-tag').forEach((p) => {
            p.classList.toggle('active', p.getAttribute('data-size') === chosen);
          });
          if (currentSelected && String(currentSelected.id) === String(item.id)) {
            currentActiveSize = chosen;
            renderEditSizes();
          }
          try {
            await fetch(`${API_BASE}/${item.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ activeSize: chosen })
            });
          } catch (err) {
            console.warn('[admin-catalogue] Active size save failed:', err);
          }
        });
      });

      // Instagram order button
      const orderBtn = card.querySelector('.btn-order-instagram');
      if (orderBtn) {
        orderBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open('https://www.instagram.com/paulinabodyart/', '_blank', 'noopener,noreferrer');
        });
      }

      // Card selection event
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-card-delete')) {
          e.stopPropagation();
          openDeleteModal(item);
          return;
        }
        selectItem(item);
        openEditSheet(card);
      });

      // Keyboard parity for the card's role="button" affordance.
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        selectItem(item);
        openEditSheet(card);
      });

      catalogueGrid.appendChild(card);
    });
  }

  /**
   * Render sizes row in Edit Side Panel
   */
  function renderEditSizes() {
    if (!editSizesRow) return;
    editSizesRow.innerHTML = '';

    currentSelectedSizes.forEach((sz) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `edit-size-pill ${sz === currentActiveSize ? 'active' : ''}`;
      btn.setAttribute('data-size', sz);
      btn.textContent = sz;
      btn.addEventListener('click', () => {
        currentActiveSize = sz;
        renderEditSizes();
      });
      editSizesRow.appendChild(btn);
    });
  }


  /**
   * Resolve all view images associated with a catalogue product.
   * Mirrors the public catalogue gallery by showing every associated image.
   */
  function getProductViewImages(item) {
    if (!item) return [];
    const list = [];
    const push = (url) => {
      if (!url) return;
      const val = String(url).trim();
      if (!val) return;
      if (!list.includes(val)) list.push(val);
    };
    if (Array.isArray(item.images)) item.images.forEach(push);
    push(item.imageUrl);
    push(item.thumbnailUrl);
    return list;
  }

  function renderEditProductViews() {
    if (!editProductViewsStrip) return;

    editProductViewsStrip.innerHTML = '';
    const total = currentEditImages.length;

    if (editProductViewsSection) {
      editProductViewsSection.style.display = currentSelected ? 'flex' : 'none';
    }

    if (!total) {
      if (editProductViewsStatus) editProductViewsStatus.textContent = 'No product images available.';
      if (editGalleryPrev) editGalleryPrev.classList.remove('is-visible');
      if (editGalleryNext) editGalleryNext.classList.remove('is-visible');
      return;
    }

    currentEditImageIndex = Math.min(Math.max(currentEditImageIndex, 0), total - 1);
    const currentSrc = currentEditImages[currentEditImageIndex];

    if (editImagePreview && currentSrc) {
      editImagePreview.src = currentSrc;
    }

    const hasMultiple = total > 1;
    if (editGalleryPrev) editGalleryPrev.classList.toggle('is-visible', hasMultiple);
    if (editGalleryNext) editGalleryNext.classList.toggle('is-visible', hasMultiple);

    currentEditImages.forEach((src, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'edit-view-thumb ' + (index === currentEditImageIndex ? 'is-active' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(index === currentEditImageIndex));
      btn.setAttribute('aria-label', 'View image ' + (index + 1) + ' of ' + total);
      btn.dataset.index = String(index);

      const img = document.createElement('img');
      img.className = 'edit-view-thumb-img';
      img.src = src;
      img.alt = (currentSelected && currentSelected.name ? currentSelected.name : 'Product') + ' view ' + (index + 1);
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        btn.classList.add('is-missing');
        btn.setAttribute('aria-hidden', 'true');
      });

      btn.appendChild(img);
      btn.addEventListener('click', () => {
        currentEditImageIndex = index;
        renderEditProductViews();
        btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      });

      editProductViewsStrip.appendChild(btn);
    });

    if (editProductViewsStatus) {
      editProductViewsStatus.textContent = 'Viewing image ' + (currentEditImageIndex + 1) + ' of ' + total;
    }
  }

  function stepEditGallery(direction) {
    const total = currentEditImages.length;
    if (total < 2) return;
    currentEditImageIndex = (currentEditImageIndex + direction + total) % total;
    renderEditProductViews();
    const activeThumb = editProductViewsStrip && editProductViewsStrip.querySelector('.edit-view-thumb.is-active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  /**
   * Populate right side edit panel
   */
  function selectItem(item) {
    if (!item) {
      clearEditPanel();
      return;
    }

    currentSelected = item;
    currentSelectedSizes = Array.isArray(item.sizes) && item.sizes.length > 0 ? [...item.sizes] : ['4mm', '3mm', '2mm'];
    currentActiveSize = item.activeSize || currentSelectedSizes[0] || '4mm';

    // Update active highlight on cards
    document.querySelectorAll('.catalogue-card').forEach((el) => {
      if (el.getAttribute('data-id') === String(item.id)) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });

    // Populate fields
    editItemId.value = item.id;
    editSelectedLabel.textContent = `Selected \u2022 ${item.name}`;
    editSelectedLabel.title = item.name;

    if (item.isPublished) {
      editHeaderBadge.className = 'badge-status badge-published';
      editHeaderBadge.textContent = 'Published';
      visibilitySubtitle.textContent = 'Published on the studio website';
      editVisibilityToggle.checked = true;
    } else {
      editHeaderBadge.className = 'badge-status badge-draft';
      editHeaderBadge.textContent = 'Draft';
      visibilitySubtitle.textContent = 'Hidden from the studio website';
      editVisibilityToggle.checked = false;
    }

    currentEditImages = getProductViewImages(item);
    const primary = item.imageUrl || item.thumbnailUrl || (item.images && item.images[0]) || '';
    const primaryIdx = primary ? currentEditImages.indexOf(String(primary).trim()) : -1;
    currentEditImageIndex = primaryIdx >= 0 ? primaryIdx : 0;
    editImagePreview.alt = item.name || 'Preview';
    renderEditProductViews();
    if (!currentEditImages.length) {
      editImagePreview.src = item.imageUrl || '../../assets/images/piercing1.png';
    }

    editNameInput.value = item.name || '';
    renderEditSizes();

    if (item.socialMedia) {
      editSocialMediaSelect.value = item.socialMedia;
    } else {
      editSocialMediaSelect.value = 'Instagram';
    }

    clearFeedback();
  }

  /**
   * On phones the edit panel is a bottom sheet. These helpers keep the
   * desktop inline panel untouched.
   */
  function openEditSheet(trigger) {
    if (!window.AdminSheet) return;
    window.AdminSheet.open('editSidePanel', {
      trigger: trigger || document.querySelector('.catalogue-card.selected')
    });
  }

  function closeEditSheet() {
    if (!window.AdminSheet) return;
    window.AdminSheet.close('editSidePanel', { restoreFocus: false });
  }

  /**
   * Reset / clear edit panel
   */
  function clearEditPanel() {
    currentSelected = null;
    currentSelectedSizes = ['4mm', '3mm', '2mm'];
    currentActiveSize = '4mm';
    currentEditImages = [];
    currentEditImageIndex = 0;
    editItemId.value = '';
    editSelectedLabel.textContent = 'No item selected';
    editHeaderBadge.className = 'badge-status badge-draft';
    editHeaderBadge.textContent = 'Unpublished';
    editImagePreview.src = '../../assets/images/piercing1.png';
    editNameInput.value = '';
    renderEditSizes();
    renderEditProductViews();
    editVisibilityToggle.checked = false;
  }

  /**
   * Save changes from edit side panel
   */
  async function saveChanges() {
    const id = editItemId.value;
    if (!id) return;

    const name = editNameInput.value.trim();
    if (!name) {
      showFeedback('Please provide a name for this item.', 'error');
      editNameInput.focus();
      return;
    }

    const socialMedia = editSocialMediaSelect.value;
    const isPublished = editVisibilityToggle.checked;
    const sizes = currentSelectedSizes;
    const activeSize = currentActiveSize;

    saveChangesBtn.disabled = true;
    saveChangesBtn.textContent = 'SAVING...';

    try {
      const res = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          title: name,
          sizes,
          activeSize,
          socialMedia,
          isPublished
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success && data.item) {
        showFeedback('Item changes saved successfully.', 'success');
        // Update local item
        const idx = catalogueData.findIndex((i) => String(i.id) === String(id));
        if (idx !== -1) {
          catalogueData[idx] = data.item;
          renderGrid(catalogueData);
          selectItem(data.item);
        }
      } else {
        showFeedback(data.error || 'Failed to save changes.', 'error');
      }
    } catch (err) {
      console.error('[admin-catalogue] Save error:', err);
      showFeedback('Network error while saving. Please retry.', 'error');
    } finally {
      saveChangesBtn.disabled = false;
      saveChangesBtn.textContent = 'SAVE CHANGES';
    }
  }

  /**
   * Discard edits and reset fields
   */
  function discardChanges() {
    if (currentSelected) {
      selectItem(currentSelected);
      showFeedback('Changes reverted.', 'success');
    } else {
      clearEditPanel();
    }
  }

  /**
   * Upload new replacement image for currently selected item
   */
  async function changeSelectedImage(file) {
    const id = editItemId.value;
    if (!id || !file) return;

    const formData = new FormData();
    formData.append('file', file);

    changeImageBtn.disabled = true;
    changeImageBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Replacing...';

    try {
      const res = await fetch(`${API_BASE}/${id}/change-image`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success && data.item) {
        showFeedback('Image successfully updated.', 'success');
        editImagePreview.src = data.item.imageUrl;

        const idx = catalogueData.findIndex((i) => String(i.id) === String(id));
        if (idx !== -1) {
          catalogueData[idx] = data.item;
          renderGrid(catalogueData);
          selectItem(data.item);
        }
      } else {
        showFeedback(data.error || 'Failed to change image.', 'error');
      }
    } catch (err) {
      console.error('[admin-catalogue] Change image error:', err);
      showFeedback('Failed to upload image. Please try again.', 'error');
    } finally {
      changeImageBtn.disabled = false;
      changeImageBtn.innerHTML = '<i class="ph ph-image" aria-hidden="true"></i> Change Image';
      changeImageInput.value = '';
    }
  }

  /**
   * Handle bottom file upload dropzone
   */
  async function uploadFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    uploadProgressCard.style.display = 'flex';
    uploadProgressBar.style.width = '10%';
    uploadStatusText.textContent = `Uploading ${fileList.length} new catalogue item(s)...`;

    let successCount = 0;
    const total = fileList.length;

    for (let i = 0; i < total; i++) {
      const file = fileList[i];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
      formData.append('category', activeFilter.category !== 'all' ? activeFilter.category : 'Ear');
      formData.append('isPublished', 'true');

      try {
        const res = await fetch(`${API_BASE}/upload`, {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          successCount++;
        }
      } catch (err) {
        console.warn('[admin-catalogue] Upload error for file:', file.name, err);
      }

      const percent = Math.round(((i + 1) / total) * 100);
      uploadProgressBar.style.width = `${percent}%`;
    }

    uploadStatusText.textContent = `Uploaded ${successCount} of ${total} item(s).`;

    setTimeout(() => {
      uploadProgressCard.style.display = 'none';
      uploadProgressBar.style.width = '0%';
      fetchCatalogue();
    }, 1200);
  }

  /**
   * Delete modal controls
   */
  function openDeleteModal(item) {
    deleteCandidateId = item.id;
    deleteTargetTitle.textContent = `"${item.name}"`;
    closeEditSheet();
    deleteModal.style.display = 'grid';
  }

  function closeDeleteModal() {
    deleteCandidateId = null;
    deleteModal.style.display = 'none';
  }

  async function confirmDelete() {
    if (!deleteCandidateId) return;

    confirmDeleteBtn.disabled = true;
    confirmDeleteBtn.textContent = 'Deleting...';

    try {
      const res = await fetch(`${API_BASE}/${deleteCandidateId}`, {
        method: 'DELETE'
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success) {
        closeDeleteModal();
        await fetchCatalogue();
      } else {
        alert(data.error || 'Failed to delete item.');
      }
    } catch (err) {
      console.error('[admin-catalogue] Delete failed:', err);
      alert('Delete failed. Please check connection.');
    } finally {
      confirmDeleteBtn.disabled = false;
      confirmDeleteBtn.textContent = 'Delete Item';
    }
  }

  /**
   * Real-Time Server Sent Events
   */
  function initRealtime() {
    try {
      const evtSource = new EventSource(SSE_ENDPOINT);

      evtSource.addEventListener('catalogue_change', (e) => {
        try {
          const payload = JSON.parse(e.data);
          console.log('[SSE] Catalogue updated:', payload.action);
          fetchCatalogue();
        } catch (err) {
          console.warn('[SSE] Error handling catalogue change:', err);
        }
      });

      evtSource.onerror = () => {
        // EventSource automatically reconnects on error
      };
    } catch (err) {
      console.warn('[SSE] EventSource not available:', err);
    }
  }

  /**
   * Feedback alerts in edit side panel
   */
  function showFeedback(msg, type = 'success') {
    editFeedbackMsg.textContent = msg;
    editFeedbackMsg.className = `edit-feedback-msg ${type}`;
    editFeedbackMsg.style.display = 'block';

    setTimeout(() => {
      clearFeedback();
    }, 4500);
  }

  function clearFeedback() {
    editFeedbackMsg.textContent = '';
    editFeedbackMsg.style.display = 'none';
  }

  /**
   * Event Listeners Binding
   */
  function bindEvents() {
    // Search input
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        activeFilter.search = searchInput.value.trim();
        fetchCatalogue();
      }, 250);
    });

    // Category pills click
    categoryPillsContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.category-pill');
      if (!pill) return;

      categoryPillsContainer.querySelectorAll('.category-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');

      const cat = pill.getAttribute('data-category');
      activeFilter.category = cat;

      // Sync select dropdown
      if (cat === 'all') {
        categoryFilter.value = 'all';
      } else {
        for (const opt of categoryFilter.options) {
          if (opt.value.toLowerCase() === cat.toLowerCase()) {
            categoryFilter.value = opt.value;
            break;
          }
        }
      }

      fetchCatalogue();
    });

    // Category dropdown filter
    categoryFilter.addEventListener('change', () => {
      const val = categoryFilter.value;
      activeFilter.category = val.toLowerCase();

      // Sync pills
      categoryPillsContainer.querySelectorAll('.category-pill').forEach((p) => {
        const pCat = p.getAttribute('data-category');
        p.classList.toggle('active', pCat.toLowerCase() === val.toLowerCase());
      });

      fetchCatalogue();
    });

    // Visibility dropdown filter
    visibilityFilter.addEventListener('change', () => {
      activeFilter.visibility = visibilityFilter.value;
      fetchCatalogue();
    });

    // Sort order
    sortOrder.addEventListener('change', () => {
      activeFilter.sort = sortOrder.value;
      fetchCatalogue();
    });

    // Product view gallery navigation
    if (editGalleryPrev) {
      editGalleryPrev.addEventListener('click', (e) => {
        e.preventDefault();
        stepEditGallery(-1);
      });
    }
    if (editGalleryNext) {
      editGalleryNext.addEventListener('click', (e) => {
        e.preventDefault();
        stepEditGallery(1);
      });
    }

    // Change image button & input
    changeImageBtn.addEventListener('click', () => {
      changeImageInput.click();
    });

    changeImageInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        changeSelectedImage(e.target.files[0]);
      }
    });

    // Visibility switch change
    editVisibilityToggle.addEventListener('change', () => {
      if (editVisibilityToggle.checked) {
        editHeaderBadge.className = 'badge-status badge-published';
        editHeaderBadge.textContent = 'Published';
        visibilitySubtitle.textContent = 'Published on the studio website';
      } else {
        editHeaderBadge.className = 'badge-status badge-draft';
        editHeaderBadge.textContent = 'Draft';
        visibilitySubtitle.textContent = 'Hidden from the studio website';
      }
    });

    // Save and discard buttons
    saveChangesBtn.addEventListener('click', saveChanges);
    discardChangesBtn.addEventListener('click', discardChanges);

    // Upload choose files button
    chooseFilesBtn.addEventListener('click', () => {
      fileUploadInput.click();
    });

    fileUploadInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadFiles(e.target.files);
      }
    });

    // Drag and drop for uploadDropzone
    uploadDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadDropzone.classList.add('drag-active');
    });

    uploadDropzone.addEventListener('dragleave', () => {
      uploadDropzone.classList.remove('drag-active');
    });

    uploadDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadDropzone.classList.remove('drag-active');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files);
      }
    });

    // Delete modal events
    cancelDeleteBtn.addEventListener('click', closeDeleteModal);
    confirmDeleteBtn.addEventListener('click', confirmDelete);

    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) closeDeleteModal();
    });
  }

  // Start on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
