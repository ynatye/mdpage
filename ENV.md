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
```

Never commit your real `.env` file.
