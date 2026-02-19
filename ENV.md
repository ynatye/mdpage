# mdpage — Environment Variable Reference

This document is the canonical reference for runtime configuration in Phase 1.

Configuration sources (highest precedence first):
1. Shell environment (`export KEY=value` before start)
2. `.env` file (auto-loaded by `docker compose`)
3. Code defaults in `server.js`

---

## Quick Matrix

| Variable | Default | Scope | Typical Production Value |
|---|---:|---|---|
| `PORT` | `3456` | HTTP server bind port | `3456` |
| `NODE_ENV` | `development` | Runtime mode + CORS behavior | `production` |
| `LC_MIN_AGE_DAYS` | `30` | Lifecycle evaluator | `30` |
| `LC_UNIQUE_VIEW_THRESHOLD` | `10` | Lifecycle evaluator | `10-50` |
| `LC_AT_RISK_WINDOW_DAYS` | `7` | Lifecycle evaluator | `7-14` |
| `LIFECYCLE_INTERVAL_MS` | `86400000` | Lifecycle scheduler cadence | `86400000` |
| `RATE_PUBLISH_MAX` | `5` | Publish endpoint limiter | `5-20` |
| `RATE_PUBLISH_WIN` | `3600` | Publish limiter window (seconds) | `3600` |
| `RATE_VIEW_MAX` | `60` | View endpoint limiter | `60-300` |
| `RATE_VIEW_WIN` | `60` | View limiter window (seconds) | `60` |
| `LOG_LEVEL` | `info` (prod), `debug` (dev) | Structured logging filter | `info` |
| `INTERNAL_DASHBOARD_TOKEN` | unset (open) | Protect /internal dashboard + API | `$(openssl rand -hex 32)` |
| `SERVER_URL` | unset | Integration test target URL | `https://api.example.com` |
| `INTEGRATION_SERVER_WAIT_MS` | `12000` | Integration local-runner startup timeout | `15000` |
| `INTEGRATION_SERVER_POLL_MS` | `200` | Integration local-runner poll interval | `200-500` |
| `INTEGRATION_API_TIMEOUT_MS` | `6000` | Per-request timeout for integration fetch | `6000-10000` |
| `INTEGRATION_API_MAX_RETRIES` | `2` | Retries for transient network/5xx during integration | `2-3` |
| `INTEGRATION_API_RETRY_DELAY_MS` | `250` | Base retry backoff (ms) for integration fetch | `250-500` |

---

## Server

### `PORT`

- Default: `3456`
- Type: integer
- Example: `PORT=8080`

TCP port the Express server listens on.

### `NODE_ENV`

- Default: `development`
- Allowed values: `development`, `production`
- Example: `NODE_ENV=production`

Effects in Phase 1:
- CORS policy differs by environment
- default logging verbosity differs (`debug` in dev, `info` in prod)
- production responses suppress stack details

---

## Lifecycle Engine

These tune the free-tier article lifecycle transitions.

### `LC_MIN_AGE_DAYS`

- Default: `30`
- Type: integer (days)
- Example: `LC_MIN_AGE_DAYS=14`

A free article is ignored by lifecycle state transitions until this age.

### `LC_UNIQUE_VIEW_THRESHOLD`

- Default: `10`
- Type: integer (unique visitors over rolling 30d)
- Example: `LC_UNIQUE_VIEW_THRESHOLD=25`

If an article is old enough and below this threshold, it enters `at_risk`.

### `LC_AT_RISK_WINDOW_DAYS`

- Default: `7`
- Type: integer (days)
- Example: `LC_AT_RISK_WINDOW_DAYS=14`

Grace period before an at-risk article expires if traffic does not recover.

### `LIFECYCLE_INTERVAL_MS`

- Default: `86400000` (24h)
- Type: integer (milliseconds)
- Example: `LIFECYCLE_INTERVAL_MS=3600000`

Background sweep interval for lifecycle processing.

Recommended:
- production: keep at `86400000`
- local lifecycle testing: lower temporarily (for example `60000`)

---

## Rate Limiting

All limits are in-memory per process (reset on restart).

### `RATE_PUBLISH_MAX`

- Default: `5`
- Type: integer
- Example: `RATE_PUBLISH_MAX=10`

Maximum publish requests per IP in each publish window.

### `RATE_PUBLISH_WIN`

- Default: `3600`
- Type: integer (seconds)
- Example: `RATE_PUBLISH_WIN=1800`

Window size for publish throttling.

### `RATE_VIEW_MAX`

- Default: `60`
- Type: integer
- Example: `RATE_VIEW_MAX=120`

Maximum view-record requests per IP in each view window.

### `RATE_VIEW_WIN`

- Default: `60`
- Type: integer (seconds)
- Example: `RATE_VIEW_WIN=60`

Window size for view throttling.

---

## Logging

### `LOG_LEVEL`

- Default: `info` in production, `debug` in development
- Allowed values: `debug`, `info`, `warn`, `error`
- Example: `LOG_LEVEL=warn`

Sets the minimum log severity emitted to stdout (JSON lines).

---

## Internal Dashboard

### `INTERNAL_DASHBOARD_TOKEN`

- Default: unset (dashboard is open — dev/local only)
- Type: string (arbitrary secret; use `openssl rand -hex 32` for production)
- Example: `INTERNAL_DASHBOARD_TOKEN=super-secret-token`

When set, protects `GET /internal` and all `/api/internal/*` endpoints.

**Auth flow (browser):**
1. Browser visits `/internal` → login form is shown (no token in URL ever)
2. User POSTs to `/internal/auth` with the token in the request body
3. Server validates, issues a signed HttpOnly session cookie (8h TTL), redirects to `/internal`
4. Subsequent requests use the cookie automatically

**Auth flow (programmatic):**
- Pass `x-internal-token: <token>` header for API access (curl / scripts)

**Legacy query param:**
- `GET /internal?token=<value>` still works (backward compat) but redirects immediately to strip the token from the URL so it never persists in server logs or browser history

**Cookie security:**
- `HttpOnly; SameSite=Strict; Path=/`
- `Secure` flag added automatically when `NODE_ENV=production`
- Cookie name uses `__Host-` prefix in production for added browser security

⚠️ Leaving this unset in production exposes lifecycle controls and article metadata to anyone who can reach the server. Always set this in production.

---

## Integration Test Runner

These variables tune `npm run test:integration` and are optional.

### `SERVER_URL`

- Default: unset
- Example: `SERVER_URL=https://api.example.com`

When set, integration tests run against that live API URL and do **not** spawn a local backend process.

### `INTEGRATION_SERVER_WAIT_MS`

- Default: `12000`
- Type: integer (milliseconds)

Maximum time the local integration runner waits for server readiness.

### `INTEGRATION_SERVER_POLL_MS`

- Default: `200`
- Type: integer (milliseconds)

Polling interval for local server readiness checks.

### `INTEGRATION_API_TIMEOUT_MS`

- Default: `6000`
- Type: integer (milliseconds)

Per-request timeout used by integration fetch helper.

### `INTEGRATION_API_MAX_RETRIES`

- Default: `2`
- Type: integer

Retries for transient network errors and 5xx responses during integration tests.

### `INTEGRATION_API_RETRY_DELAY_MS`

- Default: `250`
- Type: integer (milliseconds)

Linear backoff base between integration retry attempts.

---

---

## Billing (Phase 2)

### `BILLING_PROVIDER`

- Default: `none`
- Allowed: `none`, `stripe`

Set to `stripe` to enable real payment flows. In `none` mode the checkout API and webhook endpoint work in stub/mock mode (no charges possible).

### `STRIPE_SECRET_KEY`

- Default: unset
- Required when `BILLING_PROVIDER=stripe`

Stripe secret key (`sk_live_*` or `sk_test_*`). Never expose to clients.

### `STRIPE_PUBLISHABLE_KEY`

- Default: unset
- Required when `BILLING_PROVIDER=stripe`

Stripe publishable key for client-side Stripe.js (currently informational — stored in billing config for future SPA use).

### `STRIPE_WEBHOOK_SECRET`

- Default: unset
- Required when `BILLING_PROVIDER=stripe`

Webhook signing secret (`whsec_*`). Used for HMAC verification on `POST /api/webhooks/stripe`. Without this, all webhooks are rejected with 400.

### `BILLING_PAID_PRICE_ID`

- Default: unset
- Type: string

Stripe Price ID to use in checkout line items. If unset, falls back to inline `price_data` using `BILLING_AMOUNT_CENTS`.

### `BILLING_SUCCESS_URL`

- Default: unset

Redirect URL after successful checkout. Stripe appends `?session_id={CHECKOUT_SESSION_ID}`.

### `BILLING_CANCEL_URL`

- Default: unset

Redirect URL when user abandons checkout (clicks "Back").

### `BILLING_CURRENCY`

- Default: `usd`
- Type: ISO-4217 currency code

Used in inline `price_data` when `BILLING_PAID_PRICE_ID` is not set.

### `BILLING_AMOUNT_CENTS`

- Default: `900` ($9.00)
- Type: integer (cents)

One-time price in cents. Used when `BILLING_PAID_PRICE_ID` is not set.

---

## Abuse Controls (Phase 2)

### `ABUSE_BLOCK_LIST`

- Default: unset
- Type: comma-separated IP addresses

IPs to hard-block on publish requests. Block-listed IPs get score+2 → 403 fake-success response.

### `ABUSE_WARN_LIST`

- Default: unset
- Type: comma-separated IP addresses

Suspicious IPs to flag and log. Warn-listed IPs get score+1 → logged but allowed (unless other signals push over threshold).

### `ABUSE_BURST_MAX`

- Default: `10`
- Type: integer

Maximum requests allowed from one IP in the burst window before adding score+1.

### `ABUSE_BURST_WIN`

- Default: `5`
- Type: integer (seconds)

Burst detection window in seconds.

### `ABUSE_SCORE_LIMIT`

- Default: `2`
- Type: integer

Minimum combined score to trigger a 429 Retry-After response.

### `ABUSE_SCORE_BLOCK`

- Default: `3`
- Type: integer

Minimum combined score to trigger a 403 fake-success (honeypot) response.

### `ABUSE_LOG_SIZE`

- Default: `200`
- Type: integer

Maximum entries in the in-memory abuse event ring buffer (visible at `GET /api/internal/abuse`).

---

## Free Article Queue (Global)

### `FREE_ARTICLE_MIN_INTERVAL_MS`

- Default: `60000`
- Type: integer (ms)

Global publish cadence for `POST /api/free/articles`.
At default value, the system creates at most 1 free article per minute globally.

### `FREE_ARTICLE_QUEUE_MAX`

- Default: `200`
- Type: integer

Maximum number of queued free article jobs before enqueue returns 429.

### `FREE_ARTICLE_JOB_TTL_MS`

- Default: `21600000` (6h)
- Type: integer (ms)

How long completed/failed queue jobs remain queryable via
`GET /api/free/articles/jobs/:jobId` before in-memory cleanup.

### `FREE_ARTICLE_WAIT_DEFAULT_MS`

- Default: `30000` (30 s)
- Type: integer (ms)

Maximum time the server holds a connection open when the client passes
`?wait=true` to `POST /api/free/articles`. After this window the server
falls back to a `202 Accepted` queue response even if the job is still pending.

Cap enforced by the server: `waitMs` query param cannot exceed 120 000 ms.

---

## Example `.env`

```dotenv
# Server
PORT=3456
NODE_ENV=production

# Lifecycle
LC_MIN_AGE_DAYS=30
LC_UNIQUE_VIEW_THRESHOLD=10
LC_AT_RISK_WINDOW_DAYS=7
LIFECYCLE_INTERVAL_MS=86400000

# Rate limits
RATE_PUBLISH_MAX=5
RATE_PUBLISH_WIN=3600
RATE_VIEW_MAX=60
RATE_VIEW_WIN=60

# Logging
LOG_LEVEL=info

# Internal dashboard (generate: openssl rand -hex 32)
INTERNAL_DASHBOARD_TOKEN=

# Billing (Phase 2) — leave empty for stub mode
# BILLING_PROVIDER=stripe
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_PUBLISHABLE_KEY=pk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...
# BILLING_PAID_PRICE_ID=price_...
# BILLING_AMOUNT_CENTS=900
# BILLING_SUCCESS_URL=https://yoursite.com/checkout/success
# BILLING_CANCEL_URL=https://yoursite.com/checkout/cancel

# Abuse controls (Phase 2) — all optional
# ABUSE_BLOCK_LIST=1.2.3.4,5.6.7.8
# ABUSE_BURST_MAX=10
# ABUSE_BURST_WIN=5
# ABUSE_SCORE_LIMIT=2
# ABUSE_SCORE_BLOCK=3

# Free queue API (global throttle)
# FREE_ARTICLE_MIN_INTERVAL_MS=60000
# FREE_ARTICLE_QUEUE_MAX=200
# FREE_ARTICLE_JOB_TTL_MS=21600000
```

Never commit your real `.env` file.
