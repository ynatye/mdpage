/**
 * tests/helpers/slug-policy.js
 *
 * Phase 1 slug policy — reference implementation for QA tests.
 *
 * This file documents AND enforces the expected slug behavior per the PRD.
 * It is the single source of truth for what the server MUST produce.
 *
 * When server.js implements these rules, the integration tests will compare
 * server output against this reference.
 *
 * PRD excerpt (slug rules):
 *   Free:  /{slugBase}-{randomId}   (8-10 char alphanumeric suffix, always present)
 *   Paid:  /{slugBase}              (clean, unique across paid namespace, case-insensitive)
 */

import { generateSlug } from '../../lib/markdown.js';

export const SUFFIX_LENGTH = 9;  // 8-10 chars per PRD; we use 9 as default
export const SUFFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const MAX_RETRY_ATTEMPTS = 10;

// ---------------------------------------------------------------------------
// Free slug
// ---------------------------------------------------------------------------

/**
 * Generate a free-tier slug: {slugBase}-{randomAlphanumericSuffix}
 *
 * Rules enforced:
 *  - Suffix is always appended (never optional for free tier)
 *  - Suffix is alphanumeric only (a-z0-9), 8-10 chars
 *  - Retries up to MAX_RETRY_ATTEMPTS if candidate already in existingSlugs
 *
 * @param {string} title        Article title
 * @param {Set<string>} existingSlugs  All existing slugs (free + paid namespace)
 * @returns {string} unique free slug
 * @throws if title is empty or max retries exceeded
 */
export function generateFreeSlug(title, existingSlugs = new Set()) {
  const base = generateSlug(title);
  if (!base) throw new Error('Cannot generate slug from empty or symbol-only title');

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const suffix = randomAlphanumeric(SUFFIX_LENGTH);
    const candidate = `${base}-${suffix}`;
    if (!existingSlugs.has(candidate)) return candidate;
  }
  throw new Error(`generateFreeSlug: exceeded ${MAX_RETRY_ATTEMPTS} collision retries`);
}

/**
 * Generate a paid-tier slug: {slugBase}   (clean, no suffix)
 *
 * Rules enforced:
 *  - No random suffix
 *  - Collision detection is case-insensitive (paid namespace only)
 *  - Throws on collision so caller can surface error to user
 *
 * @param {string} title           Article title
 * @param {Set<string>} existingPaidSlugs  Normalized (lowercase) paid slugs
 * @returns {string} clean paid slug
 * @throws if title is empty or slug collides with existing paid slug
 */
export function generatePaidSlug(title, existingPaidSlugs = new Set()) {
  const base = generateSlug(title);
  if (!base) throw new Error('Cannot generate slug from empty or symbol-only title');

  const normalized = base.toLowerCase();
  if (existingPaidSlugs.has(normalized)) {
    throw new Error(`Paid slug collision: "${normalized}" is already owned`);
  }
  return base;
}

// ---------------------------------------------------------------------------
// Slug validators
// ---------------------------------------------------------------------------

/**
 * Returns true if slug matches the free-tier pattern: {base}-{8-10 alphanumeric}
 * Use this to assert a server response came from a free publish.
 */
export function isFreeTierSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  // Last segment must be 8-10 lowercase alphanumeric chars
  return /^[a-z0-9][a-z0-9-]*-[a-z0-9]{8,10}$/.test(slug);
}

/**
 * Returns true if slug is a clean paid slug (no random suffix pattern).
 * Note: this is a heuristic — a paid slug could theoretically look like a free
 * one if the title ends with random chars. Use in conjunction with API tier response.
 */
export function looksLikePaidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) || /^[a-z0-9]$/.test(slug);
}

/**
 * Extract the base portion of a free slug (strips the random suffix).
 * Returns null if slug doesn't match free tier pattern.
 */
export function extractFreeSlugBase(slug) {
  const match = slug?.match(/^(.+)-[a-z0-9]{8,10}$/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function randomAlphanumeric(len) {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)];
  }
  return result;
}
