/**
 * lib/slug.js — Slug generation rules for free and paid tiers
 *
 * Free slug format:  /{slugBase}-{randomId}
 *   - randomId: 8-char alphanumeric, lowercase
 *   - Cannot be claimed or cleaned up by the user
 *
 * Paid slug format:  /{slugBase}
 *   - Clean, no suffix
 *   - Case-insensitive uniqueness enforced across paid namespace
 *   - Must be unique; caller handles collision rejection
 *
 * Collision retry:
 *   generateFreeSlug() produces a new random suffix each call.
 *   Callers should retry up to MAX_RETRIES times if the slug already exists.
 */

import { randomBytes } from 'crypto';

// Characters used for the random suffix (no ambiguous chars like 0/O, 1/I/l)
const SUFFIX_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const SUFFIX_LENGTH = 8;
const MAX_RETRIES = 10;

/**
 * Normalize a title or custom string into a slug base.
 * Result is safe for use as a URL path segment.
 */
export function normalizeSlugBase(input = '') {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')  // strip non-alphanum (keep spaces/hyphens)
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-+/g, '-')            // collapse duplicate hyphens
    .replace(/^-|-$/g, '');         // strip leading/trailing hyphens
}

/**
 * Generate a cryptographically random alphanumeric suffix of SUFFIX_LENGTH chars.
 */
function randomSuffix() {
  const bytes = randomBytes(SUFFIX_LENGTH * 2); // over-allocate, pick from charset
  let result = '';
  for (let i = 0; i < bytes.length && result.length < SUFFIX_LENGTH; i++) {
    const idx = bytes[i] % SUFFIX_CHARS.length;
    result += SUFFIX_CHARS[idx];
  }
  return result;
}

/**
 * Build a free-tier slug: `{slugBase}-{randomSuffix}`
 * Call multiple times to get different suffixes on collision.
 *
 * @param {string} slugBase - normalized base (from normalizeSlugBase)
 * @returns {string}
 */
export function generateFreeSlug(slugBase) {
  if (!slugBase) throw new Error('slugBase is required');
  return `${slugBase}-${randomSuffix()}`;
}

/**
 * Build a paid-tier slug: `{slugBase}` (no suffix).
 * Validation / uniqueness check is the caller's responsibility.
 *
 * @param {string} slugBase - normalized base
 * @returns {string}
 */
export function generatePaidSlug(slugBase) {
  if (!slugBase) throw new Error('slugBase is required');
  return slugBase;
}

/**
 * Attempt to generate a collision-free slug for the given tier.
 * Passes each candidate to the `isAvailable(slug) => Promise<bool>` predicate.
 *
 * @param {'free'|'paid'} tier
 * @param {string} slugBase
 * @param {Function} isAvailable  - async (slug) => bool
 * @returns {Promise<string>}       resolved slug
 * @throws if MAX_RETRIES exceeded (free) or slug is taken (paid)
 */
export async function resolveSlug(tier, slugBase, isAvailable) {
  if (tier === 'paid') {
    const slug = generatePaidSlug(slugBase);
    if (!(await isAvailable(slug))) {
      throw Object.assign(new Error(`Slug "${slug}" is already taken`), {
        code: 'SLUG_CONFLICT',
        slug,
      });
    }
    return slug;
  }

  // Free: retry with a new random suffix on collision
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const slug = generateFreeSlug(slugBase);
    if (await isAvailable(slug)) return slug;
  }

  throw Object.assign(
    new Error(`Could not generate unique slug after ${MAX_RETRIES} attempts`),
    { code: 'SLUG_EXHAUSTED' }
  );
}

export { MAX_RETRIES };
