# The Complete Guide to Markdown Publishing — Paid Tier Sample

This article is used to test the paid-tier publishing path.

## Key Differences from Free Tier

| Feature          | Free      | Paid        |
|------------------|-----------|-------------|
| Slug format      | base-xxxxxxx | clean-slug |
| Ads              | Yes       | No          |
| Retention        | Traffic-dependent | Permanent |
| Custom slug      | No        | Yes         |

## Expected Behavior

1. **Slug**: The slug should be exactly the title-based slug with NO random suffix.
   Expected: `the-complete-guide-to-markdown-publishing-paid-tier-sample`

2. **Ads**: No ad slots should render anywhere on this page.
   Check: top, in-article, and footer positions.

3. **Lifecycle**: This article should NEVER appear in lifecycle evaluations.
   It should never transition to at_risk or expired.

4. **Collision**: Publishing this article again with the same title should return
   a 4xx error rather than creating a duplicate.

## Technical Notes

- `adEnabled` field in metadata should be `false`
- `tier` field should be `"paid"`
- `status` field should always be `"published"` (immune to lifecycle evaluator)
