/**
 * Home page reviews controller.
 *
 * Fetches real published reviews from Supabase, keeps only the five strongest
 * by a weighted score of star rating and written sentiment, and powers the
 * "Share your experience" modal.
 */

import {
  deleteReview,
  fetchReviews,
  formatReviewDate,
  getCurrentReviewer,
  initialsAvatar,
  isOwnReview,
  pickHomeReviews,
  starString
} from './services/reviewService.js';
import { renderReviewCard } from './review-card.js';
import { setupReviewForm } from './review-form.js';
import { createReviewSlideshow } from './review-carousel.js';
import { confirmNotice } from './notice.js';

const HOME_REVIEW_LIMIT = 5;

const byId = (id) => document.getElementById(id);

let carousel = null;
// Only set when a client is signed in; used to show the delete control on the
// reviews that account wrote.
let currentUserId = null;

function setSectionStatus(message, tone = '') {
  const status = byId('homeReviewsStatus');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.tone = tone;
}

function emptyStateMarkup(message) {
  return `
    <div class="review-empty">
      <i class="ph ph-chat-circle-dots" aria-hidden="true"></i>
      <p>${message}</p>
      <a class="reviews-inline-link" href="reviews.html">Visit the reviews page &rarr;</a>
    </div>
  `;
}

function openModalBox(box) {
  if (!box) return;
  if (window.paulinaModal?.open) {
    window.paulinaModal.open(box);
    return;
  }

  const overlay = byId('modalOverlay');
  document.querySelectorAll('.modal-box').forEach((item) => {
    item.classList.remove('active');
    item.style.display = 'none';
  });
  box.style.display = 'block';
  box.classList.add('active');
  overlay?.classList.add('active');
}

function openReviewDetail(review) {
  if (!review) return;

  const modal = byId('testimonialModal');
  if (!modal) return;

  const avatar = byId('testiModalAvatar');
  const name = byId('testiModalName');
  const stars = byId('testiModalStars');
  const date = byId('testiModalDate');
  const text = byId('testiModalText');
  const photo = byId('testiModalAttachedPhoto');

  if (avatar) {
    avatar.src = review.avatarUrl || initialsAvatar(review.name);
    avatar.alt = review.name;
  }
  if (name) name.textContent = review.name;
  if (stars) stars.textContent = starString(review.rating);
  if (date) date.textContent = formatReviewDate(review.createdAt);
  if (text) text.textContent = `"${review.body}"`;

  if (photo) {
    if (review.photoUrl) {
      photo.src = review.photoUrl;
      photo.style.display = 'block';
    } else {
      photo.removeAttribute('src');
      photo.style.display = 'none';
    }
  }

  openModalBox(modal);
}

function renderHomeReviews(reviews) {
  const grid = byId('homeReviewsGrid');
  if (!grid) return;

  if (!reviews.length) {
    const message = 'No reviews have been published yet. Be the first to share your studio experience.';
    grid.innerHTML = emptyStateMarkup(message);
    grid.dataset.count = '0';
    carousel?.refresh();
    return;
  }

  const topReviews = pickHomeReviews(reviews, HOME_REVIEW_LIMIT);
  grid.innerHTML = topReviews
    .map((review) =>
      renderReviewCard(review, {
        compact: true,
        canDelete: isOwnReview(review, currentUserId)
      })
    )
    .join('');
  grid.dataset.count = String(topReviews.length);

  // Re-measure so the slideshow picks up a newly posted review instead of
  // keeping the old slide widths and page count.
  carousel?.refresh();
}

export function initHomeReviews() {
  const grid = byId('homeReviewsGrid');
  const carouselRoot = byId('homeReviewsCarousel');
  const shareButton = byId('shareExperienceBtn');
  const shareModal = byId('shareExperienceModal');
  let currentReviews = [];

  if (carouselRoot && grid) {
    carousel = createReviewSlideshow({
      root: carouselRoot,
      viewport: carouselRoot.querySelector('[data-carousel-viewport]'),
      track: grid
    });
  }

  if (grid) {
    grid.addEventListener('click', (event) => {
      const deleteButton = event.target.closest('[data-delete-review]');
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        handleDelete(deleteButton);
        return;
      }

      const card = event.target.closest('[data-review-id]');
      if (!card) return;
      const review = currentReviews.find((item) => item.id === card.dataset.reviewId);
      openReviewDetail(review);
    });

    grid.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // The delete control is its own button; activating it must not also open
      // the review modal through the card handler.
      if (event.target.closest('[data-delete-review]')) return;
      const card = event.target.closest('[data-review-id]');
      if (!card) return;
      event.preventDefault();
      const review = currentReviews.find((item) => item.id === card.dataset.reviewId);
      openReviewDetail(review);
    });
  }

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
      setSectionStatus('Your review has been deleted.', 'success');
      await loadReviews();
    } catch (error) {
      console.warn('[reviews] Could not delete review:', error);
      setSectionStatus(error?.message || 'Your review could not be deleted.', 'error');
      button.disabled = false;
    }
  }

  const composer = setupReviewForm({
    root: shareModal,
    signInUrl: 'sign-in.html',
    onSuccess: () => {
      setSectionStatus('Thank you! Your review has been posted.', 'success');
      loadReviews();
      window.setTimeout(() => {
        if (window.paulinaModal?.close) window.paulinaModal.close();
      }, 900);
    }
  });

  shareButton?.addEventListener('click', (event) => {
    event.preventDefault();
    setSectionStatus('');
    composer.refreshIdentity();
    openModalBox(shareModal);
  });

  async function loadReviews() {
    if (!grid) return;

    try {
      // The signed-in account decides which cards show a delete control.
      const [reviews, reviewer] = await Promise.all([
        fetchReviews(),
        getCurrentReviewer().catch(() => null)
      ]);
      currentUserId = reviewer?.id || null;
      currentReviews = reviews;
      renderHomeReviews(currentReviews);
    } catch (error) {
      console.warn('[reviews] Could not load home reviews:', error);
      currentReviews = [];
      // The empty state already explains the problem; keep the status line for
      // transient submission feedback instead of repeating the same message.
      grid.innerHTML = emptyStateMarkup(
        error?.message || 'Reviews could not be loaded right now. Please check back soon.'
      );
      grid.dataset.count = '0';
      carousel?.refresh();
      setSectionStatus('');
    }
  }

  loadReviews();
}

document.addEventListener('DOMContentLoaded', () => {
  initHomeReviews();
});
