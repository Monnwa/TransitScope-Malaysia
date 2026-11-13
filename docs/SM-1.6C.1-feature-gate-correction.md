# SM-1.6C.1 — LinkBike feature gate lifecycle correction

## Root cause and correction

SM-1.6C reproduced a disabled homepage alongside an enabled API using the same optimized artifact. The homepage had no request-time dependency, so Next.js rendered it during the build and serialized the result of `linkBikeEnabled()`. The API already used `force-dynamic` and called the same function before reading inventory. Its result came from the running server's environment.

The homepage now waits for `connection()` and evaluates the shared gate on each request. It passes a boolean to the dashboard. The API still evaluates the gate before calling `getLinkBike()`. The checkbox and its existing controls host moved above the client-only Leaflet map into the server-rendered dashboard. This lets the actual HTML show the enabled control without trying to render Leaflet on the server. The homepage passes the initial demo mode from the request query so direct demo navigation omits the control in both HTML and Chromium. The overlay starts unchecked and the same map layer handles markers, polling and cleanup. [Next.js request-time rendering](https://nextjs.org/docs/app/api-reference/functions/connection)

## Configuration

| Name | Gate rule |
| --- | --- |
| `LINKBIKE_ENABLE_NON_PRODUCTION` | Exact `true` enables local development with Vercel metadata absent, or Preview with both identifiers exactly `preview`. Replaces the legacy public flag for local and Preview use. |
| `LINKBIKE_ENABLE_PRODUCTION` | Exact `true` enables only when `NODE_ENV=production` and both `VERCEL_ENV` and `VERCEL_TARGET_ENV` equal `production`. |
| `NEXT_PUBLIC_ENABLE_LINKBIKE_LAYER` | Legacy flag. The gate ignores it in every environment. |

Both server flags default off. The template records `false` for both. Empty or invalid Vercel identifiers cannot fall through to the local branch. The build received neither opt-in. The private Production flag was simulated only in the isolated loopback matrix. The public bundle receives the evaluated boolean and has no role in API authorization. [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables)

## Exact change scope

| File | Change |
| --- | --- |
| `app/page.tsx` | Request-time rendering, shared gate and initial demo state. |
| `lib/linkbike-feature.ts` | Server-only non-Production opt-in, explicit absent-metadata checks for local development. |
| `components/dashboard.tsx` | Renders the existing LinkBike control and owns its toggle and host state. Initializes demo from the request. |
| `components/transit-map.tsx` | Receives the toggle and host. Keeps the existing layer mount conditions. |
| `components/linkbike-layer.tsx` | Moves the existing stylesheet import to the dashboard so styles are available for the rendered control. |
| `.env.example` | Documents both disabled flag defaults. |
| `tests/linkbike.test.ts` | Updates opt-in cases and checks legacy-flag rejection and invalid metadata. |

The API route, data validation, station data, response schema, polling, caching, map stylesheet and dependency files matched the pre-correction inventory. The Production baseline's 120 paths remain accounted for, all 34 Git-only paths remain unchanged, and the six SM-1.6B differences remain present. The two other checkouts were preserved. [SHA-256 change inventory](SM-1.6C.1-sha256-inventory.json)

## New local validation

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed. |
| Focused LinkBike unit tests | 23 passed. |
| Full unit suite | 354 passed in 26 files. |
| Optimized build | Passed. Both homepage and API are dynamic. |
| Same-build matrix | 16/16 passed, including both transition directions, true Production conditions in a fixture process, and disabled or invalid conditions. |
| Full Chromium, Preview opt-in on | 104 passed, one expected skip. |
| Full Chromium, Preview opt-in off | 98 passed, seven expected skips. |
| Disabled candidate versus recovered Production fixtures | Matched at 390px, 768px and 1440px, including Station Operations, ERL source, two settled demo bike rows, demo API payload and invalid Bus Journey response. |

Frozen dependency installation was not repeated for the candidate because neither dependency file changed. The regression runs cover demo, departure boards, rail and train positions, bus journeys, and the LinkBike map at 390px, 768px and 1440px. Station Operations, ERL and fleet API behavior are covered by existing fixtures and source checks. The archived fleet oversized-response 503 remains a separate pre-existing issue. Current hosted fleet health was outside this phase.

[Runtime gate matrix](SM-1.6C.1-runtime-gate-matrix.md) · [TypeScript log](../test-results/sm16c1/types.log) · [ESLint log](../test-results/sm16c1/lint.log) · [Focused test log](../test-results/sm16c1/gate.log) · [Full unit log](../test-results/sm16c1/unit.log) · [Enabled Chromium log](../test-results/sm16c1/browser-enabled.log) · [Disabled Chromium log](../test-results/sm16c1/browser-disabled.log)

The first responsive comparison used the old snapshot, which sampled eight rows before the demo filter settled. Both sides were then rerun with the same harness waiting for the active filter and two rows. The fresh results matched. [Recovered baseline log](../test-results/sm16c1/comparison-baseline.log) · [Corrected candidate log](../test-results/sm16c1/comparison.log)

## Status

**GO for the local lifecycle correction. Public Production release remains NO-GO** pending upstream reuse permission, remaining release review and separate authorization of the exact deployment. The homepage now requires server rendering on each request. Hosted latency and Vercel settings were outside the loopback verification. Existing in-process cache and hidden-tab polling limitations remain documented. The candidate and evidence remain uncommitted in the isolated worktree. No hosted setting or Production flag changed. [Cache and polling risks](SM-1.6C-cache-and-polling-risk.md)

