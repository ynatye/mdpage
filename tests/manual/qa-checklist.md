# Phase 1 QA Manual Checklist

Browser-based verification for features that can't be fully automated.
Run after every significant change to the frontend or server.

---

## Setup

```bash
# Build the app and start the server
npm run build
node server.js

# OR run in dev mode
npm run dev
```

Open: http://localhost:3456

---

## M1: Tier + Slug Foundation

### UI Tier Selector

- [ ] **[M1-UI-01]** Upload page shows a tier selector (Free / Paid) before publishing
- [ ] **[M1-UI-02]** Default tier is "Free" (safer default for guests)
- [ ] **[M1-UI-03]** Tier selection is clearly labeled and visually distinct
- [ ] **[M1-UI-04]** On mobile (< 768px), the tier selector is accessible in both Editor and Preview tabs

### Free Slug Display

- [ ] **[M1-UI-05]** After publishing as Free:
  - Slug field shows the full slug with random suffix (e.g., `my-article-abc12345x`)
  - The suffix is clearly visible (not truncated)
- [ ] **[M1-UI-06]** Slug field tooltip or placeholder clarifies the suffix is automatic
- [ ] **[M1-UI-07]** Publishing the same title twice (Free) produces two visibly different slugs

### Paid Slug Display

- [ ] **[M1-UI-08]** After publishing as Paid:
  - Slug field shows clean slug without suffix (e.g., `my-article`)
- [ ] **[M1-UI-09]** Attempting to publish a Paid article with a slug already owned shows a clear error
  - Error message must explain it's a collision (not a generic error)

### Publish Flow Smoke Test

- [ ] **[M1-UI-10]** Open `tests/fixtures/free-article.md`, paste into editor, select Free, publish
  - Slug has random suffix ✓
  - Toast: "Article published!" ✓
- [ ] **[M1-UI-11]** Open `tests/fixtures/paid-article.md`, paste into editor, select Paid, publish
  - Slug is clean ✓
  - Toast: "Article published!" ✓
- [ ] **[M1-UI-12]** Try to publish `paid-article.md` again as Paid → error toast (slug already taken)

---

## M2: Ad Gating

### Article Page — Free

- [ ] **[M2-01]** Navigate to a Free article published in M1
- [ ] **[M2-02]** Ad slots are visible:
  - [ ] Top banner ad slot (above article body)
  - [ ] In-article ad slot (e.g., after first section or midpoint)
  - [ ] Footer ad slot (below article body)
- [ ] **[M2-03]** Ad slots don't break the article layout (typography intact)
- [ ] **[M2-04]** If ad provider is unavailable, layout degrades gracefully (no errors, no blank space blowup)

### Article Page — Paid

- [ ] **[M2-05]** Navigate to the Paid article published in M1
- [ ] **[M2-06]** **Zero** ad slots visible anywhere on the page
  - Check: inspect DOM — no ad container elements present for paid articles
- [ ] **[M2-07]** Article reads cleanly with no ad-shaped empty spaces
- [ ] **[M2-08]** Page title, date, reading time all present (metadata unaffected by tier)

---

## M3: View Tracking

### Basic Tracking

- [ ] **[M3-01]** Load a Free article — verify view is tracked (check server logs or data/views/)
- [ ] **[M3-02]** Reload the same article in the same browser session (same day)
  - Server should NOT count a duplicate view
  - `data/views/{slug}.json` (or equivalent) shows 1 unique view, not 2
- [ ] **[M3-03]** Open the article in an Incognito/Private window
  - A new unique view IS counted (different visitor fingerprint)
  - `last30dUniqueViews` increments to 2

### Tracking for Paid Articles

- [ ] **[M3-04]** Load a Paid article — verify views are NOT tracked (or tracked separately)
  - _Note: PRD is silent on whether paid articles track views. Document assumption._
  - Decision: views are tracked for all articles (metrics), but lifecycle evaluator skips paid.

---

## M4 + M5: Lifecycle Engine & At-Risk UX

### At-Risk Banner Appearance

To test this without waiting 30 days, manually set `status: "at_risk"` in `data/index.json`
for a free article (use `tests/fixtures/at-risk-article.md` as a guide).

- [ ] **[M4-01]** Article page for an `at_risk` free post shows the warning banner
- [ ] **[M4-02]** Banner text includes:
  - Phrase "expire" or "expiring"
  - Countdown days (computed from `expiresAt`)
  - Upgrade CTA / link
- [ ] **[M4-03]** Countdown is correct:
  - Set `expiresAt` = now + 3 days → banner says "3 days" (or "expires in 3 days")
  - Set `expiresAt` = now + 1 day → banner says "1 day" (or "tomorrow")
  - Set `expiresAt` = past → banner says "0 days" or "today"
- [ ] **[M4-04]** Banner does NOT appear for `status: "published"` free posts
- [ ] **[M4-05]** Banner does NOT appear for paid posts (any status)

### Expired Article Handling

Manually set `status: "expired"` in `data/index.json` to test.

- [ ] **[M4-06]** Navigating to an expired article's URL shows the expired state:
  - Option A: 410 HTTP status + expired page
  - Option B: Custom archive page (still accessible but clearly marked expired)
  - _Document which policy was implemented_
- [ ] **[M4-07]** The expired page/state is distinct from the 404 "not found" state
- [ ] **[M4-08]** Expired article shows a way to upgrade to paid (optional but recommended)

### Lifecycle Engine Manual Trigger

- [ ] **[M4-09]** Run the lifecycle evaluator manually:
  ```bash
  node scripts/run-lifecycle.js  # (once implemented)
  ```
  - Verify transitions in `data/index.json` match expected states
  - Verify transition logs are written

---

## M6: Hardening

### Rate Limiting

- [ ] **[M6-01]** Rapid-fire publish requests (>10 in 60s from same IP) → throttled with 429
- [ ] **[M6-02]** Rapid-fire view requests → throttled gracefully (no server crash)
- [ ] **[M6-03]** Rate limit headers present in responses:
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`

### Anti-Abuse (Free Publish)

- [ ] **[M6-04]** Free publish form has bot protection:
  - Honeypot field (hidden from real users, bots fill it in → rejected)
  - OR CAPTCHA challenge (if configured)
- [ ] **[M6-05]** Filling the honeypot field → publish silently rejects or returns 400/403

### Concurrent Write Safety

- [ ] **[M6-06]** Simultaneous publish of different articles doesn't corrupt `data/index.json`
  - Run: `node tests/integration/concurrent-publish.js` (once implemented)
  - Verify all articles appear in index.json after concurrent writes

---

## Regression Guard

Run after any changes:

- [ ] **[REG-01]** `npm test` passes (existing validate-publish.js tests)
- [ ] **[REG-02]** `node --test tests/unit/slug-rules.test.js` → all pass
- [ ] **[REG-03]** `node --test tests/unit/lifecycle.test.js` → all pass
- [ ] **[REG-04]** `node --test tests/unit/view-dedup.test.js` → all pass
- [ ] **[REG-05]** Basic publish still works (paste markdown, publish, visit article)
- [ ] **[REG-06]** Article update preserves `createdAt` (not overwritten on re-publish)

---

## Sign-Off Criteria for Phase 1 Release

All items below must be ✓ before shipping:

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Free publish always returns suffixed slug | ⬜ |
| 2 | Paid publish returns clean slug, rejects collisions | ⬜ |
| 3 | Free articles show ads; paid articles never do | ⬜ |
| 4 | At-risk banner appears/disappears correctly | ⬜ |
| 5 | Expired post policy consistent (API + page) | ⬜ |
| 6 | View dedup confirmed (no double-counting same visitor/day) | ⬜ |
| 7 | Rate limiting active on publish + view endpoints | ⬜ |
| 8 | All automated tests pass on clean environment | ⬜ |
| 9 | Lifecycle batch job runs deterministically | ⬜ |
