# QA Assumptions — Phase 1 API Contracts

This document records the assumptions the QA suite makes about Phase 1
backend/frontend contracts. When these are confirmed or revised during
implementation, update this file AND the relevant tests.

---

## A1 — Publish API Request Shape

**Assumption:**
```
POST /api/publish
{
  markdown: string,
  slug?: string,      // optional custom slug override
  tier: "free" | "paid"   // NEW in Phase 1
}
```

**Current state:** `tier` field is not yet accepted (ignored or errored).
**When confirmed:** Remove ⏳ from API-02..05 in the coverage matrix.

---

## A2 — Publish API Response Shape

**Assumption:**
```json
{
  "success": true,
  "slug": "my-article-abc12345x",
  "title": "My Article",
  "url": "/my-article-abc12345x",
  "tier": "free",
  "adEnabled": true,
  "status": "published",
  "createdAt": "2026-02-18T00:00:00.000Z",
  "updated": false
}
```

**Current state:** Response includes `{ success, slug, title, url, updated }` only.
**Key new fields:** `tier`, `adEnabled`, `status`, `createdAt`

---

## A3 — Article API Response Shape

**Assumption:**
```json
{
  "title": "My Article",
  "content": "<p>...</p>",
  "meta": {
    "slug": "my-article-abc12345x",
    "description": "...",
    "createdAt": "...",
    "readingTime": "3 min read",
    "tier": "free",         // NEW
    "adEnabled": true,       // NEW
    "status": "published"    // NEW ("published" | "at_risk" | "expired")
  }
}
```

**Current state:** `meta` object does not include `tier`, `adEnabled`, or `status`.

---

## A4 — View Tracking Endpoint

**Assumption:**
```
POST /api/articles/:slug/view
Headers:
  Cookie: mdpage_vid=<visitorToken>  (server-set on first visit)
  OR
  X-Visitor-Id: <clientToken>        (for testing without cookies)

Response (200):
{
  "counted": true | false,   // true = new unique view; false = deduplicated
  "last30dUniqueViews": 42   // current window count (optional, for internal use)
}
```

**Current state:** Endpoint does not exist.

**Dedup strategy (assumed):**
- Server assigns a `mdpage_vid` cookie on first visit (or reads existing)
- Dedup key = `hash(visitorId + slug + YYYY-MM-DD-UTC)`
- Returns `counted: false` if key already seen today

**Alternative (fingerprint):**
If cookies are not used, the server may derive visitor identity from
`hash(ip + user-agent + date)` — same idempotency contract applies.

---

## A5 — Lifecycle Thresholds (PRD defaults)

| Threshold | Value | Source |
|-----------|-------|--------|
| Min post age before evaluation | 30 days | PRD |
| Unique views needed (30d window) | 10 views | PRD (initial proposal) |
| Warning countdown duration | 7 days | PRD |

**These are configurable** per PRD. The QA tests use these defaults.
If thresholds change, update `THRESHOLDS` in `tests/helpers/lifecycle-machine.js`.

---

## A6 — Expired Article Behavior

**Open question (from PRD):** Hard delete vs archive + recoverability window?

**QA assumption:** Server returns HTTP 410 for expired articles.
- `GET /api/articles/<expired-slug>` → `410 Gone`
- Article page renders a distinct "This post has expired" state (not generic 404)

**If decision changes** to archive page, update:
- `tests/manual/qa-checklist.md` [M4-06]
- `tests/integration/api-phase1.test.js` (add expired article test case)

---

## A7 — Internal Lifecycle Endpoint

**Assumption:**
```
GET /api/internal/lifecycle/:slug

Response (200):
{
  "slug": "my-article-abc12345x",
  "tier": "free",
  "status": "at_risk",
  "atRiskStartedAt": "2026-02-11T00:00:00.000Z",
  "expiresAt": "2026-02-18T00:00:00.000Z",
  "last30dUniqueViews": 3,
  "countdownDaysRemaining": 4
}
```

**Current state:** Endpoint does not exist.
**Purpose:** Debug/admin visibility into lifecycle state for a specific post.

---

## A8 — Paid Collision Error Response

**Assumption:** When a paid slug collision occurs, server returns:
```json
HTTP 409 Conflict
{
  "error": "Slug already taken",
  "slug": "my-article"
}
```

**Alternative:** 400 Bad Request is also acceptable.
The integration test ([API-04]) checks for `status >= 400 && status < 500`.

---

## A9 — View Tracking for Paid Articles

**PRD is silent** on whether paid articles should track views.

**QA assumption:**
Views ARE tracked for paid articles (for analytics purposes), but the
lifecycle evaluator ignores them. This means:
- `POST /api/articles/:slug/view` works for both tiers
- `last30dUniqueViews` is computed for all articles
- Lifecycle engine ONLY uses this metric for free-tier posts

**Document when confirmed by backend engineer.**

---

## A10 — Rate Limiting Implementation

**Assumption:**
- Library: `express-rate-limit` or equivalent
- Publish limit: 10 requests per 15 minutes per IP
- View limit: 60 requests per minute per IP
- Response on limit: `429 Too Many Requests` with `Retry-After` header

**Current state:** No rate limiting implemented.

---

## Revision Log

| Date | Change | Author |
|------|--------|--------|
| 2026-02-18 | Initial draft — QA Lane setup | QA Agent |
