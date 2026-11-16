# Phase SM-1.3.1 — LinkBike regression and user experience audit

**TransitScope Malaysia · 12 November 2026 (MYT)**

**CONDITIONAL GO for a controlled, access-restricted Preview.** The experiment is suitable for review once the Preview environment and access restrictions are confirmed. Keep the flag scoped to Preview and retain the unverified wording. Public rollout requires operator authorization and evidence of station access, observation time and inventory semantics.

## Estimated-train marker failure

The original failure reproduced on the pre-LinkBike map with the flag off. At the start of the fixed browser fixture, the two MRT1 direction estimates were about **55.0 pixels apart** at zoom 13. After the fixture advanced by 65 seconds while the train layer was off, the fresh estimates were about **25.2 pixels apart**. The train layer deliberately groups positions less than **26 pixels** apart and anchors each group at a member’s original coordinate. The other five fixture lines followed the same pattern.

After re-enabling, the pre-change browser had **12 estimates and six Leaflet icons**. Each icon had `data-train-count="2"` and represented a different line. The train endpoint was called once after re-enabling. All lines and both directions were eligible, with no dashboard filter or line exclusion active at that step. The marker selector counted rendered icon elements without a visibility or viewport predicate. Waiting for asynchronous rendering could only leave the six intended groups at the same fixture time. LinkBike was absent from the pre-change map.

The expectation of 12 icons at the advanced clock was incorrect. The revised test checks a fresh request, the UI’s count of 12 estimates and exactly two members on each expected line. It still verifies the subsequent poll and the earlier 12 separate icons before convergence. Train grouping, polling, geometry and rendering code were left as they were. The finding requires a test correction only. [Train browser test](../e2e/train-positions.spec.ts) · [Train layer](../components/estimated-train-layer.tsx) · [Filtering and grouping](../lib/train-position-display.ts)

## LinkBike isolation and presentation

LinkBike uses an independent Leaflet group and a dedicated toggle, fetch loop and station popup. The original automatic fit moved the shared map to Penang whenever the overlay remounted. That could move bus and rail markers out of view and change how estimated trains group at the resulting zoom. The overlay now leaves the viewport where it is until the user selects **Zoom to LinkBike stations**. Browser testing also found that the LinkBike status card could intercept clicks on a popup’s close button. The status and zoom controls now sit above the map, outside the Leaflet canvas.

The station popup uses **Reported bicycles**, **Available docks** with **Not provided**, and **UNVERIFIED**. It presents **Retrieved by TransitScope** in MYT separately from **Portal timestamp (unverified)**. The popup and map control describe experimental station candidates. Passing location checks does not establish public access. The LinkBike display makes no live or real-time inventory claim. [Layer and station details](../components/linkbike-layer.tsx)

Browser coverage exercises the shared map with synthetic LinkBike, bus, train and rail station records. It checks that bus and rail filters and train visibility survive a LinkBike toggle, and that changing those controls preserves one LinkBike marker without duplicates. It also checks that closing a LinkBike popup preserves an open rail station detail panel. A simulated 503 clears LinkBike markers and a subsequent successful re-enable restores them. The LinkBike popup, fields and horizontal bounds are checked at 390px, 768px and 1440px. Isolation runs at 390px and 1440px. [LinkBike browser tests](../e2e/linkbike.spec.ts)

## API reliability and environment restrictions

| Check | Expected outcome verified by the tests |
| --- | --- |
| Feature disabled | HTTP 404 and no upstream request. The dashboard has no LinkBike toggle or fetch loop. |
| Enabled with usable portal data | HTTP 200 with `UNVERIFIED`, reported counts and separate source health. Upstream observation time and free-dock count stay null. |
| Portal timeout, HTTP failure or malformed/oversized HTML | The adapter returns `UNAVAILABLE` and drops prior inventory after the failed refresh. The route returns HTTP 503 with `no-store` and a sanitized response. |
| Consumer JSON failure | Portal counts remain `UNVERIFIED`. Normalized and source coordinates stay null, so no marker is produced. |
| Concurrent and cached reads | Per-source requests coalesce. Each source expires independently. The default five-minute cache preserves `fetched_at` on hits and replaces an expired inventory snapshot with an unavailable response if refresh fails. |

The flag now requires either local Next.js development without Vercel identifiers, or a build and runtime identified as Preview by both `VERCEL_ENV` and `VERCEL_TARGET_ENV`. A production-mode process without environment identifiers also fails closed. This addresses the case where Vercel system variables are unavailable. Keep the flag out of Production configuration. Hosted Vercel settings were outside this local check. [Feature gate](../lib/linkbike-data.ts) · [API route](../app/api/micromobility/linkbike/route.ts) · [API tests](../tests/linkbike.test.ts) · [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)

The enabled loopback API was checked against the public LinkBike sources at 20:55 MYT. It returned HTTP 200 with `no-store`, 27 unverified candidates, 26 with valid coordinate candidates and four excluded records. A second GET preserved `fetched_at`, and the observation timestamp was null. A separate local production build and browser run set both Vercel environment identifiers to `production` with the flag deliberately true. It returned HTTP 404 with `no-store`, showed zero LinkBike controls and made zero browser LinkBike requests.

## Test results

TypeScript and ESLint passed. The full unit suite passed **446 tests** in 33 files, including 20 LinkBike tests. The production-mode build passed.

The original train assertion failed in the isolated pre-LinkBike comparison. With only the corrected train assertion applied, that comparison passed **101 browser tests** and skipped three enabled-only LinkBike checks. It included all 100 existing transit tests and one flag-off LinkBike check.

The final integrated browser run passed **106 tests** with zero failures and one flag-off skip. All 100 existing transit checks passed, including bus, rail, train estimates, station details and dashboard behavior. All six enabled LinkBike checks passed. The separate flag-off run passed its one test. No new bus or rail regression was observed in the comparison.

## Remaining risks and Preview conditions

- Confirm the Preview is access-restricted, with the flag scoped to that environment and both Vercel Preview identifiers available. Leave the default refresh at five minutes.
- The portal remains an experimental, undocumented HTML source. A page or schema change can make inventory unavailable. Cache and request coalescing are per server instance.
- Reported counts have no verified observation time or rental semantics. Public access and coordinate ownership remain unverified. Station 16 stays quarantined, and the audit grants no data reuse rights. [Portal audit](linkbike-portal-integration-audit.md) · [Implementation reference](linkbike-experimental-integration.md)

No deployment, Vercel settings change, commit or push was made.
