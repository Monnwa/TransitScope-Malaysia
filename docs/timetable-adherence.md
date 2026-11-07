# GPS-inferred timetable adherence

## Timetable reference and classification

For each GPS-passed stop, compare an inferred route crossing with the **scheduled departure** for that exact stop ID and sequence on the selected vehicle run. Keep the original arrival and departure fields distinct. There is no fallback to arrival when departure is missing. A passing vehicle need not stop, so the result is never an actual arrival/departure or a confirmed delay.

The existing matcher resolves `trips.txt`, route/direction, service date/start, `calendar.txt` and `calendar_dates.txt` before adherence is eligible. Existing timezone and GTFS time conversion remain unchanged: Malaysia service-date midnight is UTC+08:00; times above 24:00 belong to that service date and may occur on the next civil date. The [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/#stop_timestxt) defines these time and service-date semantics. Estimated/interpolated (`timepoint=0`) times and non-exact frequency offsets are not exact timetable references and produce STATUS UNKNOWN.

`differenceSeconds = inferredPassageTime - scheduledDeparture`:

| Difference | Classification |
| --- | --- |
| Below −120 seconds | EARLY |
| −120 through +120 seconds, inclusive | ON TIME |
| Above +120 seconds | DELAYED |
| Insufficient GPS, trip or schedule evidence | STATUS UNKNOWN |

`ON_TIME_TOLERANCE_SECONDS` in `lib/timetable-adherence.ts` is the default; `BusJourneyOptions.adherenceToleranceSeconds` can override it for a caller. Seconds determine the classification; display differences use whole rounded absolute minutes with their sign. A value just outside the tolerance can consequently round to 2 displayed minutes while being EARLY/DELAYED.

## Original GPS evidence, separate from animation

The existing progress evaluator still establishes PASSED using consistent HIGH route evidence and a 50 m confirmation buffer behind the last two matched positions. No progress thresholds or schedule calculations are changed. It now records crossing candidates from consecutive valid, projected **source GPS observations**, before their bounded rolling history expires:

`ratio = (stopDistance - fromDistance) / (toDistance - fromDistance)`

`passageTime = fromTimestamp + ratio × (toTimestamp - fromTimestamp)`

Both per-observation projections must be unambiguous and meet existing HIGH geometric/accuracy criteria; the pair must establish existing HIGH movement evidence. The same source/vehicle/run/route/shape/service-date context is required. Stops must have HIGH projection confidence and lie inside the distance bracket. Candidates remain unclassified until the existing evaluator independently confirms PASSED. A stop already behind the first available observation has no crossing pair and stays unknown.

Additional conservative limits are `PASSAGE_LIMITS.maxIntervalMs = 60000` and reuse of the existing minimum movement of 40 m. Existing freshness (120 s), future timestamp (30 s), route offset (25 m for HIGH), direction, speed and accuracy rules still apply. Backward movement, including distances clamped only to stabilise visual progress, cannot supply a crossing pair. Missing coordinates, bad stop projections and invalid jumps do not supply one either. Missing GPS accuracy is explicitly left unspecified; it is not invented.

Evidence retains both measured timestamps, cumulative/raw route distances, route offsets, accuracy when supplied, identity, stop distance and a separate PASSED confirmation timestamp. The visual animation controller is neither imported nor queried by this calculation. It cannot create observations, passage times, PASSED states or adherence classifications.

## Stability, uncertainty and presentation

Each ID/sequence gets one estimate. A strictly shorter valid bracketing interval with no greater combined route offset may replace earlier evidence. Other same-run refreshes retain the established estimate. A schedule/tolerance, route/shape, run, vehicle or stop-projection change prevents inappropriate reuse. No classification is attached to upcoming stops in the UI.

Short serverless observation windows are reused, with crossing evidence retained on the existing progress history object; no new polling or storage service is introduced. The currently open client panel also retains established same-run/same-schedule results across temporary refresh failures. On stale/unavailable/low-confidence GPS, current adherence is STATUS UNKNOWN; any established classification is shown separately as **Last valid observations** with its original timestamp. It is not silently recomputed from stale samples. Closing/reloading into a cold serverless instance may lose historical crossing evidence; earlier stops then correctly become unknown.

The timeline shows passage time, scheduled departure reference, coloured EARLY/ON TIME/DELAYED text, rounded difference and GPS-INFERRED. Unknown rows explain missing evidence. A compact summary counts each currently PASSED ID/sequence once, including hidden previous stops, and excludes upcoming stops. Historical-only results are described separately. The disclosure states:

> Timetable adherence is estimated from GPS-observed vehicle movement across the stop location. It does not confirm actual stop arrival or departure.

## Modified files and validation

| Responsibility | Files |
| --- | --- |
| Validated crossing pairs and evidence quality | `lib/gps-passage.ts` |
| Progress history integration, route identity and confirmation | `lib/vehicle-progress.ts`, `lib/bus-progress.ts` |
| Classification, freshness and stable result retention | `lib/timetable-adherence.ts` |
| Journey output and optional tolerance | `lib/bus-journey.ts` |
| Timeline presentation and summary | `components/timetable-adherence.tsx`, `components/bus-journey-panel.tsx`, `app/bus-journey.css` |
| Deterministic synthetic data and tests | `tests/fixtures/adherence.ts`, `tests/timetable-adherence.test.ts`, `e2e/timetable-adherence.spec.ts` |

Unit tests cover tolerance boundaries, exact endpoints, multiple crossings, invalid intervals, stale/future/missing timestamps, backward/noisy progress, identity changes, route/stop ambiguity, missing departure/coordinates, distinct arrival/departure, after-midnight service, calendar exceptions, estimated timetables, stability, upcoming stops and absence of fabricated actual time fields. Browser tests cover four displayed states, summary, explanation, successful/failed GPS refresh, selected-stop retention, explicit stale history and both mobile/desktop layouts. The existing animation, rail, alerts, scheduled departures, navigation and map regression suites remain required.

Production verification must use real official vehicle observations, independently check the exact GTFS stop-time departure and service calendar, recompute crossing ratios and signed differences, and report the number of vehicles and reliable/unknown stops. Capture actual desktop/mobile views. If the sampled live fleet does not yield all classifications, report the missing categories and rely on the deterministic tests for those categories; never manufacture a production example.
