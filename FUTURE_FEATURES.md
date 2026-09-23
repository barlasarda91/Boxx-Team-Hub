# Future Features

Parked deliberately, not forgotten. Each entry notes what unblocks it.

## Social engagement APIs (added 2026-09-23)
- **Instagram per-post engagement** on Vicky's Calendar: Meta Graph API, free.
  Needs the Boxx IG account as Business/Creator linked to a Facebook Page, plus
  a Meta developer app (walkthrough like the Gmail one). Build: Settings →
  Instagram connect, nightly sync, engagement on day cells + post pop-ups,
  week-over-week in the digest. Token auto-refresh + failure banner included.
- **TikTok per-post metrics**: Display API, free, but requires TikTok developer
  app approval (days to weeks). File the application early; wire up when it clears.
- **RED**: no legitimate API. If wanted, add manual per-post entry fields in the
  post pop-up so RED numbers join the same charts.

## Native invoice PDF parser (added 2026-09-22)
Replace Claude extraction for routine Odeko/Shoreline invoices with per-vendor
layout parsing, Claude as fallback for scans and odd layouts. Revisit around
2026-10-23 with a month of Costs-tab data; needs 2-3 sample PDFs per vendor.

## Retail prices from the Square catalog
Pull per-item retail prices so the pastry deep dive can express early sell-outs
as estimated missed revenue (not just missed units) and waste as margin lost.

## Work-tab assignment for new roles
New members added in Settings get Overview + 1:1. Assigning work tools (like
Ben's Pastry stack) to a genuinely new role is still a code change; a picker in
Settings → Team would make it self-serve once more tool sets exist.
