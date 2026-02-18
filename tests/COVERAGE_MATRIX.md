# Phase 1 QA Coverage Matrix

Maps test coverage against Issue #11 acceptance criteria and PRD §Phase 1.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Automated test exists and covers this |
| 🧪 | Manual test in qa-checklist.md |
| ⏳ | Test defined but pending Phase 1 implementation |
| ❌ | Not yet covered |
| ➕ | Covered by existing tests (pre-Phase 1) |

---

## M1: Tier + Slug Foundation

| Acceptance Criterion | Test ID | File | Status |
|----------------------|---------|------|--------|
| Free publish always returns suffixed slug | SL-01..03, API-02 | unit/slug-rules, integration/api-phase1 | ⏳ |
| Paid publish returns clean slug | SL-04, API-03 | unit/slug-rules, integration/api-phase1 | ⏳ |
| Paid slug collisions reject predictably | SL-05..06, API-04 | unit/slug-rules, integration/api-phase1 | ⏳ |
| Free slugs from same title are unique | SL-07..08 | unit/slug-rules | ✅ |
| Suffix retry avoids collisions | SL-08 | unit/slug-rules | ✅ |
| Empty/invalid titles throw | SL-09 | unit/slug-rules | ✅ |
| isFreeTierSlug() validator | SL-10..11 | unit/slug-rules | ✅ |
| Slug base recovery | SL-12 | unit/slug-rules | ✅ |
| generateSlug() regression guard | SL-13 | unit/slug-rules | ✅ |
| UI tier selector appears | M1-UI-01..04 | manual/qa-checklist | 🧪 |
| Free slug shown in UI with suffix | M1-UI-05..07 | manual/qa-checklist | 🧪 |
| Paid slug shown clean in UI | M1-UI-08..09 | manual/qa-checklist | 🧪 |
| Existing publish flow stable | API-01, REG-05 | integration/api-phase1, manual | ✅ |

---

## M2: Ad Gating

| Acceptance Criterion | Test ID | File | Status |
|----------------------|---------|------|--------|
| Free articles have adEnabled=true | API-02c, API-06c | integration/api-phase1 | ⏳ |
| Paid articles have adEnabled=false | API-05, API-06f | integration/api-phase1 | ⏳ |
| Free article renders ad slots | M2-01..04 | manual/qa-checklist | 🧪 |
| Paid article has zero ad slots | M2-05..07 | manual/qa-checklist | 🧪 |
| Ad fallback graceful if provider unavailable | M2-04 | manual/qa-checklist | 🧪 |

---

## M3: View Tracking Foundation

| Acceptance Criterion | Test ID | File | Status |
|----------------------|---------|------|--------|
| Repeated visits same day not double-counted | VD-01, API-08 | unit/view-dedup, integration/api-phase1 | ⏳ |
| Same visitor different day = 2 views | VD-02 | unit/view-dedup | ✅ |
| Different visitors same day = 2 views | VD-03 | unit/view-dedup | ✅ |
| 30-day rolling window (boundary) | VD-04..06 | unit/view-dedup | ✅ |
| totalViews all-time | VD-07 | unit/view-dedup | ✅ |
| Multi-slug isolation | VD-08 | unit/view-dedup | ✅ |
| dateBucket() UTC correctness | VD-09 | unit/view-dedup | ✅ |
| POST /view endpoint → 200 | API-07 | integration/api-phase1 | ⏳ |
| POST /view idempotent (server) | API-08 | integration/api-phase1 | ⏳ |
| Browser view confirmed (manual) | M3-01..04 | manual/qa-checklist | 🧪 |

---

## M4: Lifecycle Engine

| Acceptance Criterion | Test ID | File | Status |
|----------------------|---------|------|--------|
| Young post stays published (age < 30d) | LC-01 | unit/lifecycle | ✅ |
| Healthy old post stays published | LC-02, LC-13 | unit/lifecycle | ✅ |
| Old + low traffic → at_risk | LC-03 | unit/lifecycle | ✅ |
| atRiskStartedAt + expiresAt set correctly | LC-09 | unit/lifecycle | ✅ |
| at_risk + recovery → published | LC-04 | unit/lifecycle | ✅ |
| Recovery clears timestamps | LC-10 | unit/lifecycle | ✅ |
| at_risk + low + in window → stays at_risk | LC-05 | unit/lifecycle | ✅ |
| at_risk + past expiresAt → expired | LC-06 | unit/lifecycle | ✅ |
| Expired is terminal | LC-07 | unit/lifecycle | ✅ |
| Paid posts skip evaluation | LC-08 | unit/lifecycle | ✅ |
| Batch evaluator runs over multiple posts | LC-11 | unit/lifecycle | ✅ |
| countdownDaysRemaining() | LC-12 | unit/lifecycle | ✅ |
| Boundary: exactly 30d old | LC-14a | unit/lifecycle | ✅ |
| Boundary: 29d old stays published | LC-14b | unit/lifecycle | ✅ |
| Server lifecycle job runs daily | M4-09 | manual/qa-checklist | ⏳ |
| GET /internal/lifecycle/:slug | API-12 | integration/api-phase1 | ⏳ |

---

## M5: At-Risk + Expired UX

| Acceptance Criterion | Test ID | File | Status |
|----------------------|---------|------|--------|
| At-risk banner appears for at_risk free posts | M4-01..03 | manual/qa-checklist | 🧪 |
| Banner shows correct countdown | M4-03 | manual/qa-checklist | 🧪 |
| Banner absent for published free posts | M4-04 | manual/qa-checklist | 🧪 |
| Banner absent for paid posts | M4-05 | manual/qa-checklist | 🧪 |
| Expired post shows expired state / 410 | M4-06..07 | manual/qa-checklist | 🧪 |
| Expired ≠ 404 behavior | M4-07 | manual/qa-checklist | 🧪 |

---

## M6: Hardening + Verification

| Acceptance Criterion | Test ID | File | Status |
|----------------------|---------|------|--------|
| Rate limiting: publish endpoint | M6-01 | manual/qa-checklist | 🧪 |
| Rate limiting: view endpoint | M6-02 | manual/qa-checklist | 🧪 |
| Rate limit headers present | M6-03 | manual/qa-checklist | 🧪 |
| Anti-bot (honeypot/captcha) | M6-04..05 | manual/qa-checklist | 🧪 |
| Concurrent writes don't corrupt index | M6-06 | manual/qa-checklist | 🧪 |
| Index mutex regression guard | (existing, server.js withIndexLock) | — | ➕ |
| generateSlug regression guard | SL-13 | unit/slug-rules | ✅ |
| extractTitle regression guard | (existing validate-publish.js) | scripts/ | ➕ |

---

## Existing Test Coverage (Pre-Phase 1)

These are covered by the existing `scripts/validate-publish.js`:

| Area | Status |
|------|--------|
| extractTitle() | ➕ |
| generateSlug() | ➕ |
| extractDescription() | ➕ |
| estimateReadingTime() | ➕ |
| render() HTML output | ➕ |
| renderContent() H1 stripping | ➕ |
| Multi-line paragraph description (bug fix) | ➕ |

---

## Summary

| Category | Automated ✅ | Pending ⏳ | Manual 🧪 | Existing ➕ | Total |
|----------|-------------|-----------|-----------|------------|-------|
| M1 Slug  | 8           | 4         | 6         | 1          | 19    |
| M2 Ads   | 0           | 2         | 4         | 0          | 6     |
| M3 Views | 7           | 3         | 4         | 0          | 14    |
| M4 Lifecycle | 12      | 2         | 4         | 0          | 18    |
| M5 UX    | 0           | 0         | 6         | 0          | 6     |
| M6 Hard  | 1           | 0         | 5         | 2          | 8     |
| **Total**| **28**      | **11**    | **29**    | **3**      | **71**|

**Automated (ready now):** 28 test assertions across 3 unit test files  
**Pending Phase 1 impl:** 11 integration tests (will pass once backend ships)  
**Manual verification:** 29 browser checklist items  
**Existing coverage:** 3 preserved test groups  

---

## Assumptions Documented

See `tests/ASSUMPTIONS.md` for full list. Key ones:

1. `POST /api/publish` will accept `{ tier: "free" | "paid" }` in request body
2. Response will include `{ tier, adEnabled, status, slug, url }`
3. `GET /api/articles/:slug` meta object will include `tier` and `adEnabled`
4. `POST /api/articles/:slug/view` will return `{ counted: boolean }`
5. View dedup uses visitor fingerprint + UTC date bucket
6. Lifecycle thresholds: 30 days age, 10 views/30d, 7-day warning window
7. `X-Visitor-Id` header (or cookie) identifies visitors for test purposes
