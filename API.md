# mdpage API Reference — Phase 1

> **Backend contract document** — stable shapes for frontend consumption.
> Last updated: 2026-02-18

---

## Base URL

| Environment | Base URL |
|---|---|
| Development | `http://localhost:3456` |
| Production  | same origin as the SPA |

---

## POST /api/publish

Publish a new article.

### Request body (JSON)

| Field    | Type   | Required | Notes |
|---|---|---|---|
| `markdown` | string | ✅ | Full markdown content. Must start with `# Title`. Max 1 MB. |
| `tier`     | string | ✅ | `"free"` or `"paid"`. Default: `"free"`. |
| `slug`     | string | ❌ | **Paid only.** Custom slug base. Ignored for free tier. |
| `_hp`      | string | ❌ | Honeypot — must be **empty or absent** in legitimate requests. |

### Response (201 Created)

```json
{
  "success":   true,
  "slug":      "my-post-ab3j7x2q",
  "slugBase":  "my-post",
  "url":       "/my-post-ab3j7x2q",
  "tier":      "free",
  "adEnabled": true,
  "status":    "published",
  "createdAt": "2026-02-18T05:00:00.000Z",
  "updatedAt": "2026-02-18T06:00:00.000Z"
}
```

> `updatedAt` is only present when overwriting an existing article.

### Tier-specific slug behaviour

| Tier | Slug format | Example |
|---|---|---|
| `free` | `{slugBase}-{8-char-random}` | `weekly-brief-ab3j7x2q` |
| `paid` | `{slugBase}` (clean) | `weekly-brief` |

Free posts **always** get a random suffix — the `slug` field in the request is ignored for free tier.

### Error responses

| Status | `error` key | Meaning |
|---|---|---|
| 400 | `"Markdown content is required"` | Empty body |
| 400 | `"Article must have a title…"` | Missing `# H1` |
| 400 | `"Could not derive a valid slug…"` | Title contains no usable characters |
| 409 | `"Slug … is already taken"` | Paid slug collision |
| 429 | `"Too many publish requests…"` | Rate limited (5 req / hour per IP) |
| 500 | `"Could not generate a unique slug…"` | Rare: 10 free slug retries failed |
| 507 | `"Server storage full"` | Disk full |

---

## GET /api/articles/:slug

Fetch a published article with metadata.

### Response (200 OK)

```json
{
  "title":   "My Post Title",
  "content": "<p>Rendered HTML...</p>",
  "meta": {
    "slug":               "my-post-ab3j7x2q",
    "slugBase":           "my-post",
    "tier":               "free",
    "adEnabled":          true,
    "status":             "published",
    "description":        "First paragraph excerpt (≤160 chars)",
    "createdAt":          "2026-02-18T05:00:00.000Z",
    "updatedAt":          "2026-02-18T06:00:00.000Z",
    "readingTime":        "3 min read",
    "last30dUniqueViews": 42,
    "expiresAt":          null,
    "atRiskStartedAt":    null
  }
}
```

> `content` is the rendered article body **with the H1 stripped** (the frontend renders the title separately).

### Status-specific behaviour

| `meta.status` | HTTP | Notes |
|---|---|---|
| `"published"` | 200 | Normal response |
| `"at_risk"`   | 200 | Include warning banner: "expires in X days" |
| `"expired"`   | 410 | Article is gone; see expired response below |

### Expired response (410 Gone)

```json
{
  "error":  "This article has expired and is no longer available.",
  "status": "expired",
  "slug":   "my-post-ab3j7x2q"
}
```

### At-risk banner data

When `meta.status === "at_risk"`:
- `meta.expiresAt` — ISO date the post will expire (7 days from `atRiskStartedAt`)
- Compute days remaining: `Math.ceil((new Date(meta.expiresAt) - Date.now()) / 86400000)`
- Banner copy: `"This post will expire in {N} days unless traffic increases or it is upgraded to paid."`

### Ad rendering

- Render ad slots **only** when `meta.adEnabled === true`
- Never render ads when `meta.tier === "paid"` or `meta.adEnabled === false`

---

## POST /api/articles/:slug/view

Record a page view. Idempotent — repeated calls from the same visitor on the same day are no-ops.

### Request body

Empty body is fine. The server fingerprints the visitor from IP + User-Agent headers.

### Response (200 OK)

```json
{
  "recorded": true,
  "date":     "2026-02-18"
}
```

| Field      | Type    | Notes |
|---|---|---|
| `recorded` | boolean | `true` = new unique view counted; `false` = duplicate, ignored |
| `date`     | string  | UTC date bucket (YYYY-MM-DD) |

### Notes

- Call this endpoint **once** after the article loads (e.g. `useEffect` on mount)
- 429 is returned if the IP exceeds 60 view requests per minute
- Expired articles return 410

---

## GET /api/internal/lifecycle/:slug

Inspect lifecycle state for a slug. Debug/admin only.

### Response (200 OK)

```json
{
  "slug":               "my-post-ab3j7x2q",
  "status":             "at_risk",
  "tier":               "free",
  "createdAt":          "2026-01-01T00:00:00.000Z",
  "last30dUniqueViews": 3,
  "expiresAt":          "2026-02-25T05:00:00.000Z",
  "atRiskStartedAt":    "2026-02-18T05:00:00.000Z",
  "lifecycleConfig": {
    "MIN_AGE_DAYS":          30,
    "UNIQUE_VIEW_THRESHOLD": 10,
    "AT_RISK_WINDOW_DAYS":   7
  },
  "viewData": {
    "daily": {
      "2026-02-18": ["fp1", "fp2"]
    }
  }
}
```

---

## POST /api/internal/lifecycle/run

Manually trigger the full lifecycle sweep. In production this is called by a cron job.

### Response (200 OK)

```json
{
  "evaluated": 5,
  "transitions": {
    "at_risk":   2,
    "recovered": 1,
    "expired":   0,
    "no_change": 2,
    "skipped":   10
  },
  "errors": []
}
```

---

## GET /api/internal/config

Returns current runtime configuration for debugging.

### Response (200 OK)

```json
{
  "lifecycle": {
    "MIN_AGE_DAYS":          30,
    "UNIQUE_VIEW_THRESHOLD": 10,
    "AT_RISK_WINDOW_DAYS":   7
  },
  "rateLimit": {
    "publish": { "max": 5,  "windowMs": 3600000 },
    "view":    { "max": 60, "windowMs": 60000   }
  },
  "env": "production"
}
```

---

## Lifecycle State Machine

```
                     POST /api/publish
                          │
                          ▼
                      published
                          │
              (daily sweep: age > 30d, views < 10)
                          │
                          ▼
                       at_risk ──── (traffic recovers) ──→ published
                          │
              (7 days pass, still low traffic)
                          │
                          ▼
                       expired  (410 on GET)
```

---

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3456` | Server port |
| `NODE_ENV` | — | `production` disables CORS headers + debug output |
| `LC_MIN_AGE_DAYS` | `30` | Days before a free post enters lifecycle evaluation |
| `LC_UNIQUE_VIEW_THRESHOLD` | `10` | Min 30-day views to stay healthy |
| `LC_AT_RISK_WINDOW_DAYS` | `7` | Warning countdown before expiry |
| `LIFECYCLE_INTERVAL_MS` | `86400000` (24h) | How often the lifecycle sweep runs |
| `RATE_PUBLISH_MAX` | `5` | Max publish requests per IP per window |
| `RATE_PUBLISH_WIN` | `3600` | Publish rate window in seconds |
| `RATE_VIEW_MAX` | `60` | Max view requests per IP per window |
| `RATE_VIEW_WIN` | `60` | View rate window in seconds |
| `LOG_LEVEL` | `info` (prod) / `debug` (dev) | Minimum log level |

---

## Data Storage

| Path | Contents |
|---|---|
| `data/index.json` | Map of `slug → article metadata` |
| `data/articles/{slug}.md` | Raw markdown source |
| `data/views/{slug}.json` | Daily unique view fingerprints |
