# mdpage

> Markdown-powered publishing — write in Markdown, get a shareable URL in seconds.

---

## What is this?

mdpage lets you paste or type Markdown and instantly publish it as a clean, readable article at a permanent URL. No accounts required for free-tier posts.

| Tier | Slug | Ads | Lifecycle |
|------|------|-----|-----------|
| Free | `title-abc12345x` (random suffix) | Ad slots rendered | Expires after 30d low-traffic window |
| Paid | `title` (clean, custom) | None | No expiry |

---

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Start the backend (port 3456)
node server.js

# In a separate terminal — start the frontend dev server (port 5173)
npm run dev
```

Open `http://localhost:5173`.

### Production (Docker — recommended)

```bash
# Copy and edit environment file
cp .env.example .env
$EDITOR .env

# Start
docker-compose up -d

# Verify health
curl http://localhost:3456/healthz
```

Article data is persisted in `./data/` on the host. **Back this up.**

---

## Architecture

```
mdpage/
├── server.js          Express API server (all backend logic)
├── lib/
│   ├── slug.js        Slug generation (free suffix / paid clean)
│   ├── views.js       View tracking with daily unique dedupe
│   ├── lifecycle.js   Article lifecycle state machine
│   ├── ratelimit.js   In-memory rate limiting + honeypot
│   ├── logger.js      Structured JSON logger (pino-style)
│   └── markdown.js    Markdown rendering (unified ecosystem)
├── src/               React frontend (Vite + Tailwind + shadcn/ui)
│   ├── pages/
│   │   ├── Upload.jsx Article editor + publish flow
│   │   └── Article.jsx Article reader + ad gating + at-risk banner
│   └── components/
│       ├── TierSelector.jsx Free/Paid toggle
│       ├── AdSlot.jsx       Ad placeholder (free tier only)
│       └── AtRiskBanner.jsx At-risk countdown banner
├── tests/             QA suite (unit + integration + manual)
├── scripts/           E2E test runners
├── Dockerfile         Multi-stage Docker build
├── docker-compose.yml One-command deployment
├── API.md             Full API reference
├── ROADMAP.md         Phase 1 execution plan
└── RUNBOOK.md         Operational runbook
```

---

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/publish` | Publish a new article |
| `GET` | `/api/articles/:slug` | Fetch article + metadata |
| `POST` | `/api/articles/:slug/view` | Record a view (daily-deduped) |
| `GET` | `/api/internal/lifecycle/:slug` | Inspect lifecycle state |
| `POST` | `/api/internal/lifecycle/run` | Trigger a lifecycle sweep |
| `GET` | `/api/internal/config` | Show current thresholds/limits |
| `GET` | `/healthz` | Liveness probe |

See [API.md](./API.md) for full request/response shapes.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP port |
| `NODE_ENV` | `development` | Set `production` for prod |
| `LC_MIN_AGE_DAYS` | `30` | Days before free post enters lifecycle evaluation |
| `LC_UNIQUE_VIEW_THRESHOLD` | `10` | Min 30-day uniques to stay healthy |
| `LC_AT_RISK_WINDOW_DAYS` | `7` | Days before expiry once at-risk |
| `LIFECYCLE_INTERVAL_MS` | `86400000` | Lifecycle sweep interval (ms) |
| `RATE_PUBLISH_MAX` | `5` | Max publish requests per IP per window |
| `RATE_PUBLISH_WIN` | `3600` | Publish rate window (seconds) |
| `RATE_VIEW_MAX` | `60` | Max view requests per IP per window |
| `RATE_VIEW_WIN` | `60` | View rate window (seconds) |
| `LOG_LEVEL` | `info` (prod) | `debug\|info\|warn\|error` |

Full reference: [ENV.md](./ENV.md)

---

## Running Tests

```bash
# Unit + backend tests (no server needed)
node scripts/test-backend.js

# Integration tests (requires running server on port 3456)
node scripts/test-integration.js

# Full QA suite
bash tests/run-qa.sh

# Quick publish smoke test
node scripts/validate-publish.js
```

---

## Data Layout

```
data/
├── articles/
│   ├── index.json            Slug → metadata index
│   └── <slug>/
│       ├── article.json      Metadata + lifecycle state
│       └── content.md        Raw Markdown source
└── views/
    └── <slug>/
        └── <YYYY-MM-DD>.json  Daily view bucket (visitor fingerprints)
```

> ⚠️ `data/` is excluded from git. Mount it as a Docker volume in production.

---

## Lifecycle States

Free-tier articles move through these states:

```
published  ──(30d low traffic)──▶  at_risk  ──(7d)──▶  expired
    ▲                                │
    └──────(traffic recovery)────────┘
```

- **published:** healthy, visible
- **at_risk:** banner shown, countdown started, recovery still possible
- **expired:** post removed from index, 404 returned

---

## Contributing

1. Branch off `master` → `feat/your-feature`
2. Keep commits small and focused
3. All tests must pass before merge
4. Document new API endpoints in `API.md`

---

## License

MIT
