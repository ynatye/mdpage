# Changelog

All notable changes to mdpage are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — feat/overnight-buildout

### Added
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
