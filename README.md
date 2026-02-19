# mdpage

Markdown-first publishing with free/paid tiers, billing integration, lifecycle automation, and lightweight operations.

**Current release:** `1.1.0-rc1` (Phase 2 Release Candidate)

---

## Feature status

### Phase 1 (shipped)
- Free vs paid publish tiers
- Slug strategy (free: random-suffix, paid: clean)
- Ad gating by tier
- Unique-view tracking (daily deduplication)
- Lifecycle state machine: `published → at_risk → expired`
- Rate limits + honeypot anti-abuse guard
- Internal dashboard + auth (HMAC session cookies)
- `/healthz` liveness probe, Docker / docker-compose

### Phase 2 (this release)
- **Lifecycle UX consistency** — urgency-aware AtRiskBanner (`critical/high/medium/low`), lightweight `/status` endpoint, `lifecycleUx` in article API response, LifecycleStatusBar footer component
- **Billing schema/config** — plan definitions, `BILLING_STATUS` constants, billing metadata on articles, `billingReadiness()` config check, `/api/internal/billing-config`
- **Checkout initiation** — `POST /api/checkout/session` (Stripe + stub mode), `GET /api/checkout/status/:slug`, `UpgradeCTA` component (button + section variants), upgrade flow from expired page
- **Webhooks + entitlements** — `POST /api/webhooks/stripe` with HMAC verification, `checkout.session.completed` → grant entitlement, refund/subscription-deleted → revoke, subscription-updated → billing status update
- **Abuse controls v2** — fingerprint scoring (block_list, warn_list, burst detection, scripted UA, XFF stuffing), runtime IP block/warn via `/api/internal/abuse/block`, abuse event ring buffer at `/api/internal/abuse`

---

## Architecture

```text
[React + Vite frontend]
        │  (UpgradeCTA, AtRiskBanner, LifecycleStatusBar)
        ▼
[Express API: server.js]
  ├─ slug engine          (lib/slug.js)
  ├─ markdown render      (lib/markdown.js)
  ├─ view deduplication   (lib/views.js)
  ├─ lifecycle evaluator  (lib/lifecycle.js)
  ├─ lifecycle UX helpers (lib/lifecycle-ux.js)   ← Phase 2
  ├─ rate limiter         (lib/ratelimit.js)
  ├─ abuse controls v2    (lib/abuse.js)           ← Phase 2
  ├─ billing schema       (lib/billing.js)         ← Phase 2
  ├─ checkout sessions    (lib/checkout.js)        ← Phase 2
  ├─ webhook processing   (lib/webhooks.js)        ← Phase 2
  ├─ internal auth        (lib/internal-auth.js)
  ├─ health checks        (lib/healthz.js)
  └─ structured logger    (lib/logger.js)
        │
        ▼
[file-backed storage under ./data]
  ├─ data/index.json            — article registry (includes billing metadata)
  ├─ data/articles/<slug>.md    — raw markdown
  ├─ data/views/<slug>.json     — view bucket files
  └─ data/lifecycle-runs.json   — sweep history
```

Single-service architecture designed for fast iteration and single-host deploys.

---

## Quick start

### Local development

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3456`

### Tests

```bash
# Unit tests (253 tests, all pure — no server required)
npm run test:unit

# Backend functional checks (40 assertions)
npm run test:backend

# Integration tests (69 tests — spins up a local server automatically)
npm run test:integration

# All checks
npm run test:all
```

### Validate markdown helpers

```bash
npm test
```

---

## API summary

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/publish` | Publish article (free or paid tier) |
| `GET` | `/api/articles/:slug` | Fetch article + metadata + lifecycleUx |
| `GET` | `/api/articles/:slug/status` | Lightweight lifecycle status check |
| `POST` | `/api/articles/:slug/view` | Record page view (deduped) |
| `POST` | `/api/checkout/session` | Initiate upgrade checkout session |
| `GET` | `/api/checkout/status/:slug` | Poll billing/checkout status |
| `POST` | `/api/webhooks/stripe` | Stripe webhook receiver (HMAC verified) |
| `GET` | `/api/internal/stats` | Health summary (auth) |
| `GET` | `/api/internal/billing-config` | Billing readiness report (auth) |
| `GET` | `/api/internal/abuse` | Abuse event log + block lists (auth) |
| `POST` | `/api/internal/abuse/block` | Runtime IP block/warn management (auth) |
| `GET` | `/api/internal/config` | Runtime config dump (auth) |
| `GET` | `/healthz` | Liveness + data-store reachability probe |

See `API.md` for full request/response shapes.

---

## Billing setup (optional)

Billing defaults to **stub mode** (`BILLING_PROVIDER=none`). In stub mode:
- The upgrade CTA and checkout session API work end-to-end
- No real payment is taken
- Checkout redirects straight to `BILLING_SUCCESS_URL`

To enable real Stripe payments:

```env
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
BILLING_PAID_PRICE_ID=price_...   # or omit to use BILLING_AMOUNT_CENTS
BILLING_SUCCESS_URL=https://yoursite.com/checkout/success
BILLING_CANCEL_URL=https://yoursite.com/checkout/cancel
```

Point your Stripe webhook at `POST /api/webhooks/stripe`.

See `ENV.md` for the full variable reference.

---

## Lifecycle engine

Free articles enter the lifecycle evaluator once they are 30+ days old:

```
published ──(low traffic)──► at_risk ──(7 days elapsed)──► expired
              ▲                  │
              └──(traffic up)────┘   (recovery path)
```

Config via env vars (all tunable):

| Var | Default | Meaning |
|---|---|---|
| `LC_MIN_AGE_DAYS` | `30` | Minimum age before evaluation |
| `LC_UNIQUE_VIEW_THRESHOLD` | `10` | Min 30-day unique visitors |
| `LC_AT_RISK_WINDOW_DAYS` | `7` | Warning countdown before expiry |
| `LIFECYCLE_INTERVAL_MS` | `86400000` | Sweep cadence (default: 24h) |

---

## Abuse controls

Phase 2 adds fingerprint-based scoring on top of the Phase 1 rate limiter:

| Signal | Score |
|---|---|
| IP in `ABUSE_BLOCK_LIST` | +2 |
| IP in `ABUSE_WARN_LIST` | +1 |
| Burst (>N requests in W seconds) | +1 |
| Scripted User-Agent (absent/curl/python) | +1 |
| XFF header stuffing (>300 chars) | +1 |

Score thresholds (tunable):
- `score < ABUSE_SCORE_LIMIT (2)` → allow (log if warn list)
- `score >= ABUSE_SCORE_LIMIT (2)` → 429 Retry-After
- `score >= ABUSE_SCORE_BLOCK (3)` → 403 fake-success (honeypot)

---

## Docker

```bash
docker compose up
```

Mounts `./data` for persistence. See `RUNBOOK.md` for production deployment.

---

## Development

```
npm run dev          # frontend (vite) + backend (nodemon) in parallel
npm run build        # vite production build
npm run start        # production server (requires npm run build)
```
