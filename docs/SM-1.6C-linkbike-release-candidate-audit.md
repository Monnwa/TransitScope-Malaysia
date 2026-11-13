# SM-1.6C — LinkBike release candidate audit

**TransitScope Malaysia · 13 November 2026 (MYT)**

| Decision | Result |
| --- | --- |
| Local implementation integrity | **GO.** The source matches the approved scope, and the original and HCI checkouts were preserved. |
| Technical release-candidate readiness | **NO-GO.** The optimized homepage and the runtime API can disagree about whether LinkBike is enabled. This triggered the audit stop condition. |
| Upstream data reuse permission | **NO-GO.** An applicable licence or written operator grant has yet to be established. |
| Production deployment authorization | **NO-GO.** Separate approval of the exact release is outstanding. |

## Source integrity

Audited the existing isolated `codex/linkbike-direct-production` worktree at `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. The archived upload manifest `f17c26abf1d286d13c53514179f4dd77a16e440ba0c8e8fe82271eb2cab5358f` and publication record both identify Vercel deployment `dpl_G5fdXzqSsERpUHCtHFGdo8ZXH1zM`. SM-1.6A established the match to the live upload. This audit used that archived evidence without rereading Vercel.

All 120 archived paths were checked again. **114 candidate files match the archive byte-for-byte** and all modes match. The six intended differences are `app/page.tsx`, `components/dashboard.tsx`, `components/transit-map.tsx`, `e2e/train-positions.spec.ts`, `package.json` and `pnpm-lock.yaml`. Reversing the two dashboard edits reconstructs the deployed dashboard. The package changes consist solely of the direct `parse5@7.3.0` dependency and its lockfile importer entry. All 34 pre-existing Git-only paths were preserved. No unexpected candidate path was found. The deployed Station Operations, ERL, official alerts, departure-board, fleet and Bus Journey files, classification archive/outbox and Production-disabled guard, and rail/train application code retain their deployed content. HEAD, staged index, status and SHA-256 fingerprints of pre-existing changed files matched in both other worktrees. [SHA-256 inventory](SM-1.6C-sha256-inventory.json) · [Baseline verification](SM-1.6B-production-baseline-verification.md)

## Release blocker

The optimized artifact places `/` in the prerender manifest with revalidation disabled and serializes `enableLinkBike=false` in the HTML. The API runs dynamically and independently evaluates the environment on each request. Running that same artifact on loopback with both Preview identifiers and the runtime public flag set returned an anonymous fixture-backed **HTTP 200 `UNVERIFIED`** with `Cache-Control: no-store`. The HTML still serialized `false`, Chromium showed zero LinkBike controls, and the page made zero inventory requests. A second configuration with both Production identifiers and only the public flag returned **404** with `no-store`, with the same disabled homepage. The private Production flag was explicitly absent from both process environments. No hosted environment was changed or tested. [Feature gate matrix](SM-1.6C-feature-gate-matrix.md) · [Built artifact and browser log](../test-results/sm16c/built-gate.log)

## Validation status at the stop condition

- **New SM-1.6C evidence** covers source integrity, prerendered HTML, Chromium rendering and anonymous API responses of 404 and fixture-backed 200. Both tested API responses carried `no-store`.
- **Prior SM-1.6B evidence** includes frozen install, TypeScript, ESLint, 354 unit passes, 104 enabled browser passes with one skip, 98 disabled passes with seven skips on the isolated rerun, an optimized build, and matching disabled/baseline fixture comparisons at 390px, 768px and 1440px. It also covers HTTP 405, data and coordinate validation, and fixture failure handling. These are prior results. The independent repeat of the full matrix, including 503 and 405, invalid and missing coordinates, station 16 quarantine, IDs 28/29/80/1023, and attribution in the popup, stopped after the gate failure. [SM-1.6B validation and logs](SM-1.6B-direct-linkbike-integration-report.md#local-validation)
- The archived Fleet API oversized-response 503 predates LinkBike. The fleet route and size guard match deployed bytes. Current fleet behavior was not sampled. [Separate Fleet API finding](SM-1.6B-direct-linkbike-integration-report.md#separate-fleet-api-finding)
- The cache report records source-review findings, background-tab polling, and per-instance request estimates. Its proposed checks remain pending. [Cache and polling risk](SM-1.6C-cache-and-polling-risk.md)

## Release prerequisites

1. Resolve the gate inconsistency in a separately scoped correction. Make the homepage and API use the same server-side configuration at the same lifecycle point. Verify actual built HTML, UI and HTTP behavior with missing, changed and mismatched values, then rerun the interrupted validation matrix.
2. Obtain an applicable licence or written permission from the operator covering both **Maintenance Portal inventory** and **consumer coordinate data**. It must specify permitted fields, anonymous public redistribution through both UI and API, automated polling frequency including aggregate and failure traffic, attribution and links, retention periods, and cache scope and duration. Confirm the intended rate and the treatment of quarantined raw coordinates. The published materials and existing audit establish no such grant. No operator contact was made. [Existing portal data reuse audit](linkbike-portal-integration-audit.md#terms-and-data-reuse)
3. Obtain the project owner's separate approval for the exact release, flag settings and deployment. Production and the existing candidate source were preserved. This phase made no application changes, commit, push, deployment, Vercel change, Production enablement or AWS access.

