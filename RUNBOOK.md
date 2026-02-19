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
curl -s http://localhost:3456/healthz | python3 -m json.tool
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool

docker compose logs --tail=100 mdpage
```

#### Interpreting `/healthz`

`/healthz` now returns a richer object you can script against:

```json
{
  "status":        "ok",
  "sweepInFlight": false,
  "checks": {
    "dataDir":       "ok",
    "index":         "ok",
    "lifecycleRuns": "ok"
  },
  "ts": "2026-02-19T..."
}
```

| Field | Values | Meaning |
|---|---|---|
| `status` | `ok` / `degraded` | `degraded` = data dir or `index.json` is unreachable or corrupt |
| `sweepInFlight` | `true` / `false` | Whether a lifecycle sweep is currently running |
| `checks.dataDir` | `ok` / `error` | Data directory read+write accessible |
| `checks.index` | `ok` / `missing` / `corrupt` / `error` | `index.json` readable + valid JSON object |
| `checks.lifecycleRuns` | `ok` / `missing` / `corrupt` / `error` | `lifecycle-runs.json` readable + valid array (non-fatal if missing) |

Script alert example:
```bash
STATUS=$(curl -s http://localhost:3456/healthz | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")
[ "$STATUS" != "ok" ] && echo "ALERT: mdpage degraded ($STATUS)"
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

If you get `409 Conflict`, a sweep is already in progress — check `sweepInFlight` in `/healthz` and wait:

```bash
# Wait until sweep finishes, then retry
while [ "$(curl -s http://localhost:3456/healthz | python3 -c "import json,sys; print(json.load(sys.stdin)['sweepInFlight'])")" = "True" ]; do
  echo "sweep in flight, waiting…"; sleep 5;
done
curl -s -X POST http://localhost:3456/api/internal/lifecycle/run | python3 -m json.tool
```

### Sweep errors in run history

If lifecycle run history shows `Errors > 0`, hover the error count cell in the dashboard to
see which slugs failed.  Full details are in the server logs:

```bash
docker compose logs --tail=500 mdpage | grep '"event":"lifecycle.sweep.error"'
```

The run record also stores up to 5 error slugs in `lifecycle-runs.json` under `errorSlugs[]`
for quick reference without log access.

### Startup integrity warning

If `data/index.json` is corrupt on boot, a structured error is emitted:

```
{"level":"error","event":"startup.integrity.index","error":"...","hint":"data/index.json may be corrupt — restore from backup before serving traffic"}
```

The server continues to start but `loadIndex()` will return `{}`, masking existing articles.
**Do not let traffic land until the index is restored:**

```bash
docker compose stop mdpage
# Restore from backup:
tar -xzf mdpage-data-YYYYMMDD-HHMMSS.tar.gz
docker compose start mdpage
curl -s http://localhost:3456/healthz | python3 -m json.tool
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

## 6) Internal Dashboard Operations

The dashboard lives at `GET /internal` and is protected by `INTERNAL_DASHBOARD_TOKEN`.

### Authentication

- **Browser:** navigate to `/internal` → enter token in the login form → 8-hour session cookie issued.
- **API scripts:** pass `x-internal-token: <token>` header on any `/api/internal/*` request.
- **Sign out:** `GET /internal/logout` clears the session cookie.
- **Unset token (dev):** dashboard is open with a warning banner.

### Dashboard panels

| Panel | What it shows |
|---|---|
| Overview cards | Total / Published / At-risk / Expired / Free / Paid / Total views / Zero-view free / New (7d) |
| Transitions 24h | Summarised lifecycle transitions from recent sweeps |
| Expiring soon | At-risk articles with ≤ 7 days left; red = ≤ 2d, amber = ≤ 4d |
| Top posts (30d) | Most-viewed articles by 30-day unique views |
| Lifecycle run history | Last 10 sweeps — timestamp, evaluated count, transition breakdown, error count |

### Zero-view free articles

The **Zero-view free** card counts active (non-expired) free articles with 0 unique views in
the last 30 days.  These are the next candidates for `at_risk` once they age past 30 days.
A non-zero value is normal on a new instance; a high value on a mature site may indicate a
seeding or traffic problem.

### Running a lifecycle sweep

**From the dashboard:**

1. Click **▶ Run lifecycle sweep**.
2. A confirmation prompt appears — click again to execute.
3. A flash banner confirms success or failure after the redirect.

**Before committing:** run a **dry-run preview** first:

- Click **🔍 Preview (dry run)** — the panel shows what _would_ change without writing anything.
- Or via API:
  ```bash
  curl -s -X POST http://localhost:3456/api/internal/lifecycle/dry-run \
    -H "x-internal-token: $TOKEN" | python3 -m json.tool
  ```

**Directly via API (no dry-run):**

```bash
curl -s -X POST http://localhost:3456/api/internal/lifecycle/run \
  -H "x-internal-token: $TOKEN" | python3 -m json.tool
```

### Reading the run history table

| Column | Meaning |
|---|---|
| Timestamp | UTC ISO time the sweep ran |
| Evaluated | Articles that went through lifecycle evaluation (skips paid + too-new) |
| → At risk | Articles that newly entered `at_risk` state |
| → Recovered | Articles that recovered from `at_risk` back to `published` |
| → Expired | Articles that passed their countdown and became `expired` |
| Errors | Slugs that failed during evaluation (check server logs for detail) |

A healthy production run should show 0 errors and predictable transition counts.

---

## 7) Morning Quick Validation

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
