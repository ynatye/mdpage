# mdpage — Local + Production Runbook (Phase 1)

This runbook is for operating mdpage in two modes:
- local development (Node + Vite)
- single-host production (`docker compose`)

---

## 1) Local Development Runbook

### Boot

```bash
npm install
npm run dev
```

`npm run dev` launches:
- backend on `http://localhost:3456`
- frontend Vite dev server on `http://localhost:5173`

### Local health checks

```bash
curl -s http://localhost:3456/healthz
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool
```

### Local test commands

```bash
npm run test:backend
npm run test:integration   # starts isolated local server on 3457 automatically
SERVER_URL=https://your-live-api npm run test:integration   # run against live API
npm run test:phase1
npm run test:all
```

### Local reset (safe dev-only cleanup)

```bash
# stop running dev processes, then:
rm -rf data/articles/* data/views/*
mkdir -p data/articles data/views
printf '{}' > data/index.json
```

> Do not run this on production data.

---

## 2) Production Runbook (Docker Compose)

### First deploy

```bash
git clone https://github.com/ynatye/mdpage.git
cd mdpage
cp .env.example .env
$EDITOR .env

docker compose up -d
curl -s http://localhost:3456/healthz
```

### Deploy update

```bash
git fetch origin
git checkout feat/overnight-buildout   # or your release branch/tag
git pull

docker compose up -d --build
```

### Rollback to previous commit

```bash
git log --oneline -n 5
# choose previous good commit <sha>

git checkout <sha>
docker compose up -d --build
```

Then pin/tag that commit before next rollout.

### Production health checks

```bash
docker compose ps
curl -s http://localhost:3456/healthz
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool

docker compose logs --tail=100 mdpage
```

### Restart service

```bash
docker compose restart mdpage
```

---

## 3) Data + Backup Operations

### Data model reminder

All persistent state is in `./data`:
- `data/index.json`
- `data/articles/<slug>.md`
- `data/views/<slug>.json`

### Backup

```bash
tar -czf mdpage-data-$(date +%Y%m%d-%H%M%S).tar.gz data/
```

### Restore

```bash
docker compose stop mdpage
mv data data.pre-restore.$(date +%s)
mkdir -p data
tar -xzf mdpage-data-YYYYMMDD-HHMMSS.tar.gz
docker compose start mdpage
```

### Verify backup archive

```bash
tar -tzf mdpage-data-YYYYMMDD-HHMMSS.tar.gz | head
tar -tzf mdpage-data-YYYYMMDD-HHMMSS.tar.gz | grep 'data/index.json'
```

---

## 4) Incident Shortcuts

### Service down

```bash
docker compose ps
docker compose logs --tail=200 mdpage
docker compose up -d
curl -s http://localhost:3456/healthz
```

### Publish returns 500

```bash
df -h
ls -la data/articles/

docker compose logs --tail=200 mdpage | grep -i 'error\|publish'
```

### Lifecycle seems stale

```bash
curl -s -X POST http://localhost:3456/api/internal/lifecycle/run | python3 -m json.tool
```

### Rate limits too strict

1. Update `.env` (`RATE_PUBLISH_*` / `RATE_VIEW_*`)
2. Restart container:

```bash
docker compose up -d
```

---

## 5) Config Change Procedure

```bash
$EDITOR .env
docker compose up -d
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool
```

If values do not match expected output, confirm:
- `.env` path is correct (project root)
- no conflicting shell environment overrides
- container was recreated (`docker compose up -d`)

---

## 6) Morning Quick Validation

Run this set every morning after deploys or overnight operations:

```bash
# 1) process/container status
docker compose ps

# 2) liveness
curl -s http://localhost:3456/healthz

# 3) effective runtime config
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool

# 4) quick article count
python3 -c "import json; d=json.load(open('data/index.json')); print(len(d))"

# 5) recent lifecycle logs
docker compose logs --tail=200 mdpage | grep 'lifecycle' | tail -5

# 6) backend checks
npm run test:backend

# 7) API smoke checks
node scripts/health-check.js
```

If any step fails, address incident section above before continuing operations.
