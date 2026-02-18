/**
 * tests/helpers/test-utils.js
 *
 * Shared utilities for all Phase 1 QA tests.
 */

import { strict as assert } from 'node:assert';

export const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3456';

const API_TIMEOUT_MS = Number(process.env.INTEGRATION_API_TIMEOUT_MS ?? 6_000);
const MAX_RETRIES = Number(process.env.INTEGRATION_API_MAX_RETRIES ?? 2);
const RETRY_DELAY_MS = Number(process.env.INTEGRATION_API_RETRY_DELAY_MS ?? 250);

/**
 * Lightweight assert wrapper that tracks pass/fail counts.
 * Used in integration scripts where node:test is too heavy.
 */
export class TestRunner {
  constructor(label) {
    this.label = label;
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this._results = [];
  }

  ok(condition, name, details) {
    if (condition) {
      this.passed++;
      this._results.push({ status: 'pass', name });
      console.log(`  ✓  ${name}`);
    } else {
      this.failed++;
      this._results.push({ status: 'fail', name, details });
      console.error(`  ✗  ${name}${details !== undefined ? `\n       → ${JSON.stringify(details)}` : ''}`);
    }
  }

  skip(name, reason) {
    this.skipped++;
    this._results.push({ status: 'skip', name, reason });
    console.log(`  ⊘  ${name}  (skip: ${reason})`);
  }

  equal(actual, expected, name) {
    this.ok(actual === expected, name, { actual, expected });
  }

  includes(haystack, needle, name) {
    this.ok(
      typeof haystack === 'string' ? haystack.includes(needle) : haystack?.has?.(needle),
      name,
      { haystack: String(haystack).slice(0, 80), needle }
    );
  }

  summary() {
    const total = this.passed + this.failed + this.skipped;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`[${this.label}]  ${this.passed}/${total} passed  |  ${this.failed} failed  |  ${this.skipped} skipped`);
    return this.failed === 0;
  }
}

/**
 * Make a JSON fetch against the server (used in integration tests).
 */
export async function apiFetch(path, options = {}) {
  const url = `${SERVER_URL}${path}`;

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      });

      let body;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      // Retry transient 5xx responses (useful for live API warmups)
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      return { status: res.status, ok: res.ok, body };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }

  return {
    status: 0,
    ok: false,
    body: {
      error: 'NETWORK_ERROR',
      message: lastErr?.message ?? 'request failed',
      url,
      retries: MAX_RETRIES,
    },
  };
}

/**
 * Check if the server is reachable. Returns true/false.
 */
export async function serverIsReachable() {
  try {
    const res = await fetch(`${SERVER_URL}/healthz`, { signal: AbortSignal.timeout(Math.min(API_TIMEOUT_MS, 4_000)) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Build a minimal valid markdown article.
 */
export function makeArticle({
  title = 'Test Article',
  body = 'A short body paragraph for testing.',
  tier,
} = {}) {
  return { markdown: `# ${title}\n\n${body}`, tier };
}

/**
 * Sleep for ms milliseconds (for rate-limit tests).
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
