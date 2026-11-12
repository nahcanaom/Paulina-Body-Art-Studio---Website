/**
 * Shared review card markup used by the home page and the dedicated reviews
 * page. Keeping it in one place means both pages render the same identity,
 * rating, date, and attached-photo treatment.
 */

import {
  escapeHtml,
  formatReviewDate,
  initialsAvatar,
  starString
} from './services/reviewService.js';

const truncate = (text, maxLength) => {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).replace(/\s+\S*$/, '')}\u2026`;
};

export function renderStarRating(rating, { className = 'review-stars' } = {}) {
  const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  const filled = '<span class="review-star is-filled" aria-hidden="true">\u2605</span>'.repeat(value);
  const empty = '<span class="review-star" aria-hidden="true">\u2605</span>'.repeat(5 - value);

  return `<span class="${escapeHtml(className)}" aria-label="${value} out of 5 stars">${filled}${empty}</span>`;
}

export function reviewAvatarMarkup(review, { className = 'review-avatar' } = {}) {
  const source = review?.avatarUrl || initialsAvatar(review?.name);
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(source)}" alt="${escapeHtml(
    review?.name || 'Reviewer'
  )}" loading="lazy">`;
}

export function renderReviewCard(review, { compact = false, canDelete = false } = {}) {
  const name = review?.name || 'Paulina Client';
  const body = compact ? truncate(review?.body, 210) : review?.body || '';
  const date = formatReviewDate(review?.createdAt);
  // Full cards let the attached photo open in the shared lightbox. Compact
  // cards live inside the home carousel, where a click reads the whole review.
  const photo = review?.photoUrl
    ? `<div class="review-attached-photo${compact ? '' : ' media-view-target'}"${
        compact ? '' : ' data-view-photo'
      }>
         <img src="${escapeHtml(review.photoUrl)}" alt="Photo attached to ${escapeHtml(
           name
         )}'s review" loading="lazy">
       </div>`
    : '';

  return `
    <article class="review-card${compact ? ' review-card--compact' : ''}"
             data-review-id="${escapeHtml(review?.id || '')}"
             ${compact ? 'tabindex="0" role="button"' : ''}
             aria-label="${compact ? `Read the full review by ${escapeHtml(name)}` : `Review by ${escapeHtml(name)}`}">
      ${photo}
      ${renderStarRating(review?.rating)}
      <p class="review-body">&ldquo;${escapeHtml(body)}&rdquo;</p>
      ${compact ? '<span class="review-read-more">Click to read full review &rarr;</span>' : ''}
      <div class="review-footer">
        ${reviewAvatarMarkup(review)}
        <div class="review-identity">
          <h4 class="review-name">${escapeHtml(name)}</h4>
          ${date ? `<span class="review-date">${escapeHtml(date)}</span>` : ''}
        </div>
        <span class="review-verified" title="Posted from a signed-in client account">
          <i class="ph ph-seal-check" aria-hidden="true"></i>
          <span>Verified</span>
        </span>
      </div>
      ${
        canDelete && review?.id
          ? `<button type="button" class="review-delete" data-delete-review="${escapeHtml(
              review.id
            )}" aria-label="Delete your review">
               <i class="ph ph-trash" aria-hidden="true"></i>
               <span>Delete</span>
             </button>`
          : ''
      }
    </article>
  `;
}

export { truncate, starString };
