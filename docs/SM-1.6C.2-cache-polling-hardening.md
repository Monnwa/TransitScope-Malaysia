# SM-1.6C.2 — LinkBike cache and polling hardening

**GO for the local correction. Public Production release remains NO-GO** pending upstream reuse permission and separate approval of the exact release.

## Browser lifecycle

The overlay now schedules requests only while visible. Hiding clears the timer and lets an active request finish. Becoming visible schedules one immediate request if idle. If a request is active, its completion schedules the next regular refresh while visible. Repeated notifications for the same visibility state do not reschedule. The browser accepts server refresh values from 60 to 3,600 seconds and otherwise uses the five-minute default. Failed refreshes clear inventory and use the same scheduling rules.

Each effect owns one timer, one visibility listener, an in-flight guard and an abort controller. The deferred initial timer lets Strict Mode's setup/cleanup replay cancel the first schedule before a replacement effect starts. Disabling or unmounting clears the timer, removes the listener and aborts the browser fetch. Late completion checks the aborted signal before changing state. The simulated transport test deliberately delivered an old response after abort and after a newer result had rendered. The newer result stayed visible.

An active request that stalls in the browser holds the in-flight slot until it settles or cleanup aborts it. This phase adds no independent browser timeout. A browser abort does not guarantee cancellation of TransitScope or LinkBike processing already underway. [Request volume assessment](SM-1.6C.2-request-volume-assessment.md)

## Server cache audit

The server adapter and API route are byte-identical to SM-1.6C.1. The gate runs before the inventory loader. Each source has a separate expiration and pending promise. Completed successes and failures are cached for five minutes by default, with configured TTL bounded to 60–3,600 seconds. The eight-second upstream timeout and 512,000-byte streamed response cap remain in effect. Fixture tests cover coalescing, independent expiry, timeout, oversized responses and HTTP failure. A failed portal refresh replaces expired inventory with an empty unavailable result. A failed coordinate refresh leaves coordinates unset. The API retains `no-store` and the existing `UNVERIFIED` semantics. Cache and request coalescing are per process, with no global request limit. [Server adapter](../lib/linkbike.ts) · [API route](../app/api/micromobility/linkbike/route.ts)

## New local validation

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed on final source. |
| Focused LinkBike unit tests | 23 passed. |
| Full unit suite | 354 passed in 26 files. |
| Focused Chromium polling | 3 passed. Covered initially hidden, hide during slow fetch, visibility resumption without overlap, cancellation on toggle and demo navigation, ignored late response, failure clearing and bounded retry timing. |
| Full Chromium with Preview opt-in on | 107 passed, one expected disabled-only skip. |
| Full Chromium with Preview opt-in off | 98 passed, ten expected enabled-only skips. Across the two runs every Chromium case executed. |
| Optimized Production-mode build | Passed with both flags unset. |
| Same-build runtime gate matrix | All 16 cases passed on the new artifact. HTML, Chromium and anonymous API agreed. Disabled cases returned 404 with zero dashboard inventory GETs and zero upstream fetches. |
| Responsive disabled comparison | Matched the recovered baseline fixture evidence at 390px, 768px and 1440px. Covered Station Operations and the ERL source, settled demo results, demo API and invalid Bus Journey handling. |

The first focused run exposed two test-harness issues. The init script tried to read the document element before it existed, and the abort recorder counted a completed request because its test listener was still attached. The second run exposed a test assertion that used the title of a Leaflet marker reused by station ID. The final fixtures use a safe visibility default, remove completed-request instrumentation and use distinct marker IDs to observe each completed refresh. An initial TypeScript run also discovered a scratch baseline from the preceding phase. Its directory was moved under a dot-prefixed name inside ignored test output, and the application checks passed. No application changes were made to address these harness issues.

The enabled and disabled suites include existing bus journey, departure board, demo, rail and train-position tests. Station Operations, ERL, official alerts and fleet behavior are covered by existing fixtures and unchanged source. The archived oversized fleet-response 503 remains a separate pre-existing finding. Hosted fleet health and actual upstream LinkBike traffic were outside this local phase.

[Focused Chromium log](../test-results/sm16c2/focused-browser.log) · [Enabled Chromium log](../test-results/sm16c2/browser-enabled.log) · [Disabled Chromium log](../test-results/sm16c2/browser-disabled.log) · [Focused unit log](../test-results/sm16c2/gate.log) · [Full unit log](../test-results/sm16c2/unit.log) · [Build log](../test-results/sm16c2/build.log) · [Runtime matrix](../test-results/sm16c2/runtime-matrix.log) · [Responsive comparison](../test-results/sm16c2/comparison.log)

## Change scope

Only `components/linkbike-layer.tsx` and `e2e/linkbike.spec.ts` changed from the prior audited candidate, plus this phase's reports and inventory. The 120 Production upload paths and 34 Git-only paths were rechecked. The original mixed and HCI worktrees retain their prior fingerprints. No commit, push, Vercel change, AWS access, Production enablement or deployment occurred. [SHA-256 inventory](SM-1.6C.2-sha256-inventory.json)

