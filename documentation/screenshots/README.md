# Screenshot index

Unaltered browser screenshots refreshed after the review fixes on 2026-10-17 from a separate MySQL review database containing fictional records. These first 15 images document the earlier refinement. The four visitor screenshots below show the current credential-free flow; all images are actual browser captures, not mockups. Login fields are blank in the login screenshot. No passwords, browser cookies, or session state are included.

| File | Screen/context |
| --- | --- |
| [01-login.png](01-login.png) | Blank login screen before credentials are entered |
| [02-admin-dashboard.png](02-admin-dashboard.png) | Morgan Ellis, Administrator; all-record metrics |
| [03-companies.png](03-companies.png) | Four fictional companies and assigned representatives |
| [04-company-details-dialog.png](04-company-details-dialog.png) | Existing Northstar Fabrication View/edit dialog, not a new detail page |
| [05-opportunity-pipeline-page-1.png](05-opportunity-pipeline-page-1.png) | Admin: first ten of twelve matching opportunities |
| [06-opportunity-pipeline-page-2.png](06-opportunity-pipeline-page-2.png) | Admin: remaining two opportunities and page-local column counts |
| [07-opportunity-details.png](07-opportunity-details.png) | Company/contact, assignee, USD value, stage control, tasks and authored note |
| [08-follow-up-tasks-upcoming.png](08-follow-up-tasks-upcoming.png) | Four incomplete tasks due today or later in UTC |
| [09-follow-up-tasks-overdue.png](09-follow-up-tasks-overdue.png) | Two incomplete tasks due before today in UTC |
| [10-follow-up-tasks-completed.png](10-follow-up-tasks-completed.png) | One completed fictional task |
| [11-representative-desktop-dashboard.png](11-representative-desktop-dashboard.png) | Avery Quinn's scoped dashboard, desktop |
| [12-representative-desktop-pipeline.png](12-representative-desktop-pipeline.png) | Six authorized opportunities; later columns are horizontally scrollable |
| [13-representative-mobile-dashboard.png](13-representative-mobile-dashboard.png) | Responsive mobile navigation and scoped dashboard |
| [14-representative-mobile-pipeline.png](14-representative-mobile-pipeline.png) | Narrow board at its initial horizontal position; scroll to later columns |
| [15-representative-mobile-opportunity.png](15-representative-mobile-opportunity.png) | Stacked mobile details, notes and follow-ups |

Admin viewport: 1600×1000. Representative desktop: 1440×1000. Mobile: 390×844 CSS pixels, device scale 3, Chromium emulation. Images use full-page height. Clipped later board columns reflect the current horizontal-scroll behavior, not omitted records. All screenshots were visually inspected; they are not a formal accessibility audit.

See [verification](../verification.md) for pagination, page-local stage counts, complete authorized totals, and the [raw pagination evidence](pagination-evidence.json). Regenerate with `node scripts/prepare-review.mjs` then `npx playwright test --config playwright.review.config.ts`. The review database remains local and is not included.

## Visitor demo

These selected screenshots come from the latest desktop/mobile demo tests against isolated fictional MySQL data. Login fields are empty; cookies, credentials, traces, and session state are not included.

| File | Screen/context |
| --- | --- |
| [16-visitor-demo-login.png](16-visitor-demo-login.png) | Desktop login with Try demo and no-account explanation |
| [17-visitor-demo-desktop.png](17-visitor-demo-desktop.png) | Private visitor dashboard, temporary-data banner and Exit demo |
| [18-visitor-demo-mobile-login.png](18-visitor-demo-mobile-login.png) | Mobile visitor entry with empty login fields |
| [19-visitor-demo-mobile.png](19-visitor-demo-mobile.png) | Responsive visitor dashboard and safety banner |

Regenerate the visitor captures with `npm run test:e2e`, then select only these blank-login/sample-workspace PNGs from the ignored test output. Never publish raw browser traces, error contexts, or filled credential screenshots.
