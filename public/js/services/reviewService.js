/**
 * ============================================================================
 * REVIEW SERVICE — SUPABASE-BACKED TESTIMONIALS
 * ============================================================================
 *
 * Public reviews are stored in `public.reviews` and linked to the signed-in
 * Supabase account through `user_id`. Reviewer names and avatars are read from
 * `public.public_profiles` the way account settings writes them, so changing a
 * display name or profile picture updates every review the client has posted.
 *
 * Run `docs/migrations/create_reviews_table.sql` once to create the table,
 * its RLS policies, and the identity-sync trigger.
 */

import { supabase, isSupabaseConfigured } from '../supabase-config.js';

const REVIEWS_TABLE = 'reviews';
const PUBLIC_PROFILES_TABLE = 'public_profiles';
const PRIVATE_PROFILES_TABLE = 'profiles';

export const MIN_REVIEW_LENGTH = 10;
export const MAX_REVIEW_LENGTH = 2000;
export const MAX_REVIEW_PHOTO_BYTES = 4 * 1024 * 1024;

// A showcase of reviews is only shown once this many published reviews exist,
// so a brand-new studio never displays a thin (or single) testimonial list.
export const MIN_PUBLISHED_REVIEWS = 5;

export class ReviewServiceError extends Error {
  constructor(message, code = 'review_error', cause = null) {
    super(message);
    this.name = 'ReviewServiceError';
    this.code = code;
    this.cause = cause;
  }
}

export const escapeHtml = (value) =>
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

const cleanText = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const cleanMultiline = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const clampRating = (value) => {
  const rating = Math.round(Number(value));
  if (!Number.isFinite(rating)) return 0;
  return Math.min(5, Math.max(0, rating));
};

export const initialsFor = (name) =>
  cleanText(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'PA';

export function initialsAvatar(name) {
  const initials = initialsFor(name);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
    '<rect width="96" height="96" fill="#5a1424"/>' +
    `<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#f6d0d6" ` +
    `font-family="Georgia,serif" font-size="34">${escapeHtml(initials)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const starString = (rating) => {
  const value = clampRating(rating);
  return `${'\u2605'.repeat(value)}${'\u2606'.repeat(5 - value)}`;
};

export function formatReviewDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

const nameFromEmail = (email) => {
  const local = String(email || '').split('@')[0] || '';
  const words = local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  return words.join(' ');
};

const normalizePhotoUrl = (value) => {
  const url = String(value || '').trim();
  return url.length <= 2_000_000 ? url : '';
};

const pickDisplayName = (...candidates) => {
  for (const candidate of candidates) {
    const name = cleanText(candidate);
    if (name && !/^(anonymous( client)?|unknown|user|client)$/i.test(name)) return name;
  }
  return '';
};

function isMissingTableError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('could not find the table') ||
    message.includes('relation "public.reviews" does not exist')
  );
}

/* -------------------------------------------------------------------------
   SENTIMENT RANKING
   ------------------------------------------------------------------------- */

const POSITIVE_WORDS = new Set([
  'amazing', 'awesome', 'beautiful', 'best', 'brilliant', 'calm', 'clean',
  'comfortable', 'caring', 'delighted', 'excellent', 'exceptional', 'fantastic',
  'favorite', 'favourite', 'flawless', 'friendly', 'gentle', 'glad', 'gorgeous',
  'great', 'happy', 'helpful', 'honest', 'incredible', 'kind', 'love', 'loved',
  'lovely', 'magical', 'masterful', 'perfect', 'phenomenal', 'pleasant',
  'professional', 'recommend', 'relaxing', 'safe', 'satisfied', 'smooth',
  'spectacular', 'stunning', 'superb', 'talented', 'terrific', 'thankful',
  'thoughtful', 'wonderful', 'worth', 'wow', 'welcoming', 'hygienic',
  'painless', 'seamless', 'spotless', 'impeccable', 'fabulous', 'incredible'
]);

const NEGATIVE_WORDS = new Set([
  'angry', 'annoying', 'awful', 'bad', 'boring', 'careless', 'cheap', 'cold',
  'complaint', 'dirty', 'disappointed', 'disappointing', 'disgusting', 'dreadful',
  'frustrating', 'horrible', 'hurt', 'ignored', 'inconvenient', 'infection',
  'messy', 'misleading', 'negative', 'overpriced', 'painful', 'poor', 'rude',
  'rushed', 'scam', 'slow', 'terrible', 'uncomfortable', 'unfriendly',
  'unhappy', 'unhelpful', 'unhygienic', 'unpleasant', 'unprofessional',
  'unsafe', 'waste', 'worst', 'wrong', 'broken', 'canceled', 'cancelled'
]);

const NEGATIONS = new Set([
  'not', 'no', 'never', 'hardly', 'barely', 'cannot', "can't", "don't",
  "didn't", "wasn't", "isn't", "aren't", "wouldn't", "couldn't", "won't",
  "shouldn't"
]);

const INTENSIFIERS = new Set([
  'very', 'really', 'so', 'extremely', 'absolutely', 'super', 'incredibly',
  'truly', 'totally', 'completely', 'especially'
]);

const POSITIVE_PHRASES = [
  'highly recommend', 'would recommend', 'will come back', 'coming back',
  'worth every penny', 'worth it', 'loved every', 'exceeded my expectations',
  'made me feel', 'at ease', 'peace of mind', 'five stars', '10/10'
];

const NEGATIVE_PHRASES = [
  'would not recommend', 'never coming back', 'never again', 'not worth',
  'waste of money', 'waste of time', 'would not go back', 'do not recommend',
  'zero stars', 'one star'
];

/**
 * Lightweight lexicon sentiment score. It is deliberately local and
 * deterministic so the "most positive" homepage selection never depends on a
 * third-party AI call or a review having a specific tag.
 */
export function sentimentScore(text) {
  const value = cleanMultiline(text)
    .toLowerCase()
    .replace(/\u2019/g, "'");

  if (!value) return 0;

  let score = 0;

  POSITIVE_PHRASES.forEach((phrase) => {
    if (value.includes(phrase)) score += 2;
  });
  NEGATIVE_PHRASES.forEach((phrase) => {
    if (value.includes(phrase)) score -= 2;
  });

  const tokens = value.match(/[a-z']+/g) || [];
  tokens.forEach((token, index) => {
    let weight = POSITIVE_WORDS.has(token) ? 1 : NEGATIVE_WORDS.has(token) ? -1 : 0;
    if (!weight) return;

    if (INTENSIFIERS.has(tokens[index - 1])) weight *= 1.5;
    if (NEGATIONS.has(tokens[index - 1]) || NEGATIONS.has(tokens[index - 2])) {
      weight *= -1;
    }

    score += weight;
  });

  const emojiMatches = value.match(/[\u2764\u2728\u{1F31F}\u{1F525}\u{1F4AF}\u{1F60D}\u{1F970}\u{1F44F}]/gu);
  if (emojiMatches) score += emojiMatches.length * 0.5;

  return Math.round(score * 100) / 100;
}

const reviewSentiment = (review) =>
  Number.isFinite(review?.sentiment) ? review.sentiment : sentimentScore(review?.body);

/* -------------------------------------------------------------------------
   WEIGHTED QUALITY SCORE
   ------------------------------------------------------------------------- */

// Stars carry the most weight, because a review's rating is an explicit verdict,
// but a warmly worded write-up can lift a strong four-star review above a terse
// five-star one. Sentiment swings the score, it does not decide it alone.
export const RATING_WEIGHT = 0.65;
export const SENTIMENT_WEIGHT = 0.35;

// Lexicon sentiment is unbounded, so it is squashed into -1..1 before use; a
// long review then saturates instead of running away with the ranking.
const SENTIMENT_SCALE = 3;

/**
 * Blended quality score in the 0..1 range.
 *
 * `rating` contributes a flat 0..1 (five stars = 1), while the written
 * sentiment is normalised around a neutral 0.5 and contributes the rest. The
 * two parts are weighted so that stars dominate and sentiment refines.
 */
export function reviewQualityScore(review) {
  const ratingPart = clampRating(review?.rating) / 5;
  const sentimentPart = (Math.tanh(reviewSentiment(review) / SENTIMENT_SCALE) + 1) / 2;
  return RATING_WEIGHT * ratingPart + SENTIMENT_WEIGHT * sentimentPart;
}

/**
 * Sorts reviews by the weighted score above. Ties fall back to the raw star
 * count, then the raw sentiment, then newest, so the order is stable whatever
 * the data set looks like. The homepage uses this to surface the strongest
 * five reviews even when dozens have been submitted.
 */
export function sortReviewsByQuality(reviews) {
  return [...(Array.isArray(reviews) ? reviews : [])].sort((a, b) => {
    const scoreDiff = reviewQualityScore(b) - reviewQualityScore(a);
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

    const ratingDiff = clampRating(b.rating) - clampRating(a.rating);
    if (ratingDiff !== 0) return ratingDiff;

    const sentimentDiff = reviewSentiment(b) - reviewSentiment(a);
    if (sentimentDiff !== 0) return sentimentDiff;

    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
}

export function pickHomeReviews(reviews, limit = 5) {
  return sortReviewsByQuality(reviews).slice(0, Math.max(0, limit));
}

/* -------------------------------------------------------------------------
   READ PATH
   ------------------------------------------------------------------------- */

function normalizeReview(row, profile = null) {
  const name =
    pickDisplayName(profile?.display_name, row?.reviewer_name) ||
    pickDisplayName(row?.user_metadata?.full_name, row?.user_metadata?.name) ||
    'Paulina Client';

  return {
    id: String(row?.id || ''),
    userId: String(row?.user_id || ''),
    name,
    avatarUrl:
      normalizePhotoUrl(profile?.photo_url) ||
      normalizePhotoUrl(row?.reviewer_photo_url) ||
      '',
    rating: clampRating(row?.rating),
    body: cleanMultiline(row?.body),
    photoUrl: normalizePhotoUrl(row?.photo_url),
    isPublished: row?.is_published !== false,
    createdAt: row?.created_at || '',
    updatedAt: row?.updated_at || '',
    sentiment: sentimentScore(row?.body)
  };
}

async function hydrateWithPublicProfiles(rows) {
  const reviews = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(reviews.map((row) => row?.user_id).filter(Boolean))];

  if (!userIds.length) {
    return reviews.map((row) => normalizeReview(row));
  }

  let profiles = [];
  try {
    const { data, error } = await supabase
      .from(PUBLIC_PROFILES_TABLE)
      .select('id,display_name,photo_url')
      .in('id', userIds);
    if (!error) profiles = Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('[reviews] Could not load public profiles:', error?.message || error);
  }

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return reviews.map((row) => normalizeReview(row, byId.get(row.user_id)));
}

export async function fetchReviews() {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from(REVIEWS_TABLE)
    .select(
      'id,user_id,reviewer_name,reviewer_photo_url,rating,body,photo_url,is_published,created_at,updated_at'
    )
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      throw new ReviewServiceError(
        'Customer reviews are being set up. Please check back soon.',
        'reviews_unavailable',
        error
      );
    }
    throw new ReviewServiceError(
      'We could not load reviews right now. Please try again in a moment.',
      'reviews_load_failed',
      error
    );
  }

  return hydrateWithPublicProfiles(data);
}

/* -------------------------------------------------------------------------
   AUTHENTICATED REVIEWER
   ------------------------------------------------------------------------- */

export async function getCurrentReviewer() {
  if (!isSupabaseConfigured()) return null;

  let session = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data?.session || null;
  } catch (error) {
    console.warn('[reviews] Could not read the auth session:', error?.message || error);
    return null;
  }

  const user = session?.user;
  if (!user) return null;

  let publicProfile = null;
  try {
    const { data } = await supabase
      .from(PUBLIC_PROFILES_TABLE)
      .select('display_name,photo_url')
      .eq('id', user.id)
      .maybeSingle();
    publicProfile = data || null;
  } catch (error) {
    console.warn('[reviews] Could not read the public profile:', error?.message || error);
  }

  let privateProfile = null;
  if (!pickDisplayName(publicProfile?.display_name)) {
    try {
      const { data } = await supabase
        .from(PRIVATE_PROFILES_TABLE)
        .select('display_name,photo_url')
        .eq('id', user.id)
        .maybeSingle();
      privateProfile = data || null;
    } catch {
      // The private profile table is optional; a missing row is not fatal.
    }
  }

  const metadata = user.user_metadata || {};
  const name =
    pickDisplayName(
      publicProfile?.display_name,
      privateProfile?.display_name,
      metadata.full_name,
      metadata.display_name,
      metadata.name,
      nameFromEmail(user.email)
    ) || 'Paulina Client';

  const avatarUrl =
    normalizePhotoUrl(publicProfile?.photo_url) ||
    normalizePhotoUrl(privateProfile?.photo_url) ||
    normalizePhotoUrl(metadata.avatar_url) ||
    normalizePhotoUrl(metadata.picture) ||
    normalizePhotoUrl(metadata.photo_url) ||
    '';

  return {
    id: user.id,
    name,
    email: user.email || '',
    avatarUrl
  };
}

/* -------------------------------------------------------------------------
   REALTIME
   ------------------------------------------------------------------------- */

/**
 * Subscribes to review changes so the public list and the admin CMS stay in
 * sync without a manual reload. Returns an unsubscribe function; when realtime
 * is not enabled the subscription simply never emits and the pages keep their
 * fetch/refresh behaviour.
 */
export function subscribeToReviewChanges(onChange) {
  if (!isSupabaseConfigured() || typeof onChange !== 'function') return () => {};

  let channel = null;

  try {
    channel = supabase
      .channel('public:reviews')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: REVIEWS_TABLE },
        (payload) => {
          try {
            onChange(payload);
          } catch (error) {
            console.warn('[reviews] Realtime handler failed:', error?.message || error);
          }
        }
      )
      .subscribe();
  } catch (error) {
    console.warn('[reviews] Realtime subscription unavailable:', error?.message || error);
  }

  return () => {
    if (!channel) return;
    try {
      supabase.removeChannel(channel);
    } catch (error) {
      // Removing a closed channel is harmless.
    }
  };
}

/* -------------------------------------------------------------------------
   WRITE PATH
   ------------------------------------------------------------------------- */

function mapWriteError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();

  if (isMissingTableError(error)) {
    return new ReviewServiceError(
      'Reviews are not available yet. Please try again once the studio has enabled them.',
      'reviews_unavailable',
      error
    );
  }

  if (code === '42501' || message.includes('row-level security')) {
    return new ReviewServiceError(
      'Please sign in again before posting your review.',
      'not_authenticated',
      error
    );
  }

  if (code === '23514' || message.includes('check constraint')) {
    return new ReviewServiceError(
      'Please choose a star rating and write at least a short review.',
      'invalid_review',
      error
    );
  }

  return new ReviewServiceError(
    'Your review could not be posted. Please try again in a moment.',
    'review_submit_failed',
    error
  );
}

/**
 * True only when the signed-in account wrote this review. The UI uses it to
 * decide whether to render the delete control at all; the database enforces
 * the same rule independently through row level security.
 */
export function isOwnReview(review, reviewerId) {
  if (!review?.userId || !reviewerId) return false;
  return String(review.userId) === String(reviewerId);
}

/**
 * Deletes one of the signed-in client's own reviews.
 *
 * The `user_id` filter repeats the row level security check on the client, so
 * a request for someone else's review deletes nothing and is reported as
 * missing rather than silently succeeding.
 */
export async function deleteReview(reviewId) {
  if (!isSupabaseConfigured()) {
    return Promise.reject(
      new ReviewServiceError('Reviews are not available right now.', 'reviews_unavailable')
    );
  }

  const reviewer = await getCurrentReviewer();
  if (!reviewer) {
    throw new ReviewServiceError(
      'Please sign in again to delete your review.',
      'not_authenticated'
    );
  }

  const id = String(reviewId || '').trim();
  if (!id) {
    throw new ReviewServiceError('That review could not be found.', 'invalid_review');
  }

  const { data, error } = await supabase
    .from(REVIEWS_TABLE)
    .delete()
    .eq('id', id)
    .eq('user_id', reviewer.id)
    .select('id');

  if (error) {
    if (isMissingTableError(error)) {
      throw new ReviewServiceError(
        'Reviews are not available yet. Please try again once the studio has enabled them.',
        'reviews_unavailable',
        error
      );
    }

    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    if (code === '42501' || message.includes('row-level security')) {
      throw new ReviewServiceError(
        'You can only delete reviews posted from your own account.',
        'not_authenticated',
        error
      );
    }

    throw new ReviewServiceError(
      'Your review could not be deleted. Please try again in a moment.',
      'review_delete_failed',
      error
    );
  }

  if (!Array.isArray(data) || !data.length) {
    throw new ReviewServiceError(
      'That review could not be found, or it does not belong to your account.',
      'review_not_found'
    );
  }

  return id;
}

export async function submitReview({ rating, body, photoUrl = '' } = {}) {
  const reviewer = await getCurrentReviewer();

  if (!reviewer) {
    throw new ReviewServiceError(
      'Please sign in to share your experience so your account name and photo can appear with your review.',
      'not_authenticated'
    );
  }

  const cleanRating = clampRating(rating);
  const cleanBody = cleanMultiline(body);

  if (!cleanRating) {
    throw new ReviewServiceError('Choose a star rating before posting.', 'invalid_rating');
  }

  if (cleanBody.length < MIN_REVIEW_LENGTH) {
    throw new ReviewServiceError(
      `Please write at least ${MIN_REVIEW_LENGTH} characters so your review is helpful.`,
      'review_too_short'
    );
  }

  if (cleanBody.length > MAX_REVIEW_LENGTH) {
    throw new ReviewServiceError(
      `Reviews can be up to ${MAX_REVIEW_LENGTH} characters.`,
      'review_too_long'
    );
  }

  const payload = {
    user_id: reviewer.id,
    reviewer_name: reviewer.name,
    reviewer_photo_url: reviewer.avatarUrl || '',
    rating: cleanRating,
    body: cleanBody,
    photo_url: normalizePhotoUrl(photoUrl),
    is_published: true
  };

  const { data, error } = await supabase
    .from(REVIEWS_TABLE)
    .insert(payload)
    .select(
      'id,user_id,reviewer_name,reviewer_photo_url,rating,body,photo_url,is_published,created_at,updated_at'
    )
    .maybeSingle();

  if (error) throw mapWriteError(error);

  return normalizeReview(data || payload, {
    display_name: reviewer.name,
    photo_url: reviewer.avatarUrl
  });
}
