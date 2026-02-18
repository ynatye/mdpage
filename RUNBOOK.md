# mdpage — Operations Runbook

This runbook covers day-to-day operations: deployment, health checks,
data management, and incident response.

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Deploy / Update](#deploy--update)
3. [Health Checks](#health-checks)
4. [Log Management](#log-management)
5. [Data Management](#data-management)
6. [Backups](#backups)
7. [Configuration Changes](#configuration-changes)
8. [Incident Response](#incident-response)
9. [Maintenance Tasks](#maintenance-tasks)

---

## Quick Reference

```bash
# Health
curl http://localhost:3456/healthz

# Container status
docker-compose ps

# Tail logs
docker-compose logs -f --tail=100 mdpage

# Restart
docker-compose restart mdpage

# Full redeploy
git pull && docker-compose up -d --build

# List all articles
ls data/articles/  | grep -v index.json

# Article count
cat data/articles/index.json | python3 -m json.tool | grep '"slug"' | wc -l
```

---

## Deploy / Update

### First deploy

```bash
# 1. Clone
git clone https://github.com/ynatye/mdpage.git
cd mdpage

# 2. Configure
cp .env.example .env     # (or create .env manually — see ENV.md)
$EDITOR .env

# 3. Start
docker-compose up -d

# 4. Verify
curl http://localhost:3456/healthz
# Expected: {"status":"ok","ts":"..."}
```

### Code update (zero-downtime pattern)

mdpage is a single container. For zero-downtime on a single host, use the pull → build → up sequence:

```bash
git pull origin master
docker-compose up -d --build
```

docker-compose replaces the container in place. Existing in-flight requests will
complete before the old container is stopped (default 10s grace period).

**Data safety:** The `./data` volume is mounted from the host, so it survives
container replacement. No data loss on redeploy.

### Rollback

```bash
# Tag the current image before each deploy
docker tag mdpage:latest mdpage:rollback

# If the new build breaks, roll back
docker tag mdpage:rollback mdpage:latest
docker-compose up -d
```

---

## Health Checks

### Liveness probe

```bash
curl -s http://localhost:3456/healthz
```

**Healthy response:**
```json
{"status":"ok","ts":"2026-02-18T06:00:00.000Z"}
```

**Unhealthy:** non-200 status or connection refused → container is down.

### Docker health status

```bash
docker inspect mdpage | python3 -m json.tool | grep -A5 '"Health"'
```

Docker runs `wget -qO- http://localhost:3456/healthz` every 30 seconds.
Status will be `healthy`, `unhealthy`, or `starting`.

### Config endpoint

```bash
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool
```

Returns the current effective thresholds (lifecycle + rate limits). Use this to
confirm env vars took effect after a config change.

### Smoke test (publish round-trip)

```bash
# Requires server running on port 3456
node scripts/validate-publish.js
```

---

## Log Management

### Viewing logs

```bash
# Follow live
docker-compose logs -f mdpage

# Last N lines
docker-compose logs --tail=200 mdpage

# Without Docker (bare node)
node server.js 2>&1 | tee -a /var/log/mdpage/server.log
```

### Log format

All log lines are newline-delimited JSON:

```json
{"ts":"2026-02-18T06:00:00.000Z","level":"info","msg":"article published","slug":"my-article-abc12345x","tier":"free"}
```

### Filtering with jq

```bash
# Errors only
docker-compose logs mdpage | grep '"level":"error"'

# Lifecycle transitions
docker-compose logs mdpage | jq 'select(.msg | contains("lifecycle"))'

# Published articles today
docker-compose logs mdpage | jq 'select(.msg == "article published") | {slug, tier, ts}'
```

### Log rotation

Docker's default JSON log driver has no rotation. Prevent unbounded disk growth:

```bash
# /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  }
}
```

Apply: `sudo systemctl restart docker` (brief service interruption).

---

## Data Management

### Data directory structure

```
data/
├── articles/
│   ├── index.json                  Master index (slug → metadata)
│   └── <slug>/
│       ├── article.json            Article metadata + lifecycle state
│       └── content.md              Raw Markdown source
└── views/
    └── <slug>/
        └── <YYYY-MM-DD>.json       Daily visitor fingerprint set
```

### Inspect an article

```bash
SLUG=my-article-abc12345x

# Metadata + lifecycle state
cat data/articles/$SLUG/article.json | python3 -m json.tool

# Source Markdown
cat data/articles/$SLUG/content.md

# 30-day view count
ls data/views/$SLUG/ | wc -l  # number of days with views
cat data/views/$SLUG/*.json | python3 -c "
import sys, json
total = sum(len(json.load(open(f.strip()))) for f in sys.stdin if f.strip())
print(f'Unique visitor IDs across all days: {total}')
" 2>/dev/null || echo "No view data"
```

### Trigger lifecycle sweep manually

```bash
# Runs sweep immediately (useful for testing or fixing stale state)
curl -s -X POST http://localhost:3456/api/internal/lifecycle/run | python3 -m json.tool
```

### Inspect a specific article's lifecycle state

```bash
curl -s http://localhost:3456/api/internal/lifecycle/my-article-abc12345x | python3 -m json.tool
```

---

## Backups

The entire state of mdpage lives in `data/`. Everything else (code, frontend) is
reproducible from git.

### Manual backup

```bash
tar -czf mdpage-data-$(date +%Y%m%d-%H%M%S).tar.gz data/
```

### Automated daily backup (cron example)

```cron
# Run at 2 AM daily, keep 30 days
0 2 * * * tar -czf /backups/mdpage/mdpage-data-$(date +\%Y\%m\%d).tar.gz /path/to/mdpage/data/ && find /backups/mdpage -name '*.tar.gz' -mtime +30 -delete
```

### Restore from backup

```bash
docker-compose stop mdpage
tar -xzf mdpage-data-20260218-020000.tar.gz
docker-compose start mdpage
```

### Verify backup integrity

```bash
tar -tzf mdpage-data-20260218-020000.tar.gz | grep index.json
```

---

## Configuration Changes

To change an env var (e.g., tune the lifecycle threshold):

```bash
# 1. Edit .env
$EDITOR .env
# Change: LC_UNIQUE_VIEW_THRESHOLD=25

# 2. Restart container (config is read at startup)
docker-compose up -d

# 3. Confirm the change took effect
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool
# Check: "uniqueViewThreshold": 25
```

**Note:** Rate limit counters are in-memory. Restarting the container resets all
rate limit windows. This is acceptable for the current scale.

---

## Incident Response

### Container is down

```bash
docker-compose ps                     # Check status
docker-compose logs --tail=50 mdpage  # Check recent logs
docker-compose up -d                  # Restart
curl http://localhost:3456/healthz    # Verify
```

### 500 errors on publish

```bash
# Check for disk space
df -h /

# Check data directory permissions
ls -la data/articles/

# Test publish directly
curl -s -X POST http://localhost:3456/api/publish \
  -H 'Content-Type: application/json' \
  -d '{"markdown": "# Test\n\nHello.", "tier": "free"}' | python3 -m json.tool
```

### Article stuck in wrong lifecycle state

```bash
# Inspect state
curl -s http://localhost:3456/api/internal/lifecycle/<slug> | python3 -m json.tool

# Force a sweep (may correct the state)
curl -s -X POST http://localhost:3456/api/internal/lifecycle/run

# Manual correction (last resort — edit JSON directly)
docker-compose stop mdpage
$EDITOR data/articles/<slug>/article.json
# Change "status" to: "published", "at_risk", or "expired"
docker-compose start mdpage
```

### Rate limit blocking legitimate traffic

```bash
# Increase limits in .env
RATE_PUBLISH_MAX=20
RATE_VIEW_MAX=200

# Restart to apply
docker-compose up -d

# Note: in-memory limits reset on restart anyway
```

### Disk full

```bash
df -h /

# Find large files
du -sh data/views/* | sort -h | tail -20

# Clean up old view data (keeps structure, removes old daily buckets)
find data/views -name '*.json' -mtime +60 -delete

# Emergency: remove data for a specific slug
# (This permanently deletes the article — confirm before running)
# rm -rf data/articles/<slug> data/views/<slug>
# Then remove from index: cat data/articles/index.json | jq 'del(.["<slug>"])' > /tmp/idx.json && mv /tmp/idx.json data/articles/index.json
```

---

## Maintenance Tasks

### Pruning expired articles from index

The lifecycle sweeper marks articles as `expired` but does not purge view data.
To reclaim disk:

```bash
# List expired articles
cat data/articles/index.json | python3 -c "
import sys, json
idx = json.load(sys.stdin)
for slug, meta in idx.items():
    if meta.get('status') == 'expired':
        print(slug)
"

# Remove view buckets for expired articles (safe — article is already expired)
# Replace <slug> with each expired slug
rm -rf data/views/<slug>
```

### Verifying index integrity

```bash
# List slugs in index that have no article directory
python3 -c "
import os, json
idx = json.load(open('data/articles/index.json'))
for slug in idx:
    if not os.path.exists(f'data/articles/{slug}'):
        print(f'ORPHANED in index: {slug}')
"

# List article directories not in index
python3 -c "
import os, json
idx = json.load(open('data/articles/index.json'))
for d in os.listdir('data/articles'):
    if d != 'index.json' and d not in idx:
        print(f'ORPHANED on disk: {d}')
"
```

### Running the full test suite

```bash
# Start server first
node server.js &
SERVER_PID=$!
sleep 2

# Run all tests
node scripts/test-backend.js
node scripts/test-integration.js

kill $SERVER_PID
```

---

## Morning Validation Commands

Use these every morning to confirm the service is healthy:

```bash
# 1. Container running
docker-compose ps

# 2. Health probe
curl -s http://localhost:3456/healthz

# 3. Effective config
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool

# 4. Article count (sanity check data volume)
python3 -c "import json; d=json.load(open('data/articles/index.json')); print(f'{len(d)} articles in index')"

# 5. Recent lifecycle sweep (check logs)
docker-compose logs --tail=200 mdpage | grep '"lifecycle sweep"' | tail -5

# 6. Backend unit tests (no server needed)
node scripts/test-backend.js

# 7. Smoke publish (requires running server)
node scripts/validate-publish.js
```

All seven should succeed. If any fail, consult the relevant incident response section above.
