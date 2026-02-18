# Changelog

All notable changes to mdpage are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — feat/phase2-day2-auth-dashboard

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
