# mdpage — Environment Variable Reference

All variables are optional and have safe defaults. Set them via a `.env` file
(loaded automatically by docker-compose) or export them in the shell before
starting `node server.js`.

---

## Server

### `PORT`

| | |
|---|---|
| **Default** | `3456` |
| **Type** | Integer |
| **Example** | `PORT=8080` |

TCP port the HTTP server listens on. When running behind a reverse proxy (nginx, Caddy), this can stay at the default — the proxy handles the public port.

---

### `NODE_ENV`

| | |
|---|---|
| **Default** | `development` |
| **Values** | `development` · `production` |
| **Example** | `NODE_ENV=production` |

Controls several behaviour changes:

- **CORS** — in development, CORS is open to `http://localhost:5173` (Vite dev server). In production, same-origin only (SPA is served from the same Express process).
- **Log level** — production defaults to `info`; development allows `debug`.
- **Error detail** — stack traces are suppressed in production responses.

---

## Lifecycle Engine

These variables tune how long free-tier articles survive before entering the
at-risk window and eventually expiring.

### `LC_MIN_AGE_DAYS`

| | |
|---|---|
| **Default** | `30` |
| **Type** | Integer (days) |
| **Example** | `LC_MIN_AGE_DAYS=14` |

A free article is immune from lifecycle evaluation until it is this many days old. New articles will not be flagged as at-risk regardless of view counts.

**Tuning:** Lower this for faster product feedback loops. Raise it to give users more time to share their content.

---

### `LC_UNIQUE_VIEW_THRESHOLD`

| | |
|---|---|
| **Default** | `10` |
| **Type** | Integer (views) |
| **Example** | `LC_UNIQUE_VIEW_THRESHOLD=25` |

Minimum number of unique visitors (rolling 30 days) for a free article to be considered "healthy". Articles below this threshold after `LC_MIN_AGE_DAYS` enter `at_risk` status.

**Tuning:** Set higher on high-traffic instances to focus lifecycle pressure on genuinely low-engagement content. Set lower (even `1`) during development to test transitions.

---

### `LC_AT_RISK_WINDOW_DAYS`

| | |
|---|---|
| **Default** | `7` |
| **Type** | Integer (days) |
| **Example** | `LC_AT_RISK_WINDOW_DAYS=14` |

Days an at-risk article has to recover (reach `LC_UNIQUE_VIEW_THRESHOLD` again) before it expires. The countdown banner on the article page counts down to `atRiskStartedAt + LC_AT_RISK_WINDOW_DAYS`.

**Tuning:** Longer windows are more forgiving; shorter windows create urgency (upgrade pressure). 7 days is the default minimum to avoid surprising authors.

---

### `LIFECYCLE_INTERVAL_MS`

| | |
|---|---|
| **Default** | `86400000` (24 hours) |
| **Type** | Integer (milliseconds) |
| **Example** | `LIFECYCLE_INTERVAL_MS=3600000` |

How often the lifecycle sweep runs. Each sweep checks every free article and applies state transitions.

**Tuning:** In production, 24h is correct — lifecycle granularity is in days. During development/testing, set to `60000` (1 minute) to see transitions happen in real time.

⚠️ Frequent sweeps have no correctness impact (transitions are idempotent) but do add light I/O on large article sets.

---

## Rate Limiting

Rate limits are applied per IP address, tracked in memory. Limits reset when the
server restarts (in-memory only — no Redis or persistent store).

### `RATE_PUBLISH_MAX`

| | |
|---|---|
| **Default** | `5` |
| **Type** | Integer |
| **Example** | `RATE_PUBLISH_MAX=3` |

Maximum number of publish requests allowed per IP per `RATE_PUBLISH_WIN` seconds.

---

### `RATE_PUBLISH_WIN`

| | |
|---|---|
| **Default** | `3600` (1 hour) |
| **Type** | Integer (seconds) |
| **Example** | `RATE_PUBLISH_WIN=7200` |

Sliding window duration for publish rate limiting.

---

### `RATE_VIEW_MAX`

| | |
|---|---|
| **Default** | `60` |
| **Type** | Integer |
| **Example** | `RATE_VIEW_MAX=120` |

Maximum view recording requests allowed per IP per `RATE_VIEW_WIN` seconds.

---

### `RATE_VIEW_WIN`

| | |
|---|---|
| **Default** | `60` (1 minute) |
| **Type** | Integer (seconds) |
| **Example** | `RATE_VIEW_WIN=120` |

Sliding window duration for view rate limiting.

**Note:** View rate limits should be generous enough that a single reader browsing multiple articles is not throttled. Tighten `RATE_PUBLISH_*` to control spam; keep `RATE_VIEW_*` loose.

---

## Logging

### `LOG_LEVEL`

| | |
|---|---|
| **Default** | `info` (production) · `debug` (development) |
| **Values** | `debug` · `info` · `warn` · `error` |
| **Example** | `LOG_LEVEL=debug` |

Controls the minimum severity of log events that are written to stdout. Logs are structured JSON (one object per line), suitable for ingestion by log aggregators (Datadog, Loki, CloudWatch, etc).

**Log fields common to all events:**

```json
{
  "ts": "2026-02-18T06:00:00.000Z",
  "level": "info",
  "msg": "article published",
  "slug": "my-article-abc12345x",
  "tier": "free"
}
```

---

## Example `.env` File

```dotenv
# Server
PORT=3456
NODE_ENV=production

# Lifecycle (default values shown — remove lines to accept defaults)
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
```

Save as `.env` in the project root. **Do not commit `.env` to git** — it is listed in `.gitignore`.
