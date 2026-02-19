# Changelog

All notable changes to mdpage are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — Phase 2

### Added (Day 8 — webhooks + entitlements)

- `lib/webhooks.js` — webhook event processing:
  - `verifyStripeWebhook(rawBody, signature, secret)` — HMAC-SHA256 verification via Stripe SDK (dynamic import)
  - `extractSlugFromEvent(event)` — extracts `mdpage_slug` from event metadata
  - `processStripeEvent(event)` — pure dispatch: maps event type to `{ action, slug, entitlement, revokeReason }` without touching I/O
    - `checkout.session.completed` (paid) → `grant`
    - `payment_intent.payment_failed` → `update` (stay pending)
    - `charge.refunded` → `revoke` (refunded)
    - `customer.subscription.deleted` → `revoke` (expired)
    - `customer.subscription.updated` (cancel) → `update` (cancelled)
    - All other types → `ignore`
  - `applyWebhookDispatch(dispatch, loadIndex, saveIndex, withLock)` — applies grant/revoke/update to index under lock; returns `{ ok, slug, action, message }`
  - `WebhookVerificationError` — typed error for signature failures
- `POST /api/webhooks/stripe` — Stripe webhook endpoint:
  - Uses `express.raw({ type: 'application/json' })` to capture raw body for HMAC verification
  - Verifies signature; rejects bad signatures with 400
  - Processes event → dispatches → always returns 200 to Stripe (retry-safe)
  - Stub mode (BILLING_PROVIDER=none): returns `{ received: true, skipped: true }` immediately
- `tests/unit/webhooks.test.js` — 18 new unit tests across WH-01..WH-12
- Unit test count: 213 → 231

### Added (Day 7 — checkout initiation flow)

- `lib/checkout.js` — checkout session creation:
  - `createCheckoutSession(slug, meta, options)` — creates Stripe session when configured, returns stub session otherwise
  - Stub mode: unique sessionId, configurable successUrl/cancelUrl, no network calls — usable without Stripe keys
  - Stripe mode: dynamic `import('stripe')` (avoids hard dependency), supports both priceId and inline price_data
  - `hasPendingCheckout(meta)` — guard against duplicate sessions
  - `CheckoutError` — typed error with code field (missing_key, sdk_missing)
- `POST /api/checkout/session` — initiate checkout; validates slug, rejects already-active/pending; marks article as `billingStatus=pending`+`checkoutSessionId` before redirecting; returns `{ sessionId, url, stub, provider, amountCents, currency }`
- `GET /api/checkout/status/:slug` — lightweight billing status check (no auth required); returns `{ slug, tier, billingStatus, checkoutSessionId, planActivatedAt }`
- `src/components/UpgradeCTA.jsx` — upgrade CTA component with two variants:
  - `'button'` — compact inline button (used in banners)
  - `'section'` — full upgrade section with feature list (used on expired page)
  - Calls `POST /api/checkout/session` and redirects to checkout URL; handles 409/503/network errors
- `src/pages/Article.jsx` — `ExpiredPage` now shows `UpgradeCTA` section variant with slug (enables in-place upgrade from expired page); `ExpiredPage` receives `slug` prop
- `tests/unit/checkout.test.js` — 17 new unit tests across CO-01..CO-03
- Unit test count: 196 → 213

### Added (Day 6 — billing schema/config plumbing)

- `lib/billing.js` — billing plan definitions and configuration plumbing:
  - `billingConfig` — typed config object from env vars (provider, stripe keys, URLs, currency, amount)
  - `PLANS` — plan definitions (free/paid) with adEnabled, lifecycle, cleanSlug, permanent flags
  - `BILLING_STATUS` — constants: none/pending/active/cancelled/expired/refunded
  - `defaultBillingMeta(tier)` — builds initial billing fields for new articles
  - `applyEntitlement(meta, entitlement, now)` — upgrades article to paid, persists billing IDs
  - `revokeEntitlement(meta, reason, now)` — reverts article to free (refund/lapse)
  - `hasActiveEntitlement(meta)` — checks if article has valid paid access (including legacy)
  - `billingReadiness()` — config validation: reports missing keys, provider status
- `POST /api/publish` — new articles now include billing metadata block in index (billingStatus, checkoutSessionId, subscriptionId, customerId, planActivatedAt, planExpiresAt, billingProvider); existing billing metadata preserved on updates
- `GET /api/internal/billing-config` — new auth'd endpoint returning readiness report and non-sensitive config (keys redacted to boolean flags)
- `.env.example` — added BILLING_* variable block with inline docs
- `tests/unit/billing.test.js` — 35 new unit tests across BL-01..BL-06
- Unit test count: 161 → 196

### Added (Day 5 — lifecycle UX consistency)

- `lib/lifecycle-ux.js` — pure UX-metadata helpers:
  - `urgencyLevel(daysLeft)` — maps days remaining to `critical/high/medium/low`
  - `computeDaysLeft(expiresAt, now)` — ceiling-rounded days, injectable `now` for tests
  - `daysLeftText(daysLeft)` — human copy (`"today"`, `"in 1 day"`, `"in N days"`, `"soon"`)
  - `statusLabel(status)` — `"Published"`, `"At Risk"`, `"Expired"`, `"Unknown"`
  - `buildLifecycleUx(meta, now)` — builds complete `lifecycleUx` object from index record
- `GET /api/articles/:slug` — response now includes `lifecycleUx` field (precomputed urgency, countdown, label)
- `GET /api/articles/:slug` — 410 expired response now includes `title` so clients can render `"<Title> Has Expired"` without a second request
- `GET /api/articles/:slug/status` — new lightweight status-only endpoint (no content rendering); returns `{ slug, status, tier, lifecycleUx }`; also 410+lifecycleUx for expired posts
- `src/components/AtRiskBanner.jsx` — urgency-aware colour palette (`critical`=red, `high`=orange, `medium`=amber, `low`=amber-light); accepts `daysLeft`, `daysLeftText`, `urgency` props from `lifecycleUx`; falls back to client-side calculation for backwards compatibility
- `src/components/LifecycleStatusBar.jsx` — new subtle footer strip showing tier + lifecycle status for free posts; shows soft "Upgrade →" link for at-risk posts
- `src/pages/Article.jsx` — passes `lifecycleUx` props to `AtRiskBanner`; renders `LifecycleStatusBar` in article footer
- `tests/unit/lifecycle-ux.test.js` — 34 new unit tests across LUX-01..LUX-05

### Changed
- `API.md` — documented `lifecycleUx` response field, new `/status` endpoint, enriched 410 shape
- `package.json` — `test:unit` includes `lifecycle-ux.test.js`
- Unit test count: 127 → 161

---

## [Unreleased (Day 1–4)] — feat/phase2-day2-auth-dashboard

### Added (Day 2 — auth hardening + dashboard polish)

- `lib/internal-auth.js` — new auth module:
  - `constantTimeEqual()` — timing-safe token comparison (no oracle attacks)
  - `createSession()` / `verifySession()` — HMAC-SHA256 signed session cookies (8h TTL)
  - `parseCookies()`, `buildSetCookieHeader()`, `buildClearCookieHeader()` — cookie helpers
  - `apiInternalAuth()` — JSON 401 middleware for `/api/internal/*` routes
  - `dashboardAuth()` — HTML login form middleware for `GET /internal`
  - `buildLoginPage()` — styled login form that POSTs (no token in URL)
- `POST /internal/auth` — login endpoint; validates token from POST body, issues session cookie, redirects to clean `/internal`
- `GET /internal/logout` — clears session cookie, redirects to login
- `POST /internal/actions/lifecycle-run` — dashboard-triggered lifecycle sweep (auth'd via cookie)
- `/internal` dashboard — fully redesigned:
  - Dark theme, proper semantic HTML5 with complete CSS
  - Color-coded stat cards (green/yellow/red by status)
  - Lifecycle transitions bar with 24h counters
  - "Run lifecycle sweep" button (POST form, no JS required)
  - Expiring-soon table with clickable article links and day-count color coding
  - Top posts table with tier and status badges
  - Sign-out link; open-dashboard warning banner when `INTERNAL_DASHBOARD_TOKEN` is unset
  - Auto-refresh every 5 minutes (`<meta http-equiv="refresh">`)
  - 500 error page with retry link
- All `/api/internal/*` routes now protected by `apiInternalAuth()` middleware
- Unit tests: `tests/unit/internal-auth.test.js` — 45 tests across IA-01..IA-10

### Fixed
- `GET /internal` previously compared token without constant-time safety; now uses `constantTimeEqual()`
- `?token=` in URL: now immediately redirected to clean URL after setting session cookie — token no longer persists in server logs or browser history
- Removed `render`, `generateSlug`, `evaluateArticle` unused imports from `server.js`

### Added (Day 1 — from previous commit)
- `GET /api/internal/stats` — health summary endpoint (total/published/at_risk/expired/free/paid)
- `GET /healthz` — liveness probe for Docker healthchecks and load balancers
- `Dockerfile` — multi-stage build (builder → slim runtime), non-root user, HEALTHCHECK directive
- `docker-compose.yml` — full env-var passthrough, data volume mapping, healthcheck config
- `.dockerignore` — excludes dev artifacts from Docker build context
- `README.md` — project overview, quick start (dev + Docker), architecture diagram, API table, lifecycle diagram
- `ENV.md` — full per-variable reference with defaults, type, tuning notes, and example block
- `RUNBOOK.md` — operational runbook: deploy/update/rollback, health checks, log management, backups, incident response, maintenance tasks, morning validation commands
- `.env.example` — copy-paste template for new deployments
- `CHANGELOG.md` — this file

### Changed
- `API.md` — added `GET /api/internal/stats` documentation

---

## [1.0.0-phase1] — 2026-02-18

First feature-complete Phase 1 release. All milestone criteria from the 2-week roadmap are met.

### Backend

- `POST /api/publish` — tier-aware publish with free/paid slug bifurcation
- `GET /api/articles/:slug` — article fetch with tier, adEnabled, lifecycle status
- `POST /api/articles/:slug/view` — view recording with daily unique deduplication
- `GET /api/internal/lifecycle/:slug` — lifecycle state inspection
- `POST /api/internal/lifecycle/run` — manual lifecycle sweep trigger
- `GET /api/internal/config` — runtime configuration dump
- **Slug engine** (`lib/slug.js`) — free suffix slugs, paid clean slugs, collision retries
- **View tracking** (`lib/views.js`) — daily bucket storage, 30-day rolling unique count, IP+UA fingerprinting
- **Lifecycle evaluator** (`lib/lifecycle.js`) — state machine: published → at_risk → expired, recovery path
- **Rate limiter** (`lib/ratelimit.js`) — in-memory per-IP limits on publish + view endpoints, honeypot
- **Structured logger** (`lib/logger.js`) — JSON logs with level, timestamp, event name

### Frontend

- **TierSelector** — Free/Paid pill toggle on Upload page
- **AdSlot** — ad placeholder rendered only for free-tier articles
- **AtRiskBanner** — countdown banner for at-risk articles with upgrade CTA
- Tier wired into publish request payload
- Article page gated on `adEnabled` and `status` from API response

### QA

- 53 unit tests across slug rules, lifecycle, and view deduplication (`--test` runner)
- 40 backend assertions (slug, lifecycle, rate limit, logger) via `scripts/test-backend.js`
- 32/32 integration tests against live server via `scripts/test-integration.js`
- Manual QA checklist covering all M1–M6 milestone criteria

---

## [0.x] — Pre-Phase 1

Initial prototype:
- Markdown publish → shareable URL
- Maia design system (Geist Mono, neutral palette, sharp corners)
- Recharts chart blocks
- SVG logo, dark/light theme support
- Basic slug generation (no tier awareness)
