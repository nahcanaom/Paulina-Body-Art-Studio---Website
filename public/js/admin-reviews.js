/**
 * PAULINA Body Art Studio — Admin reviews controller
 * ===================================================
 *
 * Backs the "Reviews" tab of the Edit Website workspace with the Supabase
 * `reviews` table. Admins can read every review (published or hidden), edit a
 * rating or the written review, hide it from the public site, and delete it.
 *
 * A Supabase realtime subscription keeps the list current, so a testimonial a
 * client posts on the public site appears here without a page reload.
 *
 * Required schema: docs/migrations/create_reviews_table.sql and
 * docs/migrations/admin_reviews_policies.sql (admin read/write policies).
 */

import { supabase, isSupabaseConfigured } from './supabase-config.js';
import { escapeHtml } from './services/reviewService.js';
import { isStudioAdmin } from './services/authService.js';

const REVIEWS_TABLE = 'reviews';

const state = {
  reviews: [],
  search: '',
  visibility: 'all',
  loading: false,
  ready: false,
  channel: null
};

const byId = (id) => document.getElementById(id);

function setStatus(message, tone = '') {
  const status = byId('reviewsAdminStatus');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.tone = tone;
}

async function getAdminSession() {
  if (!isSupabaseConfigured()) return null;

  try {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    if (!user) return null;

    if (isStudioAdmin(user)) return user;
    return null;
  } catch (error) {
    console.warn('[admin-reviews] Could not read the admin session:', error?.message || error);
    return null;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function normalizeReview(row) {
  return {
    id: String(row?.id || ''),
    name: String(row?.reviewer_name || 'Paulina Client'),
    avatarUrl: String(row?.reviewer_photo_url || ''),
    rating: Math.min(5, Math.max(1, Math.round(Number(row?.rating) || 0))) || 1,
    body: String(row?.body || ''),
    photoUrl: String(row?.photo_url || ''),
    isPublished: row?.is_published !== false,
    createdAt: row?.created_at || ''
  };
}

function stars(rating) {
  return `${'\u2605'.repeat(rating)}${'\u2606'.repeat(5 - rating)}`;
}

function visibleReviews() {
  const term = state.search.trim().toLowerCase();

  return state.reviews.filter((review) => {
    if (state.visibility === 'published' && !review.isPublished) return false;
    if (state.visibility === 'hidden' && review.isPublished) return false;
    if (!term) return true;
    return `${review.name} ${review.body}`.toLowerCase().includes(term);
  });
}

function reviewCardHtml(review) {
  const avatar = review.avatarUrl
    ? `<img class="review-admin-avatar" src="${escapeHtml(review.avatarUrl)}" alt="${escapeHtml(review.name)}" loading="lazy">`
    : `<span class="review-admin-avatar review-admin-avatar--initials">${escapeHtml(
        review.name.slice(0, 2).toUpperCase()
      )}</span>`;

  return `
    <article class="review-admin-card" data-review-id="${escapeHtml(review.id)}">
      <header class="review-admin-card__head">
        ${avatar}
        <div class="review-admin-card__identity">
          <h3>${escapeHtml(review.name)}</h3>
          <span class="review-admin-card__meta">${escapeHtml(formatDate(review.createdAt))}</span>
        </div>
        <span class="badge-status ${review.isPublished ? 'badge-published' : 'badge-draft'}">
          ${review.isPublished ? 'Published' : 'Hidden'}
        </span>
      </header>
      <p class="review-admin-stars" aria-label="${review.rating} out of 5 stars">${stars(review.rating)}</p>
      <p class="review-admin-body">${escapeHtml(review.body)}</p>
      <div class="admin-edit-card__actions">
        <button type="button" class="btn-card-action" data-review-action="edit" data-id="${escapeHtml(review.id)}">
          <i class="ph ph-pencil-simple" aria-hidden="true"></i> Edit
        </button>
        <button type="button" class="btn-card-action" data-review-action="toggle" data-id="${escapeHtml(review.id)}">
          <i class="ph ph-eye${review.isPublished ? '-slash' : ''}" aria-hidden="true"></i>
          ${review.isPublished ? 'Hide' : 'Publish'}
        </button>
        <button type="button" class="btn-card-action btn-card-action--danger" data-review-action="delete" data-id="${escapeHtml(review.id)}">
          <i class="ph ph-trash" aria-hidden="true"></i> Delete
        </button>
      </div>
    </article>
  `;
}

function renderReviews() {
  const grid = byId('adminReviewsGrid');
  const empty = byId('reviewsEmpty');
  if (!grid || !empty) return;

  const reviews = visibleReviews();
  grid.innerHTML = reviews.map(reviewCardHtml).join('');
  empty.classList.toggle('hidden', reviews.length > 0);

  if (!reviews.length && !state.loading) {
    empty.querySelector('h3').textContent = state.reviews.length
      ? 'No reviews match these filters'
      : 'No reviews yet';
    empty.querySelector('p').textContent = state.reviews.length
      ? 'Try clearing the search or the visibility filter.'
      : 'Client reviews post here automatically once they are submitted on the public site.';
  }
}

async function loadReviews() {
  if (state.loading) return;
  const admin = await getAdminSession();

  if (!admin) {
    renderSignedOut();
    return;
  }

  state.loading = true;
  if (!state.reviews.length) setStatus('Loading reviews\u2026');

  try {
    const { data, error } = await supabase
      .from(REVIEWS_TABLE)
      .select('id,reviewer_name,reviewer_photo_url,rating,body,photo_url,is_published,created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    state.reviews = (data || []).map(normalizeReview);
    setStatus('');
  } catch (error) {
    console.warn('[admin-reviews] Could not load reviews:', error?.message || error);
    setStatus(
      'Reviews could not be loaded. Confirm the Supabase reviews policies from docs/migrations/admin_reviews_policies.sql.',
      'error'
    );
  } finally {
    state.loading = false;
    renderReviews();
  }
}

function renderSignedOut() {
  const grid = byId('adminReviewsGrid');
  const empty = byId('reviewsEmpty');
  if (grid) grid.innerHTML = '';
  if (empty) empty.classList.remove('hidden');
  setStatus('Sign in with the studio admin account to manage reviews.', 'error');

  const heading = empty?.querySelector('h3');
  const copy = empty?.querySelector('p');
  if (heading) heading.textContent = 'Admin sign-in required';
  if (copy) copy.textContent = 'Reviews are managed with the studio admin Supabase account.';
  state.ready = true;
}

/* -------------------------------------------------------------------------
   EDITOR
   ------------------------------------------------------------------------- */

function openEditor(review) {
  const modal = byId('reviewEditorModal');
  if (!modal || !review) return;

  byId('reviewEditorId').value = review.id;
  byId('reviewEditorReviewer').textContent = review.name;
  byId('reviewEditorRating').value = String(review.rating);
  byId('reviewEditorBody').value = review.body;
  byId('reviewEditorPublished').checked = review.isPublished;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  byId('reviewEditorBody')?.focus({ preventScroll: true });
}

function closeEditor() {
  const modal = byId('reviewEditorModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

async function saveReview(event) {
  event.preventDefault();

  const id = byId('reviewEditorId')?.value || '';
  const body = byId('reviewEditorBody')?.value.trim() || '';
  const rating = Number(byId('reviewEditorRating')?.value || 0);
  const isPublished = Boolean(byId('reviewEditorPublished')?.checked);
  const button = byId('reviewEditorSave');

  if (!id) return;
  if (body.length < 1) {
    setStatus('The review text cannot be empty.', 'error');
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Saving\u2026';
  }

  try {
    const { error } = await supabase
      .from(REVIEWS_TABLE)
      .update({ rating, body, is_published: isPublished, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    closeEditor();
    setStatus('Review updated.', 'success');
    await loadReviews();
  } catch (error) {
    console.warn('[admin-reviews] Could not update the review:', error?.message || error);
    setStatus(error?.message || 'The review could not be updated.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="ph ph-floppy-disk" aria-hidden="true"></i> Save review';
    }
  }
}

async function toggleReview(review) {
  try {
    const { error } = await supabase
      .from(REVIEWS_TABLE)
      .update({ is_published: !review.isPublished, updated_at: new Date().toISOString() })
      .eq('id', review.id);

    if (error) throw error;

    setStatus(review.isPublished ? 'Review hidden from the public site.' : 'Review published.', 'success');
    await loadReviews();
  } catch (error) {
    console.warn('[admin-reviews] Could not change visibility:', error?.message || error);
    setStatus(error?.message || 'The review visibility could not be changed.', 'error');
  }
}

async function deleteReview(review) {
  const confirmed = window.confirm(`Delete the review by ${review.name}? This cannot be undone.`);
  if (!confirmed) return;

  try {
    const { error } = await supabase.from(REVIEWS_TABLE).delete().eq('id', review.id);
    if (error) throw error;

    state.reviews = state.reviews.filter((item) => item.id !== review.id);
    renderReviews();
    setStatus('Review deleted.', 'success');
  } catch (error) {
    console.warn('[admin-reviews] Could not delete the review:', error?.message || error);
    setStatus(error?.message || 'The review could not be deleted.', 'error');
  }
}

/* -------------------------------------------------------------------------
   BINDING + REALTIME
   ------------------------------------------------------------------------- */

function bindGridOnce() {
  const grid = byId('adminReviewsGrid');
  if (!grid || grid.dataset.bound === 'true') return;
  grid.dataset.bound = 'true';

  grid.addEventListener('click', (event) => {
    const action = event.target.closest('[data-review-action]');
    if (!action) return;

    const review = state.reviews.find((item) => item.id === action.dataset.id);
    if (!review) return;

    if (action.dataset.reviewAction === 'edit') openEditor(review);
    if (action.dataset.reviewAction === 'toggle') toggleReview(review);
    if (action.dataset.reviewAction === 'delete') deleteReview(review);
  });
}

function bindControlsOnce() {
  if (state.ready) return;

  byId('reviewsSearch')?.addEventListener('input', (event) => {
    state.search = event.target.value || '';
    renderReviews();
  });

  byId('reviewsVisibilityFilter')?.addEventListener('change', (event) => {
    state.visibility = event.target.value || 'all';
    renderReviews();
  });

  byId('reviewsRefreshBtn')?.addEventListener('click', () => loadReviews());
  byId('reviewEditorForm')?.addEventListener('submit', saveReview);

  document.querySelectorAll('[data-review-modal-close]').forEach((button) => {
    button.addEventListener('click', closeEditor);
  });

  byId('reviewEditorModal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeEditor();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !byId('reviewEditorModal')?.classList.contains('hidden')) {
      closeEditor();
    }
  });

  state.ready = true;
}

function subscribeToReviews() {
  if (state.channel || !isSupabaseConfigured()) return;

  try {
    state.channel = supabase
      .channel('admin:reviews')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: REVIEWS_TABLE },
        () => loadReviews()
      )
      .subscribe();
  } catch (error) {
    console.warn('[admin-reviews] Realtime subscription unavailable:', error?.message || error);
  }
}

export function initAdminReviews() {
  if (!byId('adminReviewsGrid')) return;

  bindControlsOnce();
  bindGridOnce();
  subscribeToReviews();

  window.paulinaAdminReviews = { load: loadReviews };
}

document.addEventListener('DOMContentLoaded', initAdminReviews);
