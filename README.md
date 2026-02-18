# mdpage

Markdown-first publishing with free/paid tiers, lifecycle automation, and lightweight operations.

## Phase 1 status

Implemented in this branch:
- free vs paid publish tiers
- slug strategy (free suffixed, paid clean)
- ad gating by tier
- unique-view tracking + lifecycle state machine (`published` → `at_risk` → `expired`)
- rate limits + basic anti-abuse guard
- operational docs + validation scripts

---

## Architecture (Phase 1)

```text
[React + Vite frontend]
        │
        ▼
[Express API: server.js]
  ├─ slug engine (lib/slug.js)
  ├─ markdown render pipeline (lib/markdown.js)
  ├─ view dedupe + rolling counters (lib/views.js)
  ├─ lifecycle evaluator + scheduler (lib/lifecycle.js)
  ├─ rate limiter + honeypot checks (lib/ratelimit.js)
  └─ structured logger (lib/logger.js)
        │
        ▼
[file-backed storage under ./data]
  ├─ data/articles/index.json
  ├─ data/articles/<slug>/article.json
  ├─ data/articles/<slug>/content.md
  └─ data/views/<slug>/<YYYY-MM-DD>.json
```

This is a single-service architecture designed for fast iteration and single-host deploys.

---

## Quick start

### Local development

```bash
npm install
npm run dev
```

- frontend: `http://localhost:5173`
- backend: `http://localhost:3456`

### Local checks

```bash
curl -s http://localhost:3456/healthz
npm run test:backend
npm run test:integration
```

---

## Production (Docker Compose)

```bash
cp .env.example .env
$EDITOR .env

docker compose up -d
curl -s http://localhost:3456/healthz
```

To update:

```bash
git pull
docker compose up -d --build
```

Persistent state is in `./data`.

---

## Commands reference

### Runtime

```bash
npm run dev          # vite + node dev loop
npm run start        # run server only
npm run build        # vite production build
npm run preview      # vite preview
```

### Test / validation

```bash
npm run test:backend
npm run test:unit
npm run test:integration
npm run test:phase1
npm run test:all
node scripts/validate-publish.js
```

---

## API surface

- `POST /api/publish`
- `GET /api/articles/:slug`
- `POST /api/articles/:slug/view`
- `GET /api/internal/lifecycle/:slug`
- `POST /api/internal/lifecycle/run`
- `GET /api/internal/config`
- `GET /healthz`

Full request/response details: [API.md](./API.md)

---

## Docs map

- [ENV.md](./ENV.md) — environment variable reference
- [RUNBOOK.md](./RUNBOOK.md) — local/prod operations runbook
- [QUICK_VALIDATE.md](./QUICK_VALIDATE.md) — morning validation checklist
- [ROADMAP.md](./ROADMAP.md) — phase roadmap
- [PUBLISH_FLOW_CHECKLIST.md](./PUBLISH_FLOW_CHECKLIST.md) — publish flow checks

---

## Contributing

Use feature branches (do not push directly to `master`). Keep commits small and scoped.

Typical flow:

```bash
git checkout -b feat/your-change
# edit
git add .
git commit -m "feat: ..."
git push -u origin feat/your-change
```
