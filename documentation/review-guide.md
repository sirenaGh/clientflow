# Independent review guide

The repository contains the current source, including the visitor-demo feature; see `documentation/visitor-demo.md` and the newest section of `documentation/verification.md`. The first 15 screenshots document the earlier refinement; four selected visitor screenshots document the current credential-free flow. This revision fixes concurrent ownership authorization, deletion navigation, session recovery, mutation pagination, and secondary-text readability without adding product modules. Start with `README.md` for setup, `documentation/learning-guide.md` for request flow, and `documentation/verification.md` for exact commands, assertions, results, and gaps.

## Suggested review path

1. Inspect the Prisma schema and initial SQL migration for ownership, company/contact consistency, decimal money, date types, and restricted deletion.
2. Follow authentication, CSRF, authorization predicates, and centralized errors in `server/src/app.ts`, and the transaction/guard-lock protocol in `server/src/ownership.ts` and `documentation/concurrency.md`, then database/session lifecycle in `server/src/db.ts` and `server/src/index.ts`.
3. Compare integration assertions with the API routes. Coverage is targeted rather than exhaustive. MySQL 8.4 compatibility remains unverified locally.
4. Review `client/src/main.tsx` and `client/src/styles.css` against the screenshot index. Company details use the existing View/edit dialog; a separate detail page was not added for screenshots.
5. Compare page-local pipeline column counts with the global dashboard/sidebar metrics. Both pages and raw counts are included; an empty column on one page does not mean the whole stage is empty.
6. Review the GitHub Actions workflow and ephemeral CI credential setup independently. The MySQL 8.4 job verifies the server version explicitly. Consult the repository Actions tab for remote results; source publication does not deploy an application.

## Reproduce evidence

Complete README setup, supply passwords in your own ignored local environment, and install the matching Chromium with `npx playwright install chromium`. Python 3 is needed only to package the ZIP.

```powershell
npm run test:prepare
npm test
npm run test:e2e
node scripts/prepare-review.mjs
npx playwright test --config playwright.review.config.ts
npm run lint
npm run typecheck
npm run build
python scripts/package-review.py
```

The review helper uses its own `clientflow_review_test` database on the managed local MySQL instance and never resets normal data. On another MySQL setup, create a separate database ending `_review_test`, grant the configured account access, and set `REVIEW_DATABASE_URL` locally. It must differ from development and integration databases. Review fixtures add eight fictional opportunities and task examples to the four seed companies; the normal development seed is unchanged. A fresh review database gives date-relative task examples. Existing fixtures are preserved rather than reset.

Capture and standard browser tests both use ports 3002/5174; run them sequentially. They refuse to reuse existing servers and stop their own servers afterward. Any pre-existing preview on ports 3001/5173 is separate.

## Package inspection

`scripts/package-review.py` selects known source/documentation paths, inspects content before and after compression, checks ZIP integrity and file hashes, and writes a manifest/report. It compares packaged bytes with actual local secrets without printing those values. Screenshot pixels were reviewed separately. The ZIP is rooted at `ClientFlow/`. A SHA-256 sidecar outside the ZIP validates the final archive without a circular hash.

Fictional account names/emails and fixture companies are intentional review data; their locally generated passwords and database/session credentials are excluded. Browser state, raw traces, databases/dumps, dependencies, Git metadata, build output, and caches are not packaged. Required third-party licenses, dependency license metadata, and legitimate attribution are preserved.
