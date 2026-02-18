# mdpage Phase 1 — QA Test Suite

This directory contains the QA/Validation lane for Phase 1 development.
Branch: `feat/phase1-qa-lane`

---

## Quick Start

```bash
# Full deterministic gate (recommended local + CI)
npm run test:all

# Integration harness (starts isolated local server on :3457, waits for /healthz)
npm run test:integration

# Integration against already-running server (live API mode)
SERVER_URL=http://my-server:3456 npm run test:integration

# Unit tests only (no server required)
./tests/run-qa.sh unit
```

---

## Directory Structure

```
tests/
├── run-qa.sh                    ← ONE-COMMAND ENTRYPOINT
├── README.md                    ← This file
├── COVERAGE_MATRIX.md           ← Coverage vs Issue #11 requirements
├── ASSUMPTIONS.md               ← API contract assumptions (read before coding)
│
├── unit/                        ← Pure logic tests (no server needed)
│   ├── slug-rules.test.js       ← [SL-01..13] Free vs paid slug policy
│   ├── lifecycle.test.js        ← [LC-01..14] State machine transitions
│   └── view-dedup.test.js       ← [VD-01..10] View deduplication logic
│
├── integration/                 ← API tests (requires running server)
│   └── api-phase1.test.js       ← [API-01..12] End-to-end API verification
│
├── helpers/                     ← Reference implementations + test utilities
│   ├── slug-policy.js           ← Phase 1 slug rules (free suffix, paid clean)
│   ├── lifecycle-machine.js     ← Phase 1 lifecycle state machine
│   ├── view-dedup.js            ← View deduplication strategy
│   └── test-utils.js            ← Shared fetch/assert utilities
│
├── fixtures/                    ← Sample markdown for manual/integration tests
│   ├── free-article.md          ← Free tier sample
│   ├── paid-article.md          ← Paid tier sample
│   └── at-risk-article.md       ← At-risk scenario fixture + instructions
│
└── manual/
    └── qa-checklist.md          ← Browser verification checklist (UI + UX)
```

---

## Test Categories

### Unit Tests (run now — no server required)

These test the **reference implementations** of Phase 1 logic. They define
the expected behavior for slug generation, lifecycle transitions, and view
deduplication. Backend engineers should match this behavior exactly.

```bash
node --test tests/unit/slug-rules.test.js
node --test tests/unit/lifecycle.test.js
node --test tests/unit/view-dedup.test.js
```

### Existing Tests (regression guard)

The pre-Phase-1 markdown validation tests. Must always pass.

```bash
npm test
# OR
node scripts/validate-publish.js
```

### Integration Tests (Phase 1 API — deterministic harness)

`npm run test:integration` is the canonical entrypoint. It is strict by default:

- waits for `/healthz` readiness (local or live server)
- fails if server is unreachable
- fails if critical Phase 1 contracts are missing

```bash
# Preferred: self-managed local integration run
npm run test:integration

# Live API mode (server must already be running)
SERVER_URL=http://my-server:3456 npm run test:integration

# Optional exploratory mode (not for CI): allow phase1 skips
INTEGRATION_STRICT_PHASE1=0 SERVER_URL=http://my-server:3456 npm run test:integration
```

### Manual Tests (browser-based)

See `tests/manual/qa-checklist.md` for the full browser checklist.
Run after any change to the frontend (Upload.jsx, Article.jsx) or server.

---

## Integration Readiness Status

| Feature | Unit Tests | Integration Tests | Manual Checklist |
|---------|-----------|-------------------|-----------------|
| Slug bifurcation (free/paid) | ✅ Ready | ⏳ Awaiting impl | 🧪 Checklist ready |
| Ad gating | — | ⏳ Awaiting impl | 🧪 Checklist ready |
| View dedup | ✅ Ready | ⏳ Awaiting impl | 🧪 Checklist ready |
| Lifecycle engine | ✅ Ready | ⏳ Awaiting impl | 🧪 Checklist ready |
| At-risk UX | — | — | 🧪 Checklist ready |
| Expiry handling | — | — | 🧪 Checklist ready |
| Rate limiting | — | — | 🧪 Checklist ready |

---

## Key Assumptions

Before coding, read `tests/ASSUMPTIONS.md`. Most important:

- `POST /api/publish` will accept `{ tier: "free" | "paid" }`
- Free publish response includes a slug matching `/^.+-[a-z0-9]{8,10}$/`
- Paid publish response includes a clean slug (no suffix)
- `GET /api/articles/:slug` meta includes `tier`, `adEnabled`, `status`
- `POST /api/articles/:slug/view` returns `{ counted: boolean }`
- Lifecycle thresholds: 30-day age, 10 views/30d, 7-day warning

---

## Phase 1 Definition of Done (from PRD)

All of the following must pass before Phase 1 ships:

1. `./tests/run-qa.sh unit` — all unit tests green
2. `npm test` — existing tests still green
3. `./tests/run-qa.sh integration` — all integration tests green (once Phase 1 implemented)
4. All items in `tests/manual/qa-checklist.md` manually verified
5. Sign-off table at bottom of qa-checklist.md completed
