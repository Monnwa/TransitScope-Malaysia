# Timetable adherence coverage audit

Audit date: **8 November 2026, Asia/Kuala_Lumpur**. Runtime reviewed: commit `235f7cb67d631a17df86bfc23f70de93dc0fff5d`.

This is a **read-only diagnostic investigation**. No production algorithm, threshold, API, dependency, deployment configuration or data label was changed. Nothing was committed or deployed. The proposals below require approval before implementation, notwithstanding the standing authorization for ordinary releases.

## Findings and measurement scope

The last sampled server response contains **332 buses**, **251 uniquely matched current GTFS runs**, **3,801 GPS-passed stop occurrences**, **3,519 with an exact scheduled departure reference**, and **604 valid reported classifications**. Classification coverage is therefore **604 / 3,519 = 17.16%**. End-to-end availability across all reported GPS-passed stops is **604 / 3,801 = 15.89%**. Neither figure divides stop counts by vehicle counts.

The largest observable blocker is absent crossing history before the current continuity origin: **2,710 occurrences**, or **77.01% of eligible passed stops** and **92.97% of their 2,915 unavailable results**. This does not prove that these observations were erased by a restart. The response cannot distinguish never-collected history from history lost during a continuity reset, source omission, instance change or earlier failure.

An additional **282 passed occurrences lack an exact schedule**, all on Rapid KL Bus. They have time values, but their frequency-derived references are estimated. Another **192 eligible passed occurrences have no retained confirmed passage pair and insufficient telemetry for a narrower causal attribution**. They must not be retrospectively assigned to GPS gaps or outliers merely because those mechanisms exist.

Every one of the **604 eligible passed occurrences with a stored valid passage pair** has a classification. This sample does not show a classification-stage failure once the required evidence and exact schedule exist. Changing the ±120-second boundary would change labels, not supply missing evidence.

Seven production API snapshots and seven direct official GPS snapshots per operator were collected at approximately 31-second intervals, **16:30:49–16:33:59 MYT**. The primary response is dated **16:33:57.037 MYT**. Official static archives were downloaded during the same capture. The direct GPS sample contains **2,391 rows and 365 source-scoped vehicle identities**: KL 494/80, Feeder 851/130, Penang 1,046/155. Different cache/receipt times explain why the direct-replay final fleet is 330 and the production final fleet is 332; these are separate cohorts.

This is a short Sunday-afternoon convenience sample of three supported bus feeds, not a nationwide or peak-load study. The earlier 345/270/41 figures are historical observations, not the denominator for this audit. A short collection period also starts partway through many journeys.

## Coverage definition and funnel

A stop occurrence is uniquely identified by **source + vehicle + exact GTFS run/service date/start + stop ID + stop sequence**. Repeated visits on loops are distinct occurrences. Each final-snapshot occurrence is counted once; snapshot appearances are not added together to inflate coverage.

`P` is the set of stops reported `PASSED` by the existing GPS progress engine. `E` is the subset of `P` on the uniquely matched current vehicle run, with a finite departure timestamp and both run and stop classified `SCHEDULED`. `E` does **not** require an available passage pair: requiring that would artificially remove the principal failure cases. `C` is the subset with an EARLY, ON_TIME or DELAYED result.

`Classification coverage = |C| / |E| × 100%`.

| Funnel measure | Final server-response count |
| --- | ---: |
| All vehicle records received | 332 |
| Bus vehicle records received | 332 |
| Buses matched to a valid GTFS run | 251 |
| GPS-passed stop occurrences, P | 3,801 |
| P with a finite departure timestamp | 3,801 |
| P with an **exact scheduled** departure, E | 3,519 |
| P with sufficient stored GPS crossing-pair evidence | 653 |
| P with a successfully inferred and confirmed passage time | 653 |
| E with that evidence and passage time | 604 |
| Classified passed occurrences, C | 604 |
| Unavailable passed occurrences, P minus C | 3,197 |
| Unavailable eligible occurrences, E minus C | 2,915 |

The other 49 inferred passages are on estimated, non-exact schedule references; valid GPS does not make those references exact. There are zero explicit `DEPARTED` occurrences in this sample. That state is displayed as passed in some UI contexts but is not interchangeable with GPS `PASSED` for this calculation. Upcoming, unknown-progress and unprojectable stops are excluded from P and reported separately below.

**Clock-boundary qualification:** these primary counts describe the fields actually returned by the server. Rechecking against the response-wide `fetchedAt` clock identifies 18 PASSED rows just beyond the 120-second freshness boundary, including five classified rows. The client's freshness check withdraws their current claims. A unified-clock view that also withdraws their PASSED states has **599 / 3,501 = 17.11%** coverage. This small inter-stage timing difference is documented rather than concealed by rounding; the CSV retains millisecond-resolution ages. It is not permission to extend freshness limits.

## Exact unavailable distribution and attribution limits

Each unavailable P occurrence receives one primary diagnostic code. Priority is: invalid run → absent/inexact schedule → invalid/future measurement → stale current measurement → invalid stop projection/context → missing pre-origin history → an observed rejection, where available → unresolved passage absence. Optional details explain the gate. These codes are generated by the **offline adapter**, not added to production APIs.

| Primary reason | All unavailable P rows | Rows in E | % of E (3,519) | Observed scope |
| --- | ---: | ---: | ---: | --- |
| NO_GPS_HISTORY | 2,710 | 2,710 | 77.01% | Feeder 742; Penang 1,968; 90 source/route groups |
| GPS_GAP_TOO_LARGE | 0 directly attributable | 0 | 0.00% | Not separately observable in final production payload |
| GPS_STALE | 13 | 13 | 0.37% | Penang CAT; source-age boundary |
| INVALID_GPS_TIMESTAMP | 0 in P | 0 | 0.00% | Bad clocks occur upstream, outside this passed cohort |
| GPS_OUTLIER_REJECTED | 0 directly attributable | 0 | 0.00% | Rejected historical candidates are not exported |
| TRIP_MISMATCH | 0 in P | 0 | 0.00% | 81 unmatched buses are outside P |
| STOP_SEQUENCE_MISMATCH | 0 in P | 0 | 0.00% | Projection failures are largely outside P |
| NO_SCHEDULED_TIME | 282 | 0 | 0.00% | KL; 11 routes; excluded from E, 7.42% of P |
| PASSAGE_TIME_UNAVAILABLE | 192 | 192 | 5.46% | Feeder 61; Penang 131; 46 source/route groups |
| INSUFFICIENT_EVIDENCE | 0 separately attributable | 0 | 0.00% | Unresolved narrower causes remain in passage-unavailable |
| OTHER | 0 | 0 | 0.00% | No unmatched diagnostic categories |
| **Total unavailable** | **3,197** | **2,915** | **82.84%** | Mutually exclusive |

Zeros mean zero directly attributable rows **in this final passed cohort**, not proof that the mechanism is absent. For example, an invalid clock can prevent PASSED from being established, so it cannot then appear as an invalid-clock PASSED row. The non-exact schedule rows are excluded from E; their percentage of all P is provided to make that exclusion visible.

`NO_GPS_HISTORY` has a precise operational meaning here: no confirmed passage evidence is retained and the stop is behind `tracking.state.origin.distanceM`. The origin is the current continuity origin; it is **not necessarily the route start, first-ever observation or proof of historically good GPS quality**. Do not interpret all 2,710 rows as confirmed server-restart losses.

Representative anonymised rows:

| Reason | Operator / route | Vehicle pseudonym | Sequence | Interpretation |
| --- | --- | --- | ---: | --- |
| NO_GPS_HISTORY | Feeder / T818 | vehicle-6b13bb97e3297a | 1 | Stop precedes retained continuity origin |
| NO_GPS_HISTORY | Penang / 202 | vehicle-de4020b54203f4 | 1 | Same operational history absence |
| NO_SCHEDULED_TIME | KL / 772 | vehicle-45ce4e6810bc48 | 2 | Estimated reference, despite a finite time value |
| PASSAGE_TIME_UNAVAILABLE | Feeder / T352 | vehicle-cafd05f7b42d43 | 2 | No retained pair; narrower rejection not observable |
| GPS_STALE | Penang / CAT | vehicle-6e32002df2fe9d | 1 | Measurement age 120.037 seconds at response clock |

Complete affected operators/routes, counts and examples are in [reason breakdown](timetable-adherence-coverage-audit/unavailable-by-reason-operator-route.csv) and [examples](timetable-adherence-coverage-audit/unavailable-examples.csv).

## Operator, route, vehicle, trip and stop breakdown

“Operator” below distinguishes the three official operating feed categories; all are ingested under the Prasarana provider. Vehicles are counted once per source in the final snapshot.

| Operating feed | Buses | Matched runs | P | E | Classified | Unavailable P | Coverage C/E |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rapid KL Bus | 67 | 41 | 282 | 0 | 0 | 282 | N/A: no exact reference |
| MRT Feeder Bus | 116 | 102 | 1,001 | 1,001 | 198 | 803 | 19.78% |
| Rapid Penang | 149 | 108 | 2,518 | 2,518 | 406 | 2,112 | 16.12% |
| **Total** | **332** | **251** | **3,801** | **3,519** | **604** | **3,197** | **17.16%** |

Selected routes with substantial passed-stop denominators:

| Feed / route | P | E | Classified | Coverage |
| --- | ---: | ---: | ---: | ---: |
| Penang 101 | 445 | 445 | 53 | 11.91% |
| Penang 201 | 275 | 275 | 32 | 11.64% |
| Penang 302 | 222 | 222 | 30 | 13.51% |
| Penang 304 | 180 | 180 | 22 | 12.22% |
| Penang 202 | 159 | 159 | 33 | 20.75% |
| Penang 102 | 115 | 115 | 28 | 24.35% |
| Feeder T401 | 77 | 77 | 8 | 10.39% |
| KL 200 | 95 | 0 | 0 | N/A |

Full [operator](timetable-adherence-coverage-audit/coverage-by-operator.csv), [route](timetable-adherence-coverage-audit/coverage-by-route.csv), [vehicle](timetable-adherence-coverage-audit/coverage-by-vehicle.csv), [trip/run](timetable-adherence-coverage-audit/coverage-by-trip.csv) and [stop](timetable-adherence-coverage-audit/coverage-by-stop.csv) CSVs are provided. Operator/route/vehicle exports include vehicles with no passed stops. Trip rows require an identified run; unverified trips remain in the [vehicle pipeline](timetable-adherence-coverage-audit/vehicle-pipeline.csv). Stop rows aggregate the passed-stop cohort across vehicles and loop occurrences; the diagnostic CSV preserves individual sequences.

## GPS history, clocks and observation cadence

The inputs use `VehiclePosition.timestamp` for the measurement, `FeedHeader.timestamp` for publication, and `record.lastUpdatedAt` for server receipt of the retained record. Local capture receipt and API `fetchedAt` are recorded separately. The final sample has **zero measurement-time substitutions and zero journey/record timestamp disagreements**. The [GTFS-Realtime reference](https://gtfs.org/documentation/realtime/reference/#message-vehicleposition) defines the position timestamp independently of feed creation.

| Direct feed | GPS rows | Distinct vehicles | Observed positive gap median / p95 / max | Gaps >60 s / >120 s | Repeated timestamps | Median usable measurement age |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| KL | 494 | 80 | 30 / 60 / 121 s | 16 / 1 | 87 | 49.991 s |
| Feeder | 851 | 130 | 30 / 45 / 65 s | 4 / 0 | 59 | 41.704 s |
| Penang | 1,046 | 155 | 31 / 61 / 156 s | 39 / 1 | 159 | 44.995 s |

These are gaps between **captured observations**, not the native GPS-device sampling frequency. The 31-second collector can miss intervening upstream points. Repeated timestamps do not count as independent evidence; gap/repetition statistics exclude grossly future clocks. There were zero invalid coordinate rows, non-parsable measurement timestamps, out-of-order measurements, conflicting same-timestamp positions, duplicate per-feed vehicle IDs or observed descriptor changes. Feeder had **seven grossly future-clock rows from one vehicle**; Penang had two stale rows. The future-clock vehicle remains excluded from reliable tracking. All rows used `vehicle.id`; no coordinate-derived identifiers were needed. Two vehicle reappearance episodes followed an omitted snapshot: one KL, one Penang. This does not establish whether a physical bus ever changed identifier outside the sample.

For the final production response, median server-receipt minus measurement delays were **48.967 / 45.699 / 46.730 s** for KL/Feeder/Penang. Median latest-feed-publication minus measurement delays were **30 / 21 / 24 s**. Median API-publication minus receipt times of the retained observation were **0.070 / 30.338 / 62.307 s**. Repeated fixes retain their earlier receipt metadata, so this last measure is not pure request-processing latency. None of these clocks is used to replace a measurement time.

Code findings:

- `lib/vehicle-progress-history.ts`: raw fixes are capped at **eight and 120 seconds**; entries absent from one successful source snapshot are removed immediately. The ten-minute idle cap does not override that presence deletion. Invalid/future/stale inputs, identity changes and long gaps reset usable history. `interrupt(source)` clears a source after fetch failure.
- `lib/vehicle-progress.ts`: accepted continuity state and validated passage evidence are separate from the short raw buffer. The continuity origin can reset following rejected or lower-quality matching.
- `lib/processed-bus-journeys.ts`: processed results are also process-local, pruned on disappearance and bounded by ten-minute inactivity.
- `lib/bus-journey-store.ts`: browser-session retention covers unselected buses as well as selected ones, but it cannot recover observations that were never captured or supply a fleet-wide durable history to a new browser.

In fact, all 604 classified pairs were older than 120 seconds at the final response clock: median pair-end age **376.037 s**, maximum **778.037 s**. Their current vehicle evidence is checked separately. Continuity-origin age had median **341.037 s** and maximum **834.037 s**. Thus the short raw buffer **does not automatically erase already established passed-stop estimates after two minutes**. Freshness must still apply when forming a pair and when making current progress claims.

Across adjacent production snapshots, 16 same-run transitions had a token change or lost classification appearances; 48 classification appearances were withdrawn, and one transition changed token. These are not 48 unique permanently lost stops. Legitimate freshness/quality withdrawals and origin resets can explain such transitions. No runtime-instance identifier, restart log or durable history ledger was available, so this capture does **not** prove a fleet-wide restart or quantify a restart-attributable loss. Shared-client replay ended at the same 604 classifications as the server in this sample.

## GTFS completeness and matching

| Static archive | Routes | Trips | Stop-time rows | Frequency rows, non-exact / exact | Stop times ≥24:00 | Trips without stop times |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| KL | 139 | 2,121 | 88,827 | 2,118 / 0 | 931 | 3 |
| Feeder | 91 | 6,291 | 175,812 | 0 / 0 | 1,005 | 0 |
| Penang | 47 | 7,866 | 404,591 | 0 / 0 | 1,598 | 0 |

All three archives had zero missing/invalid departure or arrival fields in present stop-time rows, invalid stop coordinates, dangling trip/stop references, conflicting duplicate trip IDs/stop IDs/trip-sequence rows/shape-sequence rows, or invalid time/sequence patterns under the audit checks. There were no `timepoint=0` rows. This does not validate the real-world correctness of every coordinate or timetable. Three KL trips have no stop-time rows at all, which is different from a missing field in a present row.

The final production sample has **81 unmatched buses**: 57 reported trip IDs absent from the current static archive (KL 6, Feeder 10, Penang 41), 20 KL frequency starts outside the published frequency window, and four Feeder descriptor conflicts. These are vehicle-level blockers, not fictitious counts of passed stops. All received vehicles lack a reported direction; all Feeder/Penang vehicles also lack explicit service date/start. Existing uniquely inferred service-date handling permits supported exact-trip matches, but incomplete descriptors make an arbitrary route-only fallback unsafe.

Every one of the **3,801 returned passed-stop IDs/sequences and departure timestamps** matches the newly downloaded archive after the validated run-start shift. There were zero matched-run calendar, route or direction conflicts in this cross-check, zero passed-stop missing IDs/sequences, and zero departure mismatches. This supports schedule completeness for the measured cohort; it does not prove that an absent realtime trip is invalid rather than a versioning/source problem.

The 282 inexact references are from frequency-based KL runs. A numeric template time is not an exact run schedule. The [GTFS frequency specification](https://gtfs.org/documentation/schedule/reference/#frequenciestxt) differentiates headway service (`exact_times=0` or absent) from exact schedule slots. Do not turn an estimated start plus offsets into an exact punctuality reference merely to increase coverage.

The archives contain calendar rows and Feeder has three calendar exceptions; all trip service IDs have calendar/exception support. The measured current-run cohort contains zero cross-midnight runs, so live cross-midnight coverage cannot be claimed. Existing tests, including service-day times above 24:00 and calendar additions/removals, passed unchanged. The [GTFS stop-time reference](https://gtfs.org/documentation/schedule/reference/#stop_timestxt) documents service-day time semantics.

### Geometry blockers outside the passed denominator

Of **11,400 stop occurrences on matched journeys**, 10,450 have HIGH stop projections and **950 do not**. Low projections comprise 899 stop-sequence/order conflicts, 48 ambiguous branch/loop occurrences, and three published-distance-anchor conflicts. By feed: **KL 910, Feeder 17, Penang 23**. KL route 300 alone contributes 445 order-conflict occurrences; 771 contributes 57, 641 and 302 contribute 50 each. These are vehicle/stop occurrences, not 950 distinct physical stops.

The engine correctly withholds PASSED for unprojectable stops, so they are absent from E rather than masquerading as zero projection problems in the reason table. Their physically passed status cannot be established from this failed projection alone. A targeted stop-order/shape/direction/loop audit could improve progress coverage without loosening geometric tolerances. Most such blockers are on KL, where exact schedule availability remains a separate prerequisite. See [geometry blockers](timetable-adherence-coverage-audit/geometry-blockers.csv).

## Passage inference and controlled replay

The existing implementation matches the exact run and official shape, projects official stop coordinates in sequence, and requires consistent route direction/continuity. GPS-PASSED confirmation uses the existing **50 m buffer** behind the accepted progress of two observations. Passage inference then needs an unambiguous HIGH stop projection and two accepted measured positions that bracket that stop's cumulative shape distance, in the same vehicle/run/route/shape/service-date context.

Existing limits remain **0 < pair interval ≤60 s**, movement **≥40 m**, HIGH route offset **≤25 m**, HIGH reported accuracy **≤25 m when supplied**, and unchanged speed, future-time, freshness and clamping rejection. Missing reported GPS accuracy remains unspecified; all 2,391 direct rows omitted it. Route-distance and offset consistency are proxies, not measured device accuracy or proof that the bus actually stopped.

`passageTime = fromTimestamp + ((stopDistance − fromDistance) / (toDistance − fromDistance)) × interval`.

All **604 classified rows** independently reproduced the interpolated timestamp within 1 ms, retained valid pair limits, and reproduced their label with the existing inclusive ±120-second classifier. This proves arithmetic and rule consistency, **not actual passage-time accuracy**. No ground-truth arrival, departure or stop-passage records were available. Linear interpolation can be uncertain during traffic, stops and acceleration; no animation or timetable timestamp was substituted for GPS evidence.

A separate replay processed the seven direct-feed snapshots with the **unchanged production functions**. A wrapper logged calls and returned the original results without changing any input or limit. Warm history ended with **330 buses, 250 matched runs, P=3,765, E=3,483 and C=195: 5.60%**. Starting a fresh history/store on every snapshot ended with zero GPS-PASSED stops and zero classifications; its coverage is **N/A**, not 0%, because its denominator is zero. This establishes dependence on continuity for these inputs; it is not a forecast of persistent-storage uplift.

The warm replay's final eligible unavailable rows were: no pre-origin history 3,279; gap too large 1; rejected outlier/clamping 3; insufficient movement/quality 3; unresolved passage 2. The 282 inexact schedule references remained outside E. Logged bracket attempts across the replay included 337 accepted, 25 rejected for gaps, three stale, 14 insufficient evidence and four outlier/clamping rejections. Attempt counts include multiple stops/attempts and are **not** the final unavailable-stop distribution. Accepted intervals had median 31 s, p95/max 60 s. More detailed causes were observable offline but cannot be retroactively assigned to the production payload's unresolved 192 rows.

## Prioritised implementation proposal — approval required

| Priority | Proposed change | Expected coverage effect | False-classification risk | Complexity and cost |
| --- | --- | --- | --- | --- |
| 1 | Persist validated passage evidence and continuity state by exact run; retain a bounded measured-fix buffer; arrange dependable collection | Highest plausible leverage on the 2,710-history-absence pool; only future actually observed crossings can benefit. No defensible point estimate yet | Low if all identity, static-version, freshness and evidence checks remain; substantial if old data is promoted to current evidence | Medium/high: durable store, TTL, deduplication and collector operations; no paid map API |
| 2 | Resolve authoritative realtime/static trip/version and stop-shape-order discrepancies; seek exact KL schedules where officially available | Addresses 81 unmatched vehicles, 950 unprojectable occurrences and the separate 282 inexact-reference blockers. These are overlapping upstream pools, not additive predicted gains | Low with validated official mappings; high for fuzzy/fabricated trip or schedule replacements | Medium; upstream coordination/data review can dominate elapsed time |
| 3 | Improve measured-observation buffering and evaluate alternative valid brackets within existing limits | Likely narrower benefit; three insufficient-evidence rows in final warm replay, plus production's unresolved 192 needing attribution | Medium: using longer spans through dwell/traffic can bias interpolation. Preserve all current gates and validate intermediates | Medium implementation/testing, small local CPU/memory overhead |
| 4 | Record internal per-gate reason codes, continuity-reset causes and coverage counters | No direct increase; essential to distinguish the unresolved 192 cases and measure the other proposals | Low; must not alter classifications or expose identifiers in the passenger UI | Low/medium, bounded counters and anonymised samples |

**Recommended execution sequence:** implement the small diagnostic portion of priority 4 first, then deliver priority 1 with explicit replay acceptance gates; pursue priority 2 with the source evidence and defer interpolation changes until the missing causes are quantified. This sequence differs from the impact ranking because observability is needed to judge the highest-impact change safely.

For priority 1, a concrete design to approve is:

1. Use source + vehicle + validated trip/run date/start + direction/shape/static-version identity; deduplicate by the actual measurement timestamp. Keep publication and receipt clocks separate.
2. Save already validated crossing pairs, confirmation times and exact schedule references as they are produced. Store progression state separately from raw GPS. Historical pairs may remain historical after their raw 120-second processing window; stale measurements must never create new current claims.
3. Propose a 15–30 minute raw-observation TTL and a separately bounded run-evidence lifetime, subject to measured route durations and privacy/storage review. A longer stored buffer does **not** authorize inference across >60-second gaps or the use of stale pairs. Missing earlier observations cannot be manufactured.
4. Use one idempotent processing owner per source/run and preserve evidence across temporary feed omissions and restarts. Revalidate context and current GPS before displaying current progress/adherence; retain explicit historical-only states otherwise.
5. Decide how collection runs when no dashboard is open. Storage alone cannot collect missing history; the current architecture is request-driven. Adding a collector/store requires an explicitly reviewed infrastructure change and cost estimate, not an undocumented deployment tweak.

At a sustained 350 buses every 30 seconds, capacity planning is approximately **21,000 observation slots per 30-minute window** and **1,008,000 slots/day before deduplication**. This is arithmetic for sizing, not a daily traffic forecast or price quote. Actual storage/index/hosting costs must be measured for the chosen service. No paid external routing or map-matching API is proposed.

Acceptance gates: replay identical inputs with and without simulated interruptions; recover only previously validated same-context evidence; preserve stop states, exact references and existing labels; no invented crossings from a single fix, rejected jumps or stale clocks; unchanged ±120-second boundary tests; report fixed-cohort stop coverage and reason transitions, plus latency/storage volume. Ground-truth records would be needed before claiming improved actual classification accuracy.

## Artifacts, verification and limitations

- [Diagnostic samples](timetable-adherence-coverage-audit/diagnostic-samples.csv): 3,801 final production passed-stop rows, with one primary code and optional details.
- [Summary JSON](timetable-adherence-coverage-audit/summary.json): full funnels, seven-round trend, clocks, static checks, replay and consistency results.
- Five coverage CSVs, vehicle pipeline, geometry blockers, reason/operator/route breakdown, examples and history transitions are linked above or included in the same directory.
- Vehicle, trip/run and stop identifiers use audit-scoped keyed pseudonyms. Public route codes remain readable. Shared exports omit coordinates, plates, raw trip IDs and full per-vehicle GPS timestamps. Raw source archives, measurement data and the anonymisation key remain in the local audit artifact directory, outside the project deliverables.
- Reproduction scripts and raw captures: `C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-coverage-audit-2026-11-08/` (`capture.cjs`, `analyse.cjs`). The analysis allows only captured static files and makes no network requests.
- Official inputs: Malaysia Open API GTFS-Realtime and GTFS Static for `rapid-bus-kl`, `rapid-bus-mrtfeeder`, and `rapid-bus-penang`; production observations came from the existing `/api/transit?mode=live` endpoint. Source/output hashes are recorded in the accompanying audit manifest.
- **99 unchanged relevant unit tests passed** across adherence, progress/history, processed journeys, client retention and official GPS quality. Offline assertions verify unique denominators, reason totals, original pair limits, interpolation arithmetic and threshold boundaries. A build/browser suite was not rerun because runtime/UI code was not changed.
- Snapshot timing, changing fleet composition, missing pre-collection history, unavailable rejection telemetry and absence of runtime-instance logs limit causal attribution. The short sample cannot establish a daily coverage average, prove the cause of every missing bracket, estimate paid-service cost, or validate real-world timetable adherence accuracy.

**Release state: diagnostics and proposal only; no commit, no deployment, no production changes.**
