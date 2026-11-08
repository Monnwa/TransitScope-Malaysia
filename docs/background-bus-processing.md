# Automatic bus journey progress and timetable adherence

Review date: 8 November 2026 (Malaysia). The user approved this release after validation and authorized subsequent validated project releases without another approval request; see `docs/deployment.md`.

## Confirmed root cause

Official vehicle ingestion already decoded and validated GPS measurements and kept a source/vehicle-scoped, bounded raw observation history. It did **not** calculate each bus's matched journey, stop progress or timetable adherence.

The normal caller of `calculateBusJourney` was `/api/bus-journey`. `BusJourneyPanel` requested that endpoint when mounted after selection, then polled it while open. The endpoint also saved the calculated tracking state in `officialProgressHistory`. Accumulated passage evidence therefore depended on which buses had been selected. First selection could reconstruct crossings within the bounded raw history, but could not reconstruct older unobserved crossings. Some retained adherence results also lived only in the selected component.

Classification itself was already server-side. It was not performed in the marker click callback; the callback mounted the component that initiated the calculation request. “Status unavailable” was also a legitimate result when the existing evidence or exact timetable requirements were not met.

## Before and after

Before:

`official GPS → validation → raw observation history → dashboard positions → select bus → detail request → GTFS trip/shape/stop matching → passage evidence → adherence → selected component`

After:

`official GPS → validation → raw observation history → per-feed static timetable → every bus's existing journey/progress/adherence calculation → shared processed store → dashboard response → shared browser store → map and detail display`

Every successful dashboard refresh processes all three supported official bus feeds, independently of marker selection. Existing GTFS trip identity, shape matching, cumulative distances, stop progress, GPS crossing pairs and scheduled departure references remain the calculation inputs. The existing inclusive ±120-second thresholds are unchanged. Animation clocks are not calculation inputs.

The server store uses source/vehicle identity and caches unchanged observation/context/freshness combinations. Static timetable identity changes invalidate cached results. In-flight feed processing is shared; unrelated unchanged vehicles reuse their completed results. Active results are bounded by the current fleet and a ten-minute retention period. The existing raw history remains bounded by its original rules.

The dashboard owns one automatic refresh interval and one in-flight request, with cancellation and at most one queued interval refresh. Failed requests retain the previous payload. Per-feed failures retain the affected vehicles/results. Browser-session retention covers **all** processed buses, including buses whose panel has never been opened, and retains established evidence if a server instance loses its in-memory history. A new low-confidence or stale observation does not turn historical evidence into a new current classification.

The normal panel consumes the completed shared result. Opening, closing and switching panels do not start primary calculations or discard shared results. Future timetable/direction previews can still request supporting data. Those preview requests do not save primary tracking history. Default detail API reads also use the feed-owned result. Compatibility with older responses without a processed-journey field remains available through the detail endpoint.

Loading says “Calculating journey progress and updating transport information…”. Completed states distinguish ready results, no matching trip, and unavailable data. A completed ready journey can still contain “Status unavailable” for stops with insufficient evidence. A selected vehicle absent from a successful new fleet response has an explicit data-unavailable state, rather than an indefinite calculation spinner.

Fleet-wide results include complete stop and evidence data. Standard gzip HTTP compression is negotiated without dependencies or deployment configuration changes. A four-million-byte response budget fails explicitly instead of silently truncating vehicles. Browsers decode the payload normally; a real local HTTP browser regression verifies lossless decoding.

## Historical official-data replay

Inputs: the previously archived official Rapid KL, MRT Feeder and Rapid Penang static archives and six GPS snapshots per operator, collected on 7 November 2026 at approximately 23:15–23:18 MYT. The replay permits no network access and performs no UI selection.

Of 839 archived observation rows, four `(0,0)` rows are excluded before processing. The remaining 835 rows represent 147 different bus identities. These counts describe valid coordinate records, not a claim that every timestamp or trip is eligible. Invalid/future timestamps and unmatched or inexact timetable instances remain subject to the existing rules.

| Official source | Distinct buses processed | Observation rows | Distinct vehicle/run/stop classifications |
| --- | ---: | ---: | ---: |
| Rapid KL Bus | 33 | 189 | 0 |
| MRT Feeder Bus | 54 | 311 | 48 |
| Rapid Penang | 60 | 335 | 54 |
| Total | **147** | **835** | **102** |

There are 244 classification appearances across the six snapshots; these include repeated displays of an established crossing. The last snapshot has 132 buses and 97 classified vehicle/run/stops. Zero eligible classifications in the Rapid KL sample is retained honestly; the processor does not manufacture evidence or an exact schedule to increase coverage. The first snapshot produces zero classifications without prior crossing history, as required.

Replay processing alone took approximately 3–228 ms per operator/snapshot on this machine, including approximately 28/136/228 ms for initial KL/Feeder/Penang processing. This excludes archive retrieval/parsing, HTTP transfer and browser rendering; it is not a production latency guarantee.

Complete reconstructed fleet responses, including the record geometry used by production, compressed to approximately 1.30–1.32 MB for this sample using the initial level-1 setting. This archive replay is not a peak-load test; a larger actual-feed check is described below. This is functional coverage and source-integrity evidence, not ground-truth arrival-time accuracy validation.

Replay artifacts: `C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/background-bus-processing-2026-11-08/replay.cjs` and `archived-replay.json`.

## Regression coverage and release checks

New unit/integration regressions cover pre-selection multi-vehicle processing, real protobuf/static archive ingestion, default detail reads, duplicate refreshes, unchanged-vehicle reuse, changed observations, unavailable static data, unmatched trips, stale GPS, failure retention, source isolation, pruning, browser-session cold-start retention, run changes, transport compression and response size fallback. Existing ±120-second, cross-midnight, GPS quality, ETA independence, timetable adherence and railway tests remain in place.

Browser regressions wait for initial processing before any marker selection, then verify identical initial/reopened classifications for both vehicles, zero primary detail requests, immediate map tracking, automatic refresh, refresh failure retention, desktop/mobile navigation and no horizontal overflow. Synthetic test data is explicitly labelled. A separate test verifies actual compressed HTTP decoding in Chromium.

Final checks: **283/283 unit tests**, **97/97 Chromium browser tests**, standalone TypeScript, ESLint, and a clean optimized production build all passed. The final full browser command was `pnpm exec playwright test --workers=2 --timeout=60000`. An existing animation test takes approximately 27 seconds on this machine and exceeded its original 30-second limit during a six-worker run; assertions remain unchanged. OneDrive-generated `.next` cache reparse errors were resolved by removing only the verified generated cache before fresh runs. Deployment configuration was not changed.

All **97 browser tests also passed against the final production build** (`pnpm start`, two workers, 32 seconds), including the three new background/HTTP checks with final gzip level 6. Desktop/mobile screenshots show explicitly synthetic test fixtures, including passed-stop unknown, late and on-time rows. A separate local production API check fetched actual official feeds without mocks or selecting a vehicle: its first observation automatically processed 339 buses, matched 267 valid runs, and reported all four realtime feeds healthy. Initial classifications were correctly zero without prior crossing history.

Further real observations were processed with no detail selection: 348 and then 345 buses, with 273 and 270 matched runs. By 16:02:30 MYT, the third request had **41 valid GPS-inferred stop classifications**. All four feeds remained healthy. Fleet counts vary between snapshots. The same approximately 17.44 MB decoded response compressed to 3.24 MB at gzip level 6, versus 3.79 MB at level 1; the final transport uses level 6 (approximately 238 ms compression time in this one local measurement). These classifications are inferred passage-versus-schedule results, not verified actual arrival/departure records.

The verification record, actual-feed observation log and desktop/mobile screenshots are stored alongside the replay artifacts.

## Modified files

- `lib/processed-bus-journeys.ts`: shared server processing/cache and explicit result states.
- `lib/official-transit.ts`: automatic processing of every bus feed and shared detail reads.
- `lib/bus-journey-store.ts`: shared browser retention for selected and unselected buses.
- `lib/transit-response.ts`: complete fleet response compression and size fallback.
- `lib/transit-data.ts`: optional processed journey response contract.
- `app/api/transit/route.ts`: publish completed shared results without stale response caching.
- `app/api/bus-journey/route.ts`: consume primary results; preview requests no longer save tracking state.
- `components/dashboard.tsx`: shared store, request cancellation/coalescing, explicit loading and failure retention.
- `components/bus-journey-panel.tsx`: consume shared results, retain preview interactions and avoid disposed-effect requests.
- `components/transit-map.tsx`: consume the same processed selected journey before panel callbacks complete.
- `tests/processed-bus-journeys.test.ts`, `tests/background-bus-api.test.ts`, `tests/bus-journey-store.test.ts`, `tests/transit-response.test.ts`: unit/integration coverage.
- `e2e/background-bus-processing.spec.ts`: desktop/mobile and actual HTTP decoding regressions.
- `docs/background-bus-processing.md`: this report.

## Remaining limitations

- A single fix or a cold start with no reliable crossing history cannot establish actual passage time. Unknown results remain unknown. Earlier observations are not invented.
- Server state remains process-local; browser-session retention survives panel unmounts and server cold starts but is not a durable fleet database. With no dashboard/API requests, this architecture does not run an autonomous collector. No new scheduler or infrastructure is introduced.
- Static timetable loading can extend initial processing time; vehicles with unavailable supporting data remain visible with an explicit unavailable journey result.
- The retained compatibility/preview endpoint can obtain missing supporting data, but normal current-bus processing is independent of that endpoint being opened by the UI.
- No external map matcher, paid service, package dependency, railway tracking rule, repository, domain, Vercel project or deployment configuration is changed. The pre-existing `tsconfig.tsbuildinfo` remains outside the implementation change set.
