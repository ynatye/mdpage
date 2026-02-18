# mdpage — Quick Validate Checklist (Morning)

Use this every morning (or after overnight deploy/work) to confirm Phase 1 health.

## 0) Context

Run from project root:

```bash
cd /home/edu/.openclaw/workspace/mdpage
```

If running in Docker mode, ensure compose stack is up first.

---

## 1) Service status

```bash
docker compose ps
```

Expected: `mdpage` container is `Up` (and ideally healthy).

---

## 2) Liveness probe

```bash
curl -s http://localhost:3456/healthz
```

Expected JSON contains `"status":"ok"`.

---

## 3) Effective config sanity

```bash
curl -s http://localhost:3456/api/internal/config | python3 -m json.tool
```

Validate key values match your intended `.env`:
- lifecycle thresholds
- rate limits
- intervals

---

## 4) Data index sanity

```bash
python3 -c "import json; d=json.load(open('data/index.json')); print(f'articles={len(d)}')"
```

Expected: non-negative count and no JSON parse error.

---

## 5) Recent lifecycle activity

```bash
docker compose logs --tail=200 mdpage | grep 'lifecycle' | tail -10
```

Expected: lifecycle logs present and no recurring errors.

---

## 6) Backend checks

```bash
npm run test:backend
```

Expected: pass.

---

## 7) Publish smoke

```bash
node scripts/validate-publish.js
```

Expected: publish + fetch round-trip succeeds.

---

## 8) Optional deep pass (if anything looks off)

```bash
npm run test:all
```

Use this for broader confidence when quick checks fail or after significant changes.

---

## Failure handling

If any step fails:
1. Capture command output.
2. Check logs: `docker compose logs --tail=300 mdpage`.
3. Follow incident procedures in [RUNBOOK.md](./RUNBOOK.md).
4. Only proceed with deploy/work after checks return green.
