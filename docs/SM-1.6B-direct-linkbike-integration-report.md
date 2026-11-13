# SM-1.6B — Direct LinkBike integration

**TransitScope Malaysia · 13 November 2026 (MYT)**

**GO for SM-1.6C after review.** LinkBike is integrated and locally validated in the new `codex/linkbike-direct-production` worktree. Public release remains **NO-GO** pending upstream reuse permission, SM-1.6C and approval of the exact release. The Production enablement flag was left unset.

## Source and preservation

The new worktree is based on `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. Before applying LinkBike, all 120 restored Production files matched the recorded upload path, size, SHA-1 and Windows file mode. The baseline report lists the 23 substantive differences from `master`. [Production baseline verification](SM-1.6B-production-baseline-verification.md)

The immutable LinkBike delta came from `f869ffc66dce5dd7751375f5fb0d41d393911c46`. The final comparison matched 114 of the 120 Production files byte-for-byte and matched modes on all 120. All 34 Git-only paths were preserved. The six differences are the dashboard entry point, dashboard prop and map wiring, the train browser assertion and the two dependency files. Removing the two LinkBike edits from the dashboard reproduces the deployed dashboard. The lockfile differs from Production only by the direct `parse5@7.3.0` importer entry.

Station Operations, ERL, official alerts, departure-board behavior, bus and fleet APIs, classification archive and outbox code, and rail and train-position behavior retain the deployed source. The Production archive-disabled guard is intact. HEAD, index, status entries and changed/untracked file SHA-256 fingerprints matched their initial values in the original mixed checkout and the existing HCI worktree.

## File-level inventory relative to the restored Production source

| Path | Change |
| --- | --- |
| `app/page.tsx` | Evaluates the feature gate on the server and passes the result to the dashboard. |
| `components/dashboard.tsx` | Adds the optional prop and passes it to `TransitMap` outside demo mode. |
| `components/transit-map.tsx` | Adds the independent toggle, layer and control host. |
| `components/linkbike-layer.tsx` | Adds station markers, popup, manual zoom, and bounded polling while the overlay is active. Clears inventory on failed refresh. |
| `app/linkbike.css` | Styles the LinkBike controls, markers and popup. |
| `app/api/micromobility/linkbike/route.ts` | Exposes anonymous read-only GET when enabled. Returns 404 when disabled, and 503 for an unusable portal. Sends `Cache-Control: no-store`. |
| `lib/linkbike-feature.ts` | Shared server gate with explicit environment checks. |
| `lib/linkbike-data.ts` | LinkBike sources, response types and refresh default. |
| `lib/linkbike-parser.ts` | Portal HTML and consumer JSON validation, station ID/name matching, exclusions and coordinate quarantine. |
| `lib/linkbike.ts` | Server adapter, per-source caches, request coalescing, timeout, streamed body limit and failure handling. |
| `package.json`, `pnpm-lock.yaml` | Add the direct `parse5@7.3.0` dependency and importer while preserving the deployed dependency graph. |
| `tests/linkbike.test.ts` | Parser, data integrity, timeout, invalid upstream, coalescing, expiry and gate/API tests. |
| `e2e/linkbike.spec.ts` | Disabled API and UI, demo exclusion, enabled UI, map isolation, refresh failure and responsive coverage. |
| `e2e/train-positions.spec.ts` | Carries forward the reviewed grouping assertion. It verifies 12 estimates in six two-member icons after the fixture clock advances, with the refresh and polling assertions intact. |
| `docs/linkbike-experimental-integration.md`, `docs/linkbike-portal-integration-audit.md`, `docs/linkbike-regression-audit.md`, `docs/shared-micromobility-data-feasibility.md` | Historical audit and implementation evidence from the immutable candidate. |
| `docs/SM-1.6B-production-baseline-verification.md`, `docs/SM-1.6B-direct-linkbike-integration-report.md` | Current baseline verification, scope and validation. |

## Gate and data behavior

- Local Next.js development and Vercel Preview stay off unless `NEXT_PUBLIC_ENABLE_LINKBIKE_LAYER=true`. Preview still requires both Vercel environment identifiers to be `preview`.
- Vercel Production requires `NODE_ENV=production`, both Vercel identifiers equal to `production`, and the private server environment variable `LINKBIKE_ENABLE_PRODUCTION=true`. A missing or mismatched environment or missing or invalid opt-in fails closed. The dashboard gate is evaluated when the homepage is prerendered, so eventual enablement requires the same setting at build and runtime. The API checks it before touching either cache or upstream. The browser receives the evaluated boolean.
- With the gate enabled, any visitor can GET the inventory. The integration has no account, session, OIDC, grant, AWS or shared state dependency. The overlay starts off and stays absent in demo mode. The server route has no mutation handler.
- The Maintenance Portal supplies reported bicycle counts. The consumer JSON supplies coordinate candidates that must pass the existing validation. Station 16 stays quarantined. Consumer failure leaves coordinates unset. The API preserves original IDs, `UNVERIFIED` inventory, raw unverified portal timestamp and separate TransitScope retrieval time. Verified observation time, available docks and public station status remain null. The popup links to both sources and describes reported bicycles and unverified station candidates.
- The two sources use separate in-process caches with five-minute defaults, eight-second timeouts and a 512,000-byte body limit. Concurrent callers share pending work within an instance. A failed refresh replaces the expired inventory with an unavailable result and no stations. The API does not share cache across instances, so five minutes is a per-instance freshness bound and does not establish a fleet-wide upstream request limit.

## Local validation

| Check | Result |
| --- | --- |
| Frozen installation | Baseline and merged installs passed. The merged install added only the direct parser. |
| TypeScript, ESLint and optimized Production build | Passed. Local build used Node 24.22.1 and Next.js 15.5.28. The prior hosted deployment reported Node 26.x. |
| Full unit suite | Recovered baseline **331 passed** in 25 files. Merged candidate **354 passed** in 26 files, including 23 LinkBike cases. This includes Station Operations, official alerts and ERL fixtures, bus/fleet responses, trains and departure logic. |
| Full baseline Chromium suite | **96 passed, one failed**. The original train assertion expected 12 rendered icons when six grouped icons represent the 12 estimates. The same failure was documented before LinkBike. |
| Full merged Chromium suite, enabled locally | **104 passed, one flag-off skip**. All 97 transit cases and seven enabled LinkBike cases passed. |
| Full merged Chromium suite, disabled | First run **96 passed, two failed, seven skipped** while other browser jobs were running. The GPS previous-stops case timed out and the MRT station-first case did not see a station marker. The isolated full rerun **passed 98 with seven enabled-only skips**. No test or transit changes were made between runs. |
| Anonymous HTTP | Fixture-backed local GET returned 200 with `UNVERIFIED`, a validated coordinate candidate and null docks, observation time and public status. POST returned 405. The Production branch of the gate was also tested with synthetic process environment and fixture data in unit tests. |
| Disabled HTTP and UI | Optimized local build with simulated Vercel Production identifiers, the legacy public flag set, and the private flag unset returned 404 with `no-store`. No toggle or browser inventory request appeared. |
| Disabled candidate versus recovered baseline | Identical fixture comparison at **390, 768 and 1440px**. Checked the Bandar Tasik Selatan services, directional selection, panel bounds and ERL announcement source. Demo table counts, demo API data and invalid Bus Journey 400 responses matched. Neither emitted a LinkBike browser request. |
| Resilience | Fixtures covered malformed portal HTML, invalid consumer JSON and schema, bad coordinates, private/test exclusions, HTTP errors, timeout, response limits, separate source expiry, cache reuse and coalesced concurrent requests. |

[Baseline browser log](../../sm16b-baseline-browser.log) · [Enabled browser log](../../sm16b-browser-enabled.log) · [First disabled browser log](../../sm16b-browser-disabled.log) · [Disabled rerun log](../../sm16b-browser-disabled-rerun.log) · [Unit log](../../sm16b-unit.log) · [Build log](../../sm16b-build.log) · [Anonymous HTTP log](../../sm16b-http.log) · [Optimized disabled smoke](../../sm16b-built-smoke.log) · [Baseline comparison](../../sm16b-baseline-compare.log) · [Disabled candidate comparison](../../sm16b-candidate-compare.log)

## Separate Fleet API finding

The archived Production smoke predates this integration and captured the live fleet response as a 503 with the oversized-response message. In the verified source, `/api/transit` passes `Accept-Encoding` to `transitResponse`. The helper gzips when the request explicitly accepts gzip and otherwise sends plain JSON. It returns 503 once the selected body exceeds **4,000,000 bytes**, retaining the client's previous data on refresh failure. The archived message matches that branch. The captured response does not establish which encoding or fleet payload triggered it.

The existing fleet tests passed on both the recovered baseline and the merged candidate. They cover lossless compression, fallback JSON and deliberate 503 for oversized input. The fixture-backed fleet route test covers fleet-wide journey data and outage retention. The fleet route and response helper are byte-identical to the deployed source. Current live fleet health and payload size were not sampled in this local-only phase. [Fleet response implementation](../lib/transit-response.ts) · [Fleet response tests](../tests/transit-response.test.ts)

## Reuse and release gate

No permission for recurring automated retrieval and public redistribution of LinkBike inventory and coordinate data has been established. The public operator pages describe rider services and privacy. Record an applicable licence or written operator permission covering the Maintenance Portal and consumer data, allowed fields, attribution, retention and polling before public enablement. The local checks used fixtures for LinkBike. The reported counts have no verified observation time, availability semantics or confirmed public-station registry. [Portal reuse audit](linkbike-portal-integration-audit.md#terms-and-data-reuse) · [Operator privacy policy](https://www.linkbike.my/privacypolicy)

All changes are local and unstaged. No commit, push, Vercel settings or flag changes, deployment, or AWS access occurred. SM-1.6C awaits review.

