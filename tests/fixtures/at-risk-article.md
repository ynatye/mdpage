# Old Article With Low Traffic — At-Risk Scenario Fixture

This fixture is for testing the at-risk lifecycle state.

To simulate an at-risk article in testing, set the following fields in
`data/index.json` manually (or via the lifecycle engine):

```json
{
  "slug": "old-article-with-low-traffic-XXXXXXXX",
  "tier": "free",
  "status": "at_risk",
  "createdAt": "2025-11-01T00:00:00.000Z",
  "atRiskStartedAt": "2026-02-11T00:00:00.000Z",
  "expiresAt": "2026-02-18T00:00:00.000Z",
  "adEnabled": true
}
```

## Expected UI Behavior

When this article is fetched by the Article page:

1. An **at-risk warning banner** should appear at the top of the article
2. The banner should show the countdown: "This post will expire in X days"
3. An upgrade CTA should be present in the banner
4. The article body should still render normally below the banner

## What to Verify

- [ ] Banner appears for `status: "at_risk"` free posts
- [ ] Banner does NOT appear for `status: "published"` posts
- [ ] Banner does NOT appear for paid posts regardless of status
- [ ] Countdown days are computed from `expiresAt - now` (rounded up)
- [ ] At 0 days remaining, banner says "expires today" or similar
