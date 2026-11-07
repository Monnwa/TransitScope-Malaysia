# Bus GPS and ETA final engineering review

Review date: 8 November 2026, Asia/Kuala_Lumpur. Baseline: `1580a8c`. This reviews the uncommitted [GPS evaluation draft](gps-matching-evaluation.md). No external map-matching API, new dependency, Git commit/push, production deployment or deployment configuration change is included.

## Decision

All final engineering checks passed. The reviewed changes are ready for the user's commit/deployment approval. Approval is still required; this report does not authorize deployment. Estimated arrival accuracy has **not** been established against actual stop-arrival records.

## Review findings and fixes

| Finding | Resolution |
| --- | --- |
| An invalid future-dated fix could enter history and cause subsequent good observations to be rejected as older. Its invalid progress could also be saved back into the same cache. | Invalid/stale fixes no longer enter usable history. Saving progress requires the correct vehicle/session and the exact latest accepted measurement timestamp. A recovery test verifies that normal observations resume and rebuild their own ETA evidence. |
| ETA samples relied on an opaque progress key/session without a separate explicit vehicle/trip/direction scope. | Speed samples and estimates are additionally scoped to vehicle, GTFS trip, route, shape, service date, direction and session. This is independent metadata: the existing progress and stop-passage keys and calculations remain unchanged. Context changes clear ETA eligibility, including duplicate-timestamp updates. |
| Matching, progress and ETA could capture slightly different wall-clock times in one request. | One captured `now` is passed to the existing matching, progress, adherence and ETA functions. Original GPS measurement timestamps remain the movement evidence. |
| Malformed protobuf times could become an invalid Date; a bad publication clock could hide otherwise valid vehicle measurements. | Shared integer/range validation converts vehicle and publication times independently. Publication time is retained only as feed metadata, never as a replacement measurement clock. |
| A malformed timestamp in speed history could be silently removed before validating the remaining samples. | Invalid measurement times fail the speed model closed, before normal age-window trimming. |
| The fallback wording differed from the requested copy; location references without a measurement clock could appear unqualified on the map. | Exact fallback: **Arrival estimate unavailable**. The card explicitly says **Estimated arrival** and **Next stop**; original Scheduled stop clocks remain separate. Clockless/future-dated references are dimmed and labelled **Location time unavailable**; stale references use existing delayed-update wording. |
| The ordinary 15 s UI clock could briefly retain an estimate after a deadline between ticks. | One cancellable deadline timer withdraws the current selected bus's ETA exactly at expiry. It does not add a polling loop or network request. The browser test covers a deadline between normal ticks and unchanged stop classifications. |

## Preserved architecture and data distinctions

- Official GTFS-Realtime observations, presence-aware optional fields, trip/route matching, calendars, ordered stop matching, original GTFS geometry and cumulative distances remain authoritative. No road geometry replaces a GTFS shape.
- The existing GPS projection, direction, jump, stop-progress and timetable-adherence algorithms remain in place. ETA reads their accepted observations and next-stop result; it does not write PASSED / CURRENT / UPCOMING, passage evidence, adherence, delay, schedule clocks or vehicle coordinates.
- Raw measured coordinates remain `vehicle.position`; GTFS-matched coordinates remain `tracking.position`; modelled arrivals are separate `estimatedNextStop` values marked `ESTIMATED`; published clocks remain Scheduled/Estimated according to their existing timetable provenance. No modelled arrival is described as LIVE or actual.
- Railway geometry and estimated-train eligibility are unchanged. No Vercel, domain, repository remote, deployment or dependency configuration is modified.

## GPS and ETA validation

Coordinates must be finite and within latitude ±90 / longitude ±180; `(0,0)` is rejected. A vehicle's own validated measurement timestamp is mandatory for usable GPS progress. Missing clocks are not reconstructed from request or feed publication times. Existing 120 s progress age and 30 s future tolerance are retained; older packets cannot rewind newer observations. Invalid future clocks cannot poison later history.

Implausible movement is checked against the existing direction/continuity and 40 m/s jump guard. ETA uses at least three distinct accepted high-quality observations and two valid intervals, not a single GPS interval or unverified instantaneous speed. Required history: 30–120 s, intervals 15–60 s, movement at least 60 m, inferred median speed 1–25 m/s and sufficiently consistent segment speeds. Stationary, congested/inconsistent, reversed, clamped, off-route, ambiguous and gapped histories withhold ETA. Reported instantaneous speed is not silently converted between units or used as the ETA velocity.

The next stop must be a validated official stop projection, more than 25 m and at most 1 km ahead. The entire modelled range must be within 10 min; measurement age must be below 45 s. Expiry is the earliest of the measurement-age limit, history-window boundary and predicted arrival. Reaching a prediction deadline withdraws the estimate; it never declares arrival or departure. Changes of vehicle, trip, route, service date, direction, shape or history session prevent reuse of another context's speed.

## Regression evidence

An offline comparison ran the original libraries preserved at `1580a8c` and the reviewed libraries against the same **839 archived official observations**. No network request was used. After excluding four sentinel positions and six unreliable future-clock rows, **all 829 valid observation rows had identical core results**: vehicle/trip/route matching, selected departures, stop clocks/classifications, journey progress, matched positions/distances, passage evidence and timetable adherence. Only new ETA/speed/context metadata and opaque cache tokens were excluded from that core comparison.

| Source | Archived rows | Valid rows | Core results identical |
| --- | ---: | ---: | ---: |
| Rapid KL Bus | 189 | 189 | 189 |
| MRT Feeder Bus | 312 | 305 | 305 |
| Rapid Penang | 338 | 335 | 335 |

Tests explicitly cover invalid coordinates/ranges, missing/invalid/publication timestamps, out-of-order and conflicting duplicate observations, stale data, future-clock recovery, jumps and inferred speed limits, stopping/congestion, long gaps, insufficient history, vehicle/trip/route/direction changes, Malaysia cross-midnight service dates, future timetable previews, exact expiry, mobile layout and ETA independence from stop progression/adherence. Disabling either the speed model or ETA produces identical progress, stop classifications, schedules and adherence in the integration test. The existing 41 timetable-adherence unit tests remain part of the full suite.

Final verification passed: **268 / 268 unit tests**, **94 / 94 Chromium browser tests**, TypeScript, ESLint and optimized production build. Final command outcomes and artifact hashes are recorded in `gps-final-review-2026-11-08/verification.json`.

## Remaining limitations and approval boundary

- No ground-truth stop-arrival/departure records exist in this sample. There is no validated actual ETA error or accuracy percentage. The displayed range is a conservative model range, not a calibrated statistical confidence interval.
- GPS updates are sparse and may contain clock, identity or positioning faults. Signals, congestion, dwell and diversions can change future travel time; the estimate may disappear often under the strict eligibility rules.
- History is bounded and process-local. Serverless cold starts or instance changes reduce available observations; the safe outcome is unavailable ETA until enough new evidence exists.
- An official raw position can be retained as a reference when its time/progress is unavailable. It is not promoted to a verified current matched position or arrival prediction.
- The user must approve before any commit, push or deployment. The live website continues to run the previous deployed code.

## Files and reproducibility

Review refinements touch `lib/vehicle-observation.ts`, `lib/official-transit.ts`, `lib/vehicle-progress-history.ts`, `lib/vehicle-progress.ts`, `lib/bus-progress.ts`, `lib/bus-motion.ts`, `lib/bus-journey.ts`, `components/bus-journey-panel.tsx`, `components/transit-map.tsx`, and the associated unit/browser tests. The earlier local stylesheet and prediction draft remain uncommitted. The pre-existing generated `tsconfig.tsbuildinfo` change is not an implementation deliverable.

Artifacts: `C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/gps-final-review-2026-11-08/`. `compare.cjs` reads the earlier archived feed ZIPs/protobuf-derived records and preserved baseline libraries; `archived-core-regression.json` records the full comparison counts. The original external-service evaluation is not repeated or integrated.
