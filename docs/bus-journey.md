# Bus vehicle journey timeline

GPS-based progress is now documented in [gps-progress.md](gps-progress.md). Its conservative inference and uncertainty labels extend the initial progress behavior described below.

## Scope and interaction

Selecting an official bus vehicle opens one journey panel in the existing desktop detail column, or a fixed bottom sheet on mobile. It shows the route code/name, actual trip origin/headsign, direction, operator, selected vehicle reference, a horizontal exact-departure selector, published frequency periods and the ordered stop timeline. Mobile has expanded/collapsed states; the header remains visible while the body scrolls. Previous stops are hidden only when verified progress supports their completion. Closing removes the vehicle highlight and selected route overlay. The existing accessible table is an alternative to clicking overlapping vehicle markers.

Selecting a scheduled departure loads that trip's actual stop pattern and geometry. It is explicitly a timetable preview; the clicked vehicle's progress and delay are never copied to a different departure. Selected scheduled runs remain selected after their start time, with their date retained. Stale responses are aborted/ignored when changing vehicle, direction or departure. Refresh failures retain the last successful response. A selected vehicle is brought into view when chosen; markers remain above polylines.

## Official data and matching

Sources are the existing Malaysia Open API [GTFS Static](https://developer.data.gov.my/realtime-api/gtfs-static) and [GTFS-Realtime VehiclePosition](https://developer.data.gov.my/realtime-api/gtfs-realtime) endpoints for:

- `rapid-bus-kl`: Rapid KL / Prasarana, including published bus/BRT routes.
- `rapid-bus-mrtfeeder`: MRT feeder buses / Prasarana.
- `rapid-bus-penang`: Rapid Penang / Prasarana.

Matching and classification follow the [GTFS Realtime reference](https://gtfs.org/documentation/realtime/reference/#message-tripdescriptor) and [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/). No Google/Apple geometry or proprietary assets are extracted.

1. Prefer exact trip_id. Validate route, any reported direction, service calendar and trip relationship. Some feeds use public route codes where static trips use internal route IDs. Such aliases are accepted only when routes.txt supplies a unique matching short/long name; conflicting/ambiguous aliases are rejected.
2. Without a valid trip ID, require the full route/direction/start_date/start_time descriptor to resolve uniquely to an active trip. Same-route proximity or an arbitrary first trip is never enough.
3. A known trip with an unresolved run can still expose its actual stop pattern, with times withheld. Unknown trips remain route-level only. Users may explicitly select a timetable direction and a published departure; this never becomes a verified vehicle match.
4. Scheduled trips without start_date may use the unique calendar-valid service instance around the actual vehicle measurement time (first departure minus two hours through terminal time plus four hours). Overlapping candidate service dates remain unresolved. These bounds only disambiguate service dates; they are never arrival/delay predictions. Explicit invalid dates and inactive calendars are rejected. Previous service dates and GTFS times above 24:00 are supported.

All stop ordering comes from stop_sequence, including nonconsecutive sequences and repeated stop IDs on loops. Names come from stops.txt. Terminal/drop-off-only and untimed records remain in the complete sequence. Duplicate identical rows are collapsed; conflicting sequences, impossible chronology and malformed times do not become invented stop times. The selected trip's shapes.txt geometry is used when available; missing geometry is explicit.

## Time classes and departure options

- **SCHEDULED:** official arrival_time/departure_time for a dated scheduled trip, or exact_times=1 frequency slots.
- **ESTIMATED:** for a matched exact_times=0 vehicle run with a valid reported start_time/start_date inside its published frequency window, stop timing is `service-day midnight + reported start + (stop template time − first template departure)`. This is a reported trip-start/template-offset estimate, not a live arrival prediction. Explicit interpolated timepoint=0 records also remain estimated.
- Missing/invalid frequency anchors or reported starts outside the published window retain the actual stop names and separate `Every N min` information. They never use the template's clock times as an exact live run, nor generate future departure chips from approximate headways.
- Future departure chips contain only published exact trips in the selected route/direction. Different branches and short turns retain their own stops and shapes. The selected vehicle reference is a separate chip; during an outage it is labelled a timetable reference.
- **No LIVE arrivals are generated.** VehiclePosition gives a location observation, not a TripUpdate prediction. Static/estimated times and measured vehicle progress remain separate. All times use Asia/Kuala_Lumpur and 12-hour display with dates where needed.

## Progress and delay evidence

The decoder preserves actual protobuf field presence. Omitted stop sequence, direction/status zero defaults and feed-header timestamps must not masquerade as reported vehicle fields. The existing legacy reportedAt display is retained, but journey progress only trusts the vehicle's own timestamp.

Progress requires a matched vehicle instance, realtime availability and a measurement no older than 120 seconds (or more than 30 seconds into the future). Consistent current_stop_sequence/current_status identifies the current or next stop. Previous stops may then be labelled Departed, without fabricating actual departure timestamps. IN_TRANSIT_TO/INCOMING_AT never claim arrival. A fresh STOPPED_AT at the final stop marks completion. A unique stop_id without sequence supplies a labelled hint only; it cannot fabricate arrival or completed stops. Contradictory IDs, loop ambiguity and unknown progress show the full scheduled stop list.

The implementation deliberately does not infer stop progress from the geographically nearest stop or GPS proximity. The current official feeds lack the sequence/status fields needed for confirmed progress; route geometry remains a visual overlay rather than a fabricated stop-arrival detector.

Delay support is limited to a defensible lower bound: a fresh STOPPED_AT observation after the exact scheduled departure proves **at least N minutes late departing** from that stop. The badge explains its basis. It is suppressed for estimated/interpolated times, stale/missing observations, previews and terminal completion. No downstream delays or ETAs are extrapolated, and the timestamp is not presented as the actual arrival time. The audited feeds supplied no applicable evidence, so production vehicles show no invented delay badges.

## Feed audit on 7 November 2026

Snapshot around 13:44 MYT; values change as vehicles and source timetables change. Counts refer to drawable vehicle records in the existing pipeline, not guarantees for every route or future feed.

| Official feed | Vehicles / trip IDs present | Exact static trip IDs | Valid timed runs | Stop sequences available | Time class |
| --- | ---: | ---: | ---: | ---: | --- |
| Rapid KL | 78 / 78 | 77 | 55 | 77 | 55 ESTIMATED; other patterns/route fallback |
| MRT feeder | 111 / 111 | 103 | 98 | 98 | 98 SCHEDULED; conflicting/unknown references withheld |
| Rapid Penang | 143 / 143 | 116 | 115 | 116 | 115 SCHEDULED; remaining patterns/route fallback |

All three feeds supplied trip IDs. Rapid KL also supplied trip start dates/times; feeder and Penang samples omitted them and used scheduled trip/date matching. None of the three samples supplied current_stop_sequence, current_status or stop_id. Thus verified stop progress and actual delay were unavailable in this production snapshot. Some Rapid KL start times fell outside the matched static frequency window; their times are withheld rather than made up. Some feeder/Penang trip IDs or route relationships do not match the currently published static dataset.

Verified example routes at audit time included Rapid KL T786/783/T304, MRT feeder T105/T451/T108, and Penang 703/304/605. Support is data-driven for all routes in these sources; no example route IDs, stop names, coordinates, arrival clocks or delay values are hardcoded in production logic.

## Cache, fallback and regression boundaries

The existing static ZIP cache (24 hours), shared in-flight retrieval and realtime cache (30 seconds) are reused. A new by-trip stop index and route-to-trip index are built once while parsing each shared timetable; validated patterns are memoized with a WeakMap keyed by that timetable. Marker clicks reuse those indexes and do not create another ZIP downloader. The panel updates every 30 seconds and aborts after 25 seconds; source failures and unavailable timetable states stay explicit. A last-selected static reference during realtime failure is always labelled as a reference, without verified progress.

Train station boards, estimated train arrivals, bus-stop boards/headways, railway geometry/colours, station markers, official alerts, search/filter state and demonstration data remain in their original flows. No project, domain, dependency or deployment setting changes are required. The pre-existing generated tsconfig.tsbuildinfo change is excluded from the feature commit.

Implementation files: `lib/transit-data.ts`, `lib/vehicle-observation.ts`, `lib/scheduled-departures.ts`, `lib/official-transit.ts`, `lib/bus-journey.ts`, `app/api/bus-journey/route.ts`, `components/bus-journey-panel.tsx`, `components/dashboard.tsx`, `components/transit-map.tsx`, `app/bus-journey.css`. Validation: `tests/bus-journey.test.ts`, `tests/bus-journey-api.test.ts`, `tests/bus-journey-cache.test.ts`, `e2e/bus-journey.spec.ts` and this report.

## Validation

Controlled tests cover exact/descriptor/alias matching, branch patterns, names/order, arrival/departure offsets, exact/approximate frequencies, calendars/exceptions, >24-hour service, selected-departure retention, first/terminal stops, between-stop progress, valid minimum delay, missing/stale/conflicting realtime, protobuf defaults, API validation/outages, previous-stop controls, departure switching, cancellation, close/reset, 390px/1440px layouts and preservation of bus-stop/train interactions. Production verification includes actual bus markers and desktop/mobile screenshots after deployment.

Final local results: TypeScript and ESLint passed; all 88 unit tests passed; all 46 Playwright tests passed against the optimized production build; `pnpm build` passed without build warnings. A controlled ZIP/protobuf integration test verifies one static fetch/parse across repeated selections, one shared in-flight realtime fetch for simultaneous vehicle lookups, warm-cache reuse and a labelled last-known reference on failure. These caches are per serverless instance; a cold or newly scaled instance can fetch the official source again.

Remaining limitations: no verified live arrival predictions; actual feeds currently lack confirmed stop progress; incomplete or incompatible trip references cannot yield a timed vehicle run; source calendars and templates can change; geometry can be unavailable; no GPS-only stop matching or downstream delay propagation is claimed.
