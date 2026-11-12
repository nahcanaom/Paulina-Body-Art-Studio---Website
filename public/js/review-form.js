/**
 * Review composer controller.
 *
 * The same controller powers the "Share your experience" modal on the home
 * page and the "Write a review" modal on reviews.html. All fields are queried
 * with data attributes, so the markup can be reused without duplicate IDs.
 */

import {
  getCurrentReviewer,
  initialsAvatar,
  MAX_REVIEW_LENGTH,
  MIN_REVIEW_LENGTH,
  submitReview
} from './services/reviewService.js';

function notifyStudioOfReview(review, reviewer) {
  const apiUrl = typeof window.paulinaApiUrl === 'function' ? window.paulinaApiUrl : (path) => path;

  fetch(apiUrl('/api/notifications/review'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewerName: review?.name || reviewer?.name || '',
      rating: review?.rating || 0,
      body: review?.body || ''
    })
  }).catch((error) => {
    console.warn('[reviews] The studio could not be notified about this review:', error);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not open the image.'));
    image.src = source;
  });
}

/**
 * Review photos are stored as a compact data URL so the form works without a
 * separate storage bucket. The browser shrinks the picture first, which keeps
 * both the upload and the rest of the reviews query fast.
 */
async function preparePhoto(file) {
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const maxDimension = 1200;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) return original;

  context.fillStyle = '#331418';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', 0.82);
}

export function setupReviewForm({ root, onSuccess, signInUrl = 'sign-in.html' } = {}) {
  if (!root) {
    return { refreshIdentity: async () => {}, reset: () => {} };
  }

  const authNotice = root.querySelector('[data-review-auth]');
  const form = root.querySelector('[data-review-form]');
  const avatarImage = root.querySelector('[data-reviewer-avatar]');
  const reviewerName = root.querySelector('[data-reviewer-name]');
  const signInLink = root.querySelector('[data-review-signin]');
  const starButtons = [...root.querySelectorAll('[data-review-star]')];
  const textarea = root.querySelector('[data-review-body]');
  const counter = root.querySelector('[data-review-count]');
  const status = root.querySelector('[data-review-status]');
  const submitButton = root.querySelector('[data-review-submit]');
  const photoBox = root.querySelector('[data-review-photo-box]');
  const photoInput = root.querySelector('[data-review-photo-input]');
  const photoText = root.querySelector('[data-review-photo-text]');

  let reviewer = null;
  let rating = 0;
  let attachedPhoto = '';
  let busy = false;
  let identityRequest = 0;

  if (signInLink && signInUrl) signInLink.href = signInUrl;

  const setStatus = (message, tone = '') => {
    if (!status) return;
    status.textContent = message || '';
    status.dataset.tone = tone;
  };

  const paintStars = (value) => {
    starButtons.forEach((button, index) => {
      const active = index < value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(index < rating));
    });
  };

  const clearStatus = () => setStatus('');

  const resetPhoto = () => {
    attachedPhoto = '';
    if (photoInput) photoInput.value = '';
    if (photoBox) {
      photoBox.style.backgroundImage = '';
      photoBox.classList.remove('has-photo');
    }
    if (photoText) photoText.textContent = 'Attach a photo (optional)';
  };

  const reset = ({ keepIdentity = true } = {}) => {
    rating = 0;
    paintStars(0);
    if (textarea) textarea.value = '';
    if (counter) counter.textContent = `0/${MAX_REVIEW_LENGTH}`;
    resetPhoto();
    clearStatus();

    if (!keepIdentity) {
      reviewer = null;
      if (form) form.hidden = true;
      if (authNotice) authNotice.hidden = false;
      if (reviewerName) reviewerName.textContent = 'Loading your account\u2026';
      if (avatarImage) avatarImage.src = initialsAvatar('Paulina Client');
    }
  };

  const renderIdentity = () => {
    const signedIn = Boolean(reviewer);

    if (form) form.hidden = !signedIn;
    if (authNotice) authNotice.hidden = signedIn;

    if (signedIn) {
      if (reviewerName) reviewerName.textContent = reviewer.name;
      if (avatarImage) {
        avatarImage.src = reviewer.avatarUrl || initialsAvatar(reviewer.name);
        avatarImage.alt = reviewer.name;
      }
    } else {
      if (reviewerName) reviewerName.textContent = 'Guest';
      if (avatarImage) {
        // Avoid an empty src, which makes the browser request the page itself.
        avatarImage.src = initialsAvatar('Paulina Client');
        avatarImage.alt = 'Guest';
      }
    }
  };

  async function refreshIdentity() {
    const request = ++identityRequest;

    try {
      const current = await getCurrentReviewer();
      if (request !== identityRequest) return reviewer;
      reviewer = current;
    } catch (error) {
      console.warn('[reviews] Could not resolve the signed-in reviewer:', error);
      if (request !== identityRequest) return reviewer;
      reviewer = null;
    }

    renderIdentity();
    return reviewer;
  }

  starButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      rating = index + 1;
      paintStars(rating);
      clearStatus();
    });

    button.addEventListener('mouseenter', () => paintStars(index + 1));
    button.addEventListener('focus', () => paintStars(index + 1));
  });

  const starsContainer = root.querySelector('[data-review-stars]');
  starsContainer?.addEventListener('mouseleave', () => paintStars(rating));
  starsContainer?.addEventListener('focusout', (event) => {
    if (!starsContainer.contains(event.relatedTarget)) paintStars(rating);
  });

  textarea?.addEventListener('input', () => {
    if (!counter) return;
    counter.textContent = `${textarea.value.length}/${MAX_REVIEW_LENGTH}`;
  });

  photoBox?.addEventListener('click', () => photoInput?.click());

  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setStatus('Please choose an image file.', 'error');
      photoInput.value = '';
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setStatus('Please choose an image smaller than 12 MB.', 'error');
      photoInput.value = '';
      return;
    }

    setStatus('Preparing your photo\u2026');
    try {
      attachedPhoto = await preparePhoto(file);
      if (photoBox) {
        photoBox.style.backgroundImage = `url(${attachedPhoto})`;
        photoBox.classList.add('has-photo');
      }
      if (photoText) photoText.textContent = 'Photo attached \u2014 click to change';
      clearStatus();
    } catch (error) {
      console.warn('[reviews] Could not prepare the attached photo:', error);
      setStatus('That photo could not be loaded. Please try another one.', 'error');
      resetPhoto();
    }
  });

  submitButton?.addEventListener('click', async () => {
    if (busy) return;

    if (!reviewer) {
      setStatus('Please sign in so your account name and photo can appear with your review.', 'error');
      return;
    }

    const body = textarea?.value.trim() || '';

    if (!rating) {
      setStatus('Choose a star rating before posting.', 'error');
      return;
    }

    if (body.length < MIN_REVIEW_LENGTH) {
      setStatus(
        `Please write at least ${MIN_REVIEW_LENGTH} characters so your review is helpful.`,
        'error'
      );
      return;
    }

    if (body.length > MAX_REVIEW_LENGTH) {
      setStatus(`Reviews can be up to ${MAX_REVIEW_LENGTH} characters.`, 'error');
      return;
    }

    busy = true;
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'POSTING\u2026';
    setStatus('Posting your review\u2026');

    try {
      const review = await submitReview({ rating, body, photoUrl: attachedPhoto });

      // Reviews are written straight to Supabase, so tell the studio server
      // about it; that server emails the studio inbox and records the dashboard
      // notification. A failed alert never blocks the posted review.
      notifyStudioOfReview(review, reviewer);

      reset();
      setStatus('Thank you! Your review is now live.', 'success');
      onSuccess?.(review);
    } catch (error) {
      console.error('[reviews] Could not post the review:', error);
      setStatus(error?.message || 'Your review could not be posted. Please try again.', 'error');
    } finally {
      busy = false;
      submitButton.disabled = false;
      submitButton.textContent = originalLabel || 'POST REVIEW';
    }
  });

  paintStars(0);
  refreshIdentity();

  return { refreshIdentity, reset };
}
