# Bus GPS and external map-matching evaluation

The subsequent [8 November final engineering review](bus-gps-final-review.md) records review fixes and the latest regression results. Counts and timings below describe the original evaluation/draft run, not a deployment.

Research date: 7 November 2026. Baseline commit: `1580a8c`. This report precedes implementation commits. No paid API, account, subscription, new deployment or external production dependency is authorized by this evaluation. Research requests use public official bus coordinates and measurement timestamps, without vehicle identifiers or passenger locations.

## Decision

Retain the existing official GTFS trip/shape progress algorithm. Do not integrate an external road service into production now. OSRM and Valhalla improve some road-to-shape residuals, but neither improves accepted route progress consistently in this small paired sample. Neither repairs missing trip identity, invalid service starts, clock errors or missing operational railway data. A free public demo is not a production SLA; self-hosting adds a graph service and maintenance alongside Vercel.

Prepare only local, uncommitted improvements for review: reject the observed `(0,0)` GPS sentinel, preserve measurement-time provenance, retain bounded accepted GPS history for robust historical speed, and expose a conservative estimated next-stop arrival separately from scheduled times. Retain existing direction, jump, stop-passage, adherence, animation and railway eligibility rules. Do not manufacture arrival/departure observations or substitute road geometry for GTFS geometry.

## Existing architecture and weaknesses

| Area | Existing behaviour | Weakness / action |
| --- | --- | --- |
| Official observations | Three Prasarana vehicle-position protobuf feeds; presence-aware optional fields; 30 s shared cache and in-flight reuse | Global coordinate bounds currently accept `(0,0)`; four such observations were captured. `reportedAt` can fall back to a feed-header timestamp, which is not a GPS measurement time. |
| Freshness | Measurement timestamp required for progress; 120 s maximum age, 30 s future tolerance; duplicates/out-of-order updates do not add evidence | Six future-dated feeder observations were rejected for progress. Freshness must also remain explicit in raw-location presentation; an available endpoint does not prove a fresh fix. |
| Trip matching | Exact trip/route/direction/service date/start, or a unique complete descriptor; no arbitrary nearest-route substitution | 317/839 observations cannot identify an active run. Route-only and pattern-only results must stay separate. An external road match cannot recover the missing service identity. |
| Shape matching | Validated trip-specific WGS84 shapes, cumulative geodesic distance, 60 m route corridor, 25 m high-quality residual; heading/motion/continuity filters | Residual is not measured GPS accuracy. Parallel branches and loops remain ambiguous. Generic car access can differ from bus lanes. No external geometry replacement is justified. |
| Stops | Official coordinates, ordered global projection, shape-distance anchors; missing intervening stop blocks a false next-stop bracket | Missing or ambiguous stops must retain scheduled-only information. One near-stop fix never proves arrival or departure. |
| Adherence | Two fresh high-quality observations crossing the same stop, then a later passed-stop confirmation; exact scheduled reference required | Crossing estimates are not actual boarding/dwell/departure timestamps. Serverless history is process-local, bounded to 120 s / eight fixes; cold starts and instance changes reduce evidence. |
| Animation | One selected-bus animator, timestamp/cumulative-distance interpolation, no extrapolation past the measured target; reduced motion supported | Display interpolation deliberately lags the newest point and must not be used for speed, stop passage or ETA evidence. |
| Speed / ETA | Reported instantaneous speed is used only for a heading guard. Existing stop clocks are scheduled or frequency-derived, with no GPS-derived next-stop ETA | Add a separately labelled, short-horizon estimate only from multiple accepted, timestamped, consistent measurements. Withhold it when stopped, noisy, stale, ambiguous, off-route or outside the supported horizon. |

Source: repository modules `official-transit`, `vehicle-observation`, `vehicle-progress-history`, `route-projection`, `vehicle-progress`, `bus-progress`, `bus-journey`, `gps-passage`, `timetable-adherence`, `route-animation`, and the bus journey/map components. Shared GTFS caches and calendars remain authoritative.

## Official sample and baseline

Six snapshots per source, approximately 31 s apart, captured **2026-11-07 15:15:36–15:18:11 UTC / 23:15:36–23:18:11 MYT**. This is a short late-evening convenience sample, not representative of rush-hour performance or all Malaysian roads. Archived protobufs and original static ZIPs allow offline replay through the actual production loader and journey algorithm. Snapshot duplicates are included in the full population counts; trace replay deduplicates measurement timestamps.

| Source | Observation rows / unique vehicles | Active run matched | High-evidence GPS progress | Raw GPS → own trip shape, p50 / p95 | Full journey CPU p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rapid KL Bus | 189 / 33 | 48 / 189 (25.4%) | 29 / 189 | 5.31 / 120.57 m | 0.154 / 0.764 ms |
| MRT Feeder Bus | 312 / 54 | 264 / 312 (84.6%) | 156 / 312 | 3.43 / 47.37 m | 0.867 / 2.597 ms |
| Rapid Penang | 338 / 61 | 210 / 338 (62.1%) | 138 / 338 | 3.96 / 14.07 m | 0.760 / 4.456 ms |

Raw residuals above use rows with an identifiable static trip shape (119 / 270 / 210 respectively), including invalid sentinels in the population. Their extreme maxima exceed 11,000 km for feeder/Penang `(0,0)` points; medians should not hide these faults. Unique timestamped observations: 164 / 290 / 322. Four sentinel rows and six unreliable future rows require quality rejection, not road snapping. No explicit `current_stop_sequence` or `stop_id` was present in this sample. Median measurement age: 32.1 / 26.4 / 27.3 s.

The population has 240 missing-static-trip rows, 71 KL starts outside the published frequency window and six conflicting descriptors. Keep those failures visible rather than choosing an attractive nearby route. The [official feed documentation](https://developer.data.gov.my/realtime-api/gtfs-realtime) acknowledges occasional erroneous GPS locations and Penang legacy trip/route identifiers; observations are licensed CC BY 4.0 and feeds update every 30 s.

## Paired external benchmark

Eighteen traces, six per source: four moving, different-route exact-run traces; one difficult exact-run trace; one unresolved-run trace. Each contains 4–6 distinct measurements. Fifteen traces / 84 points have an eligible official trip/run reference; three unresolved-run traces demonstrate road coverage only and are excluded from route-progress accuracy denominators. All 100 input points are real observations; one impossible `(0,0)` point is withheld by common preflight checks. No synthetic positions are sent to services.

OSRM uses the public `match/v1/driving` demo; Valhalla uses `trace_attributes`, `map_snap`, bus costing and measurement timestamps. Both use an **assumed** 20 m search uncertainty, not a claim of supplied GPS accuracy; Valhalla search radius is 60 m. Source timestamps are preserved. Requests are sequential, at least 1.25 s apart, identified by research headers; 18 requests/service including one reused pilot. Public demo network timing is not self-hosted CPU timing. Outputs are replayed through the same GTFS projection/direction/continuity engine; no road path becomes the bus route.

| Source | Raw GPS → GTFS p50 / p95 | OSRM road point → GTFS p50 / p95 | Valhalla road point → GTFS p50 / p95 | OSRM request p50 / p95 | Valhalla request p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rapid KL | 6.71 / 25.57 m | 1.92 / 8.58 m | 1.97 / 13.23 m | 265 / 614 ms | 871 / 961 ms |
| MRT Feeder | 2.44 / 48.06 m | 4.39 / 7.47 m | 3.94 / 6.22 m | 194 / 245 ms | 405 / 558 ms |
| Penang | 5.80 / 14.78 m | 3.78 / 11.98 m | 3.87 / 13.71 m | 230 / 318 ms | 486 / 595 ms |

Residuals compare plausible returned inputs with the official shape before final GTFS projection. Feeder's rejected sentinel is excluded from that row, and Valhalla additionally leaves a 280 m off-shape observation unmatched. Returned-point denominators differ; this table is not a claim of geographic ground truth. Final coordinates projected onto GTFS have approximately zero residual **by construction**, which is not proof of correct-road accuracy.

| Metric, eligible 84-point cohort | Existing GTFS engine | OSRM + same GTFS engine | Valhalla + same GTFS engine |
| --- | ---: | ---: | ---: |
| Accepted matched progress (high or approximate) | 78 / 84 (92.9%) | 75 / 84 (89.3%) | 77 / 84 (91.7%) |
| High-evidence matched progress | 59 / 84 | 58 / 84 | 60 / 84 |
| Returned plausible points within 60 m of GTFS and shifted ≤60 m | 80 / 84 | 80 / 84 | 80 / 84 |
| GTFS-incompatible returned points | 3 / 83 | 3 / 83 | 2 / 82 |
| Observed extreme-jump candidate rejected | 1 / 1 | 1 / 1 | 1 / 1 |
| Independently verified incorrect-route rate | **Not measurable** | **Not measurable** | **Not measurable** |

All 18 road-service requests succeeded for each service, but that only establishes selected-road coverage. The single jump is the sentinel outlier and is rejected by the shared preflight/GTFS guards; it does not measure an independent external jump detector. No driven-route ground truth, doors-open logs or actual stop timestamps are available. GTFS inconsistency is a proxy, not an incorrect-route label. This sample cannot establish an ETA error, national coverage rate or statistical superiority. Default search parameters and OSRM car versus Valhalla bus profiles also limit cross-provider comparisons.

## Service comparison and costs

Costs below are USD per 1,000 requests, checked on the research date; hosting, taxes, map display charges and negotiated contracts are separate. No paid request was made. A 100-bus, 12-hour/day, 30-day deployment polling each bus every 30 s would make 4.32 million requests/month before caching, so free allowances cannot be treated as unlimited production capacity.

| Service | Malaysia / trace and noise support | Request limits | Cost and free limits | Licensing, retention and integration |
| --- | --- | --- | --- | --- |
| OSRM | OSM road graph; selected KL/feeder/Penang traces returned matches. Ordered observations, timestamps, uncertainty radii, split traces and null outliers. Generic demo driving profile is not bus-lane-aware proof. | Self-host configuration controls capacity; backend default 100 matching points. Demo: reasonable non-commercial use, maximum 1 request/s, no SLA. | $0 software/API licence fee; self-host compute/storage/updates cost extra. Demo research cost $0. | BSD-2-Clause engine; OSM attribution/database obligations separate. Own hosted trace retention can be controlled. Demo links to its privacy policy; a specific log-retention period was not verified. No passenger locations/IDs sent. Medium/high operational integration: regional graph, updates, service health and GTFS validation. |
| Valhalla | OSM full-planet demo; selected Malaysian traces matched. Bus costing, timestamped multi-point `map_snap`, gaps, search radius and matched/unmatched points. Sparse 30 s source sampling is below the documentation's preferred 1–10 s density. | Host `service_limits` and fair use govern request/trace limits; not a universal paid quota. Benchmark uses only 4–6 points/request. | $0 software/API licence fee; hosting/graph maintenance extra. Demo research cost $0. | MIT engine; OSM data obligations separate. Self-host controls retention; public-demo logs unverified. Most flexible optional future road experiment, but adds an independent native graph service. |
| Mapbox Map Matching | Global road/path service; Malaysian accuracy **not benchmarked**. Ordered 2–100 points, timestamps, radii and ambiguity/split information. No Prasarana rail claim. | 300 requests/minute; 100 regular points/request. | 100,000 monthly requests free, then $2.00/1,000 in the first paid tier; higher-volume published tiers $1.60/$1.20. Not used. | Documentation requires results on a Mapbox map using its libraries/SDKs: incompatible with a drop-in Leaflet/OSM overlay under those standard conditions. Service terms govern derived-response storage; no unrestricted retention assumed. Account/key/billing and map-stack/licensing changes add complexity. |
| HERE Route Matching | Road matching accounts for GPS inaccuracies and gaps; car/bus road coverage must be verified for this deployment. Malaysian route-matching accuracy **not benchmarked**. Supports multi-point trace formats and timestamps. | Limited Plan: 1,000 requests/day, route matching 1 RPS. No strict waypoint cap in the guide; roughly 50 s processing timeout. | **Applicable price not verified: obtain a use-case-specific quote.** Do not reuse historic free-tier figures. | Current Limited/Base plan exclusions include asset locating/tracking/map display/analytics. TransitScope's tracking use requires eligibility/licence confirmation. Account/API key, permitted retention and display rights must be settled before any integration; no trial request made. |
| Google Roads / Snap to Roads | Malaysia driving/snap coverage listed; accuracy **not benchmarked**. Ordered paths up to 100 points; recommended consecutive gaps <300 m. Snap request parameters do not include measurement timestamps. Road reconstruction is not a live vehicle source. | 30,000 requests/minute across Roads API, subject to account quotas; 100 points/request. | Roads–Route Traveled: 5,000 monthly events free, then $10/1,000 first paid tier; billing/key required. Not used. | Roads results prohibited on non-Google maps; storage/caching/derived-content restrictions and possible asset-tracking licensing. Incompatible with a direct Leaflet/OSM display. Google Routes may be considered separately for passenger planning, never as a vehicle observation or railway tracker. |

Coverage is source- and graph-dependent. No road service in this comparison is validated as a Prasarana railway matcher. API response latency, provider confidence scores, and a small geometric residual are not interchangeable measures of actual accuracy.

Primary documentation:

- [OSRM matching API](https://project-osrm.org/docs/v26.4.0/http), [backend request limits](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/tools.md), [demo information](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server), [engine licence](https://github.com/Project-OSRM/osrm-backend/blob/master/LICENSE.TXT).
- [Valhalla matching reference](https://valhalla.github.io/valhalla/api/map-matching/api-reference/), [public demo/licence](https://github.com/valhalla/valhalla#demo-server), [OSM attribution](https://www.openstreetmap.org/copyright).
- [Mapbox matching limits and map display requirement](https://docs.mapbox.com/api/navigation/map-matching/), [current pricing](https://www.mapbox.com/pricing), [service terms](https://www.mapbox.com/legal/service-terms).
- [HERE matching](https://docs.here.com/routing/docs/match-traces-to-routes), [plan limits and excluded tracking use cases](https://www.here.com/get-started/pricing/rps-limits-excluded-use-cases), [coverage](https://docs.here.com/coverage/docs/here-coverage-information).
- [Google Roads snapping](https://developers.google.com/maps/documentation/roads/snap), [quotas](https://developers.google.com/maps/documentation/roads/usage-and-billing), [prices](https://developers.google.com/maps/billing-and-pricing/pricing), [map/storage policies](https://developers.google.com/maps/documentation/roads/policies), [Malaysia coverage](https://developers.google.com/maps/coverage).

## Railway investigation

The [official API documentation](https://developer.data.gov.my/realtime-api/gtfs-realtime) still explicitly says `rapid-rail-kl` does not have stable realtime feeds; the published Prasarana vehicle categories are the three bus feeds. KTMB's separate train feed does not identify Prasarana MRT/LRT vehicles. TripUpdates/alerts described as a roadmap are not an available prediction feed.

[MRT Corp directs operations/schedule queries to Rapid Rail](https://www.mymrt.com.my/projects/travel-with-mrt/). The operator's [PULSE announcement](https://myrapid.com.my/wp-content/uploads/2021/07/SIARAN-MEDIA-APLIKASI-PULSE-DIPERLUAS-KE-RAPID-PENANG-DAN-RAPID-KUANTAN.pdf) advertises passenger bus/train ETA, but no documented, licensed public operational API with per-train positions or exact departure identifiers was found in the checked sources. An app feature is not permission to scrape private endpoints, nor evidence of a per-train GPS feed. Public line status, first/last-train schedules and frequency notices are useful passenger information but do not establish individual train phases.

Keep the existing official railway geometry and train-position eligibility engine. The earlier current-feed audit found all six requested lines approximate-frequency-only; Kelana Jaya also has a Putra Heights stop/shape mismatch. No additional source meeting those eligibility requirements was verified. No road map matcher is used for trains; no additional train markers are justified by this research.

## Local improvement and regression status

The comparison above was presented before preparing the following **uncommitted local draft**. No implementation commit, push, production deployment, new dependency or provider configuration was made. The existing GitHub repository, Vercel project and domain remain unchanged.

| Files | Draft change |
| --- | --- |
| `lib/vehicle-observation.ts`, `lib/official-transit.ts`, `lib/vehicle-progress-history.ts` | Reject the four observed `(0,0)` missing-fix sentinels; do not substitute a new coordinate. Use the vehicle's own validated measurement timestamp for `reportedAt`; keep feed publication time separately in feed health. An invalid/missing measurement clock cannot become a fresh GPS observation via header fallback. |
| `lib/vehicle-progress.ts`, new `lib/bus-motion.ts` | Keep existing projection, heading, continuity, stop passage and confidence decisions. Retain at most eight accepted speed samples for 120 s, within the existing history/context. Compute robust historical speed from measured route distance and timestamps, never animation or an assumed instantaneous speed unit conversion. Invalid matches, clamps, poor quality and context changes clear speed eligibility. |
| `lib/bus-journey.ts` | Add `estimatedNextStop` separately. Raw measured GPS remains `vehicle.position`; GTFS-shape-matched position remains `tracking.position`; scheduled clocks remain `stops[].arrival/departure`. No external road point enters those fields. |
| `components/bus-journey-panel.tsx`, `app/bus-journey.css` | Show a passenger-facing Estimated next-stop range, or an unavailable state, without replacing scheduled stop clocks. Client ageing uses the original measurement time and existing shared 15 s clock. No extra request loop or map animation is added. |
| New `tests/bus-motion.test.ts`, `tests/official-gps-quality.test.ts`, `e2e/bus-motion.spec.ts` | Cover provenance/sentinel handling, historical speed, three-observation minimum, noise/clamps, context reset, expiry, planned-versus-estimated separation, previews, stop coordinate failure and desktop/mobile navigation. |

Prediction eligibility requires at least three distinct accepted high-quality measurements, at least 30 s of history and 60 m movement. Observation intervals must be 15–60 s; speed must be 1–25 m/s, with robust dispersion and individual segment speeds within 50% of the median. Clamped distances are not speed evidence. Next-stop coordinates must be an unambiguous official GTFS projection; distance must be greater than 25 m and at most 1 km, the whole modelled range at most 10 min, and measurement age strictly less than 45 s. The estimate expires at that age limit, the history-window boundary or its predicted arrival, whichever comes first. It never changes a stop into Arrived/Departed. A service outage, preview, missing bracket, future clock or invalid motion descriptor withdraws the estimate.

The displayed range uses at least ±25% speed variation or greater observed dispersion. It is a modelling range, **not a calibrated statistical confidence interval or an official arrival prediction**. Traffic lights, dwell, diversions, sparse updates and process-local history remain material limitations. The original 120 s location-progress freshness limit is retained; the new prediction has the stricter 45 s limit.

Offline draft replay through all 839 archived rows preserves **every original trip-match and progress-source count** shown above: 522 active-run matches and 323 high-evidence GPS progress rows. All four sentinel fixes are rejected as measurements. Historical speed is available on 134 rows; conservative next-stop predictions on only 59 rows (KL 6, feeder 24, Penang 29). These are replay observation counts, not distinct buses or a promised live availability rate. Processing remains comparable: draft full-journey CPU p50/p95 is 0.161/0.732 ms, 0.872/2.598 ms and 0.749/4.418 ms respectively; one run on a local machine is not a performance guarantee.

A temporal holdout diagnostic predicts the next accepted measurement's route distance 30–60 s ahead, using only earlier measurements. The same paired subset compares historical speed against interpreting the supplied instantaneous speed as GTFS m/s:

| Source | Paired holdouts | Historical-distance error p50 / p95 | As-reported instantaneous-speed error p50 / p95 |
| --- | ---: | ---: | ---: |
| KL | 5 | 87.3 / 93.8 m | 726.8 / 992.0 m |
| Feeder | 31 | 47.7 / 360.4 m | 557.7 / 896.9 m |
| Penang | 25 | 66.2 / 280.9 m | 418.7 / 1169.0 m |

The full historical holdout cohort has 86 pairs; the table uses the 61 pairs whose reported instantaneous speed is finite and within 0–40 m/s. Supplied speed frequently differs substantially from distance/time speed, with median ratios around 3–4 in those broader cohorts. This suggests a unit/measurement-quality issue requiring provider confirmation; **no automatic km/h conversion was implemented**. Production previously did not derive ETA from instantaneous speed, so this diagnostic does not establish an improvement over a previous production ETA model. Nor is next-measurement distance error an actual-stop-arrival error. More labelled daytime observations and actual stop timestamps are needed for calibration before describing the estimates as validated arrival accuracy.

Regression on the uncommitted draft:

- **243 / 243 unit tests passed**, including 22 new tests.
- **92 / 92 Chromium browser tests passed**, including eight new scenarios.
- TypeScript, ESLint and optimized production build passed.
- Existing bus tracking/animation/adherence, station boards, railway layers and estimated-train eligibility regressions passed. Railway code and configuration were not modified.

## Reproduction and evidence

Artifacts are stored under `C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/gps-benchmark-2026-11-07/`: original three static ZIPs; 18 protobuf/JSON snapshots; `baseline.json`; `selected-traces.json`; 36 cached service responses; `external-benchmark.json`; `draft-replay.json`; and collection/analysis/benchmark scripts. `baseline-lib/` preserves the exact pre-draft library sources; `replay-baseline.cjs` reproduces the original matching/source counts without network access even while the working tree contains the draft. `draft-replay.cjs` evaluates the current working tree against the same archived observations. Collection is a separate deliberate action; cached service replay does not require further requests. Identifiable public vehicle records remain local to the artifacts; external requests omit vehicle identifiers. OSM-derived results are credited to OpenStreetMap contributors / OSRM / Valhalla. The official observations retain their source attribution and CC BY 4.0 provenance.
