/**
 * Dedicated reviews page controller.
 *
 * Loads every published review from Supabase, lets visitors filter by star
 * rating, sort the list, and submit a review from the signed-in account.
 */

import {
  deleteReview,
  fetchReviews,
  getCurrentReviewer,
  isOwnReview,
  subscribeToReviewChanges
} from './services/reviewService.js';
import { renderReviewCard } from './review-card.js';
import { setupReviewForm } from './review-form.js';
import { confirmNotice } from './notice.js';

const byId = (id) => document.getElementById(id);

const state = {
  reviews: [],
  filter: 'all',
  sort: 'newest',
  loading: true,
  // Signed-in account id, or null for visitors; drives the delete control.
  currentUserId: null
};

function newestFirst(reviews) {
  return [...reviews].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

function visibleReviews() {
  let result = [...state.reviews];

  if (state.filter !== 'all') {
    result = result.filter((review) => review.rating === Number(state.filter));
  }

  if (state.sort === 'highest') {
    return [...result].sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.sentiment !== a.sentiment) return b.sentiment - a.sentiment;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }

  if (state.sort === 'positive') {
    return [...result].sort((a, b) => {
      if (b.sentiment !== a.sentiment) return b.sentiment - a.sentiment;
      if (b.rating !== a.rating) return b.rating - a.rating;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }

  return newestFirst(result);
}

function setPageStatus(message, tone = '') {
  const status = byId('reviewsPageStatus');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.tone = tone;
}

function updateFilterButtons() {
  document.querySelectorAll('[data-rating]').forEach((button) => {
    const active = button.dataset.rating === state.filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderReviews() {
  const list = byId('reviewsList');
  const resultCount = byId('reviewsResultCount');
  if (!list) return;

  if (state.loading) {
    list.innerHTML = `
      <div class="review-empty">
        <i class="ph ph-spinner-gap review-spinner" aria-hidden="true"></i>
        <p>Loading client reviews\u2026</p>
      </div>
    `;
    return;
  }

  const reviews = visibleReviews();

  if (!reviews.length) {
    const filtered = state.filter !== 'all';
    list.innerHTML = `
      <div class="review-empty">
        <i class="ph ph-chat-circle-dots" aria-hidden="true"></i>
        <p>${
          filtered
            ? `No ${state.filter}-star reviews have been published yet.`
            : 'No reviews have been published yet. Be the first to share your experience.'
        }</p>
      </div>
    `;
  } else {
    list.innerHTML = reviews
      .map((review) =>
        renderReviewCard(review, {
          canDelete: isOwnReview(review, state.currentUserId)
        })
      )
      .join('');
  }

  if (resultCount) {
    const suffix = reviews.length === 1 ? 'review' : 'reviews';
    const filteredLabel = state.filter === 'all' ? '' : ` in ${state.filter}-star`;
    resultCount.textContent = `Showing ${reviews.length} ${suffix}${filteredLabel}.`;
  }
}

function setFilter(value) {
  state.filter = value;
  updateFilterButtons();
  renderReviews();
}

async function loadReviews() {
  state.loading = true;
  renderReviews();

  try {
    const [reviews, reviewer] = await Promise.all([
      fetchReviews(),
      getCurrentReviewer().catch(() => null)
    ]);
    state.currentUserId = reviewer?.id || null;
    state.reviews = reviews;
    setPageStatus('');
  } catch (error) {
    console.warn('[reviews] Could not load the reviews page:', error);
    state.reviews = [];
    setPageStatus(
      error?.message || 'Reviews could not be loaded right now. Please check back soon.',
      'error'
    );
  } finally {
    state.loading = false;
    renderReviews();
  }
}

/**
 * Background refresh used after an instant render and by the realtime
 * subscription. It never shows the loading state, so a posted card stays on
 * screen while the feed reconciles with the database.
 */
async function refreshReviewsQuietly() {
  try {
    const [reviews, reviewer] = await Promise.all([
      fetchReviews(),
      getCurrentReviewer().catch(() => null)
    ]);
    state.currentUserId = reviewer?.id || null;
    state.reviews = reviews;
    state.loading = false;
    renderReviews();
  } catch (error) {
    console.warn('[reviews] Background refresh failed:', error?.message || error);
  }
}

export function initReviewsPage() {
  const ratingFilter = byId('ratingFilter');
  const sortSelect = byId('reviewSort');
  const list = byId('reviewsList');
  const overlay = byId('reviewComposerOverlay');
  const modal = byId('reviewComposerModal');
  const openButton = byId('openReviewComposer');

  ratingFilter?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rating]');
    if (!button) return;
    setFilter(button.dataset.rating || 'all');
  });

  sortSelect?.addEventListener('change', () => {
    state.sort = sortSelect.value || 'newest';
    renderReviews();
  });

  const composer = setupReviewForm({
    root: modal,
    signInUrl: 'sign-in.html',
    onSuccess: (review) => {
      closeComposer();
      setPageStatus('Thank you! Your review has been published.', 'success');

      // Render the testimonial card immediately from the inserted row, then
      // reconcile with Supabase in the background. No reload is required.
      if (review?.id) {
        state.reviews = [review, ...state.reviews.filter((item) => item.id !== review.id)];
        state.loading = false;
        state.filter = 'all';
        updateFilterButtons();
        renderReviews();
        const card = byId('reviewsList')?.querySelector(`[data-review-id="${review.id}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      refreshReviewsQuietly();
    }
  });

  function openComposer() {
    if (!overlay) return;
    setPageStatus('');
    composer.refreshIdentity();
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('review-modal-open');
    modal?.querySelector('[data-review-star]')?.focus({ preventScroll: true });
  }

  function closeComposer() {
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('review-modal-open');
    openButton?.focus({ preventScroll: true });
  }

  openButton?.addEventListener('click', openComposer);

  overlay?.querySelectorAll('[data-review-close]').forEach((button) => {
    button.addEventListener('click', closeComposer);
  });

  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) closeComposer();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay?.classList.contains('active')) {
      closeComposer();
    }
  });

  async function handleDelete(button) {
    const reviewId = button?.dataset.deleteReview;
    if (!reviewId) return;

    const confirmed = await confirmNotice({
      title: 'Delete this review?',
      message: 'This cannot be undone. Your review, rating and attached photo will be removed from the studio page.',
      confirmLabel: 'Delete review',
      cancelLabel: 'Keep review',
      tone: 'danger'
    });
    if (!confirmed) return;

    button.disabled = true;
    try {
      await deleteReview(reviewId);
      setPageStatus('Your review has been deleted.', 'success');
      await loadReviews();
    } catch (error) {
      console.warn('[reviews] Could not delete review:', error);
      setPageStatus(error?.message || 'Your review could not be deleted.', 'error');
      button.disabled = false;
    }
  }

  list?.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete-review]');
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      handleDelete(deleteButton);
      return;
    }

    if (event.target.closest('[data-open-review-form]')) openComposer();
  });

  updateFilterButtons();
  loadReviews();

  // Admin edits, deletions and new testimonials reach this page live.
  subscribeToReviewChanges(() => refreshReviewsQuietly());
}

document.addEventListener('DOMContentLoaded', () => {
  initReviewsPage();
});
