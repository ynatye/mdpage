/**
 * tests/unit/view-dedup.test.js
 *
 * Validates Phase 1 view deduplication logic per PRD §"View Tracking Foundation".
 *
 * Coverage:
 *   [VD-01]  Same visitor same day → 1 unique view (deduplicated)
 *   [VD-02]  Same visitor different day → 2 unique views
 *   [VD-03]  Different visitors same day → 2 unique views
 *   [VD-04]  30-day window: views older than 30 days are excluded
 *   [VD-05]  Views exactly at window boundary (30d) are included
 *   [VD-06]  Views just outside window (31d) are excluded
 *   [VD-07]  totalViews counts all time (no window)
 *   [VD-08]  Multiple slugs are tracked independently
 *   [VD-09]  dateBucket() produces YYYY-MM-DD UTC string
 *   [VD-10]  reset() clears a slug's view data
 *
 * Run: node --test tests/unit/view-dedup.test.js
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ViewStore,
  dateBucket,
  makeVisitorKey,
} from '../helpers/view-dedup.js';

// ---------------------------------------------------------------------------
// [VD-09]  dateBucket helper
// ---------------------------------------------------------------------------
describe('[VD-09] dateBucket() produces UTC YYYY-MM-DD string', () => {
  test('[VD-09a] Known date produces correct bucket', () => {
    const d = new Date('2026-02-18T15:30:00Z');
    assert.equal(dateBucket(d), '2026-02-18');
  });

  test('[VD-09b] Midnight UTC stays on correct day', () => {
    const d = new Date('2026-02-18T00:00:00Z');
    assert.equal(dateBucket(d), '2026-02-18');
  });

  test('[VD-09c] Just before midnight UTC is same day', () => {
    const d = new Date('2026-02-18T23:59:59Z');
    assert.equal(dateBucket(d), '2026-02-18');
  });
});

// ---------------------------------------------------------------------------
// [VD-01..03]  Core deduplication
// ---------------------------------------------------------------------------
describe('[VD-01..03] Core deduplication rules', () => {
  test('[VD-01] Same visitor, same day → 1 unique view', () => {
    const store = new ViewStore();
    const slug = 'test-post';
    const NOW = new Date('2026-02-18T10:00:00Z');
    const bucket = dateBucket(NOW);
    const key = makeVisitorKey('192.168.1.1', 'Mozilla/5.0', slug, bucket);

    const first  = store.recordView(slug, key, bucket);
    const second = store.recordView(slug, key, bucket);
    const third  = store.recordView(slug, key, bucket);

    assert.equal(first, true,   'First view should be NEW');
    assert.equal(second, false, 'Second view same day should be DEDUPLICATED');
    assert.equal(third, false,  'Third view same day should be DEDUPLICATED');
    assert.equal(store.last30dUniqueViews(slug, 30, NOW), 1, 'Only 1 unique view');
  });

  test('[VD-02] Same visitor, different day → 2 unique views', () => {
    const store = new ViewStore();
    const slug = 'test-post';

    const day1 = new Date('2026-02-17T10:00:00Z');
    const day2 = new Date('2026-02-18T10:00:00Z');

    const b1 = dateBucket(day1);
    const b2 = dateBucket(day2);

    const k1 = makeVisitorKey('192.168.1.1', 'Mozilla/5.0', slug, b1);
    const k2 = makeVisitorKey('192.168.1.1', 'Mozilla/5.0', slug, b2);

    store.recordView(slug, k1, b1);
    store.recordView(slug, k2, b2);

    // Query from day2 as "now" — both days are within 30d window
    assert.equal(store.last30dUniqueViews(slug, 30, day2), 2);
  });

  test('[VD-03] Different visitors, same day → 2 unique views', () => {
    const store = new ViewStore();
    const slug = 'test-post';
    const NOW = new Date('2026-02-18T10:00:00Z');
    const bucket = dateBucket(NOW);

    const k1 = makeVisitorKey('10.0.0.1', 'Chrome/100', slug, bucket);
    const k2 = makeVisitorKey('10.0.0.2', 'Firefox/90', slug, bucket);

    store.recordView(slug, k1, bucket);
    store.recordView(slug, k2, bucket);

    assert.equal(store.last30dUniqueViews(slug, 30, NOW), 2);
  });
});

// ---------------------------------------------------------------------------
// [VD-04..06]  30-day rolling window
// ---------------------------------------------------------------------------
describe('[VD-04..06] 30-day rolling window', () => {
  test('[VD-04] Views older than 30 days are excluded from last30d', () => {
    const store = new ViewStore();
    const slug = 'test-post';
    const NOW = new Date('2026-02-18T00:00:00Z');

    // 45 days ago — outside 30-day window
    const oldDay = new Date(NOW.getTime() - 45 * 86400000);
    const oldBucket = dateBucket(oldDay);
    const oldKey = makeVisitorKey('10.0.0.1', 'Chrome', slug, oldBucket);
    store.recordView(slug, oldKey, oldBucket);

    assert.equal(store.last30dUniqueViews(slug, 30, NOW), 0, 'Old view should be outside window');
  });

  test('[VD-05] View exactly 30 days ago is included (boundary)', () => {
    const store = new ViewStore();
    const slug = 'test-post';
    const NOW = new Date('2026-02-18T00:00:00Z');

    // Exactly 30 days ago
    const boundary = new Date(NOW.getTime() - 30 * 86400000);
    const bucket = dateBucket(boundary);
    const key = makeVisitorKey('10.0.0.1', 'Chrome', slug, bucket);
    store.recordView(slug, key, bucket);

    assert.equal(store.last30dUniqueViews(slug, 30, NOW), 1, 'Boundary view should be included');
  });

  test('[VD-06] View 31 days ago is excluded', () => {
    const store = new ViewStore();
    const slug = 'test-post';
    const NOW = new Date('2026-02-18T00:00:00Z');

    // 31 days ago
    const day = new Date(NOW.getTime() - 31 * 86400000);
    const bucket = dateBucket(day);
    const key = makeVisitorKey('10.0.0.1', 'Chrome', slug, bucket);
    store.recordView(slug, key, bucket);

    assert.equal(store.last30dUniqueViews(slug, 30, NOW), 0, '31d-old view should be excluded');
  });
});

// ---------------------------------------------------------------------------
// [VD-07]  totalViews (all-time)
// ---------------------------------------------------------------------------
describe('[VD-07] totalViews counts all time', () => {
  test('[VD-07] totalViews includes all buckets (no window)', () => {
    const store = new ViewStore();
    const slug = 'test-post';
    const NOW = new Date('2026-02-18T00:00:00Z');

    // Add 5 views across 5 different days (some outside 30d window)
    for (let i = 0; i < 5; i++) {
      const day = new Date(NOW.getTime() - i * 20 * 86400000);  // 0, 20, 40, 60, 80 days ago
      const bucket = dateBucket(day);
      const key = makeVisitorKey(`10.0.0.${i}`, 'Chrome', slug, bucket);
      store.recordView(slug, key, bucket);
    }

    assert.equal(store.totalViews(slug), 5, 'totalViews should include all 5 views');
    // But last30d should only include views within 30 days (days 0 and 20)
    assert.equal(store.last30dUniqueViews(slug, 30, NOW), 2, 'Only 2 views in last 30d window');
  });
});

// ---------------------------------------------------------------------------
// [VD-08]  Multi-slug isolation
// ---------------------------------------------------------------------------
describe('[VD-08] Multiple slugs tracked independently', () => {
  test('[VD-08] View for slug A does not affect slug B count', () => {
    const store = new ViewStore();
    const NOW = new Date('2026-02-18T00:00:00Z');
    const bucket = dateBucket(NOW);

    const k1 = makeVisitorKey('10.0.0.1', 'Chrome', 'slug-a', bucket);
    const k2 = makeVisitorKey('10.0.0.1', 'Chrome', 'slug-b', bucket);

    store.recordView('slug-a', k1, bucket);
    store.recordView('slug-a', k1, bucket);  // duplicate — not counted again
    store.recordView('slug-b', k2, bucket);

    assert.equal(store.last30dUniqueViews('slug-a', 30, NOW), 1);
    assert.equal(store.last30dUniqueViews('slug-b', 30, NOW), 1);
    assert.equal(store.last30dUniqueViews('slug-c', 30, NOW), 0, 'Unknown slug returns 0');
  });
});

// ---------------------------------------------------------------------------
// [VD-10]  reset()
// ---------------------------------------------------------------------------
describe('[VD-10] reset() clears view data for a slug', () => {
  test('[VD-10] reset() zeroes the view count', () => {
    const store = new ViewStore();
    const slug = 'test-post';
    const NOW = new Date('2026-02-18T00:00:00Z');
    const bucket = dateBucket(NOW);
    const key = makeVisitorKey('10.0.0.1', 'Chrome', slug, bucket);

    store.recordView(slug, key, bucket);
    assert.equal(store.last30dUniqueViews(slug, 30, NOW), 1);

    store.reset(slug);
    assert.equal(store.last30dUniqueViews(slug, 30, NOW), 0);
    assert.equal(store.totalViews(slug), 0);
  });
});
