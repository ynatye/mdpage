# mdpage — Phase 1 Roadmap (2-Week Single-Dev Plan)

This roadmap translates the PRD into execution order with rough sizing and ownership.

Assumption: 1 full-stack engineer, focused sprint, low meeting overhead.

---

## Sprint Goal

Ship a working v1 of:
- Free vs Paid publishing
- Free suffix slugs vs Paid clean slugs
- Ad gating by tier
- Traffic-aware lifecycle (at-risk + expiry)
- Basic hardening and verification

---

## Milestone Plan

## Week 1 — Core Product Mechanics

### M1: Tier + Slug Foundation
**Owner:** Backend + Frontend (same dev)  
**Estimate:** M (1.5–2 days)

### Deliverables
- `POST /api/publish` accepts `tier` (`free|paid`)
- Metadata persists `tier`, `adEnabled`
- Slug rules:
  - free: `slugBase-randomId`
  - paid: `slugBase`
- Collision handling + case-insensitive uniqueness
- UI tier selector wired into publish flow

### Acceptance Criteria
- Free publish always returns suffixed slug
- Paid publish returns clean slug
- Paid slug collisions reject predictably
- Existing publish flow stays stable

---

### M2: Ad Gating
**Owner:** Frontend  
**Estimate:** S (0.5–1 day)

### Deliverables
- Article rendering respects tier:
  - free: ad slots render
  - paid: no ads
- Fallback behavior if ad provider unavailable

### Acceptance Criteria
- No paid article shows ads
- Free article renders ad placeholders/slots without breaking layout

---

### M3: View Tracking Foundation
**Owner:** Backend  
**Estimate:** M (1–1.5 days)

### Deliverables
- `POST /api/articles/:slug/view`
- Daily unique dedupe strategy (cookie or stable hash)
- Per-slug rolling daily bucket storage
- Utility to compute last-30-day uniques

### Acceptance Criteria
- Repeated visits same day from same visitor do not increment uniques
- Last-30-day unique metric is stable and queryable

---

## Week 2 — Lifecycle + Hardening + QA

### M4: Lifecycle Engine
**Owner:** Backend  
**Estimate:** M (1.5–2 days)

### Deliverables
- Daily job (cron/task runner) for free posts only:
  - older than 30d + low traffic -> `at_risk`
  - at-risk + recovered traffic -> `published`
  - countdown complete + still low -> `expired`
- Persist state fields (`status`, `atRiskStartedAt`, `expiresAt`)
- Transition logs

### Acceptance Criteria
- Deterministic transitions in replay/manual tests
- Recovery logic clears countdown state correctly

---

### M5: At-Risk + Expired UX
**Owner:** Frontend  
**Estimate:** S/M (1 day)

### Deliverables
- At-risk warning banner with countdown days
- Clear upgrade CTA copy
- Expired post experience implemented per policy (archive page or 410 path)

### Acceptance Criteria
- Banner appears only for at-risk free posts
- Countdown reflects backend `expiresAt`
- Expired route behavior consistent between API and page render

---

### M6: Hardening + Verification
**Owner:** Full-stack  
**Estimate:** M (1.5–2 days)

### Deliverables
- Rate limiting on publish + view endpoints
- Basic anti-abuse guard (honeypot/captcha for free publish)
- Keep index write lock around metadata updates
- End-to-end verification script/tests for core paths

### Acceptance Criteria
- Basic abuse attempts throttled
- Concurrent publishes don’t corrupt metadata/index
- Core flows covered by repeatable tests

---

## Ticket Backlog (Copy/Paste)

1. Add `tier` to publish API + metadata persistence  
2. Implement free/paid slug generation rules + collision retries  
3. Add tier selector to Upload UI and wire to publish request  
4. Gate ad rendering by `tier/adEnabled` in article page  
5. Add unique view endpoint with daily dedupe  
6. Add rolling 30-day unique views utility + storage structure  
7. Implement daily lifecycle evaluator for free posts  
8. Add at-risk banner with countdown and upgrade messaging  
9. Implement expired post handling policy (archive or 410)  
10. Add rate limits and anti-bot control for guest publish  
11. Add structured logs for publish/view/lifecycle transitions  
12. Add E2E test coverage for publish, tracking, lifecycle transitions

---

## Suggested Sequence (Strict Order)

1) API tier + slug logic  
2) UI tier controls  
3) Ad gating  
4) View tracking  
5) Lifecycle job  
6) At-risk/expired UX  
7) Hardening  
8) Test sweep + release candidate

---

## Release Criteria (Go/No-Go)

Go live for early users when all are true:
- Free posts always publish with suffixed slugs
- Paid posts get clean slugs and are ad-free
- At-risk and expiry states transition correctly
- Warning countdown is visible and accurate
- Publish/view endpoints are rate-limited
- Regression tests pass on clean environment

---

## Risks & Mitigations

1. **False unique counts** (over/under dedupe)  
Mitigation: start simple, log raw + deduped counts, calibrate threshold.

2. **Lifecycle confusion for users**  
Mitigation: explicit banner copy and consistent status language.

3. **Ad integration hurting UX**  
Mitigation: cap slot count; keep typography/layout priority.

4. **Concurrent writes on metadata/index**  
Mitigation: preserve and test lock around all write paths.

---

## Post-Phase 1 (Next)

- Dashboard for post health (healthy/at-risk/expired)
- Paid plan billing integration and subscription lifecycle hooks
- SEO policy finalization for expired content (404 vs 410 vs archive)
- Better anti-abuse (reputation/IP scoring)
