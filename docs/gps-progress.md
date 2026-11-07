# GPS-based bus progress

## Data and architecture

This extends the existing bus journey API/panel, using only the matched trip's official GTFS shape, its ordered stops and decoded official vehicle observations. Planned arrival/departure calculations and departure selection are unchanged. GPS status is separate from the existing SCHEDULED/ESTIMATED time classification; no GPS-derived ETA, actual arrival/departure clock, downstream delay or service-completion claim is invented.

The [official Malaysian GTFS Static and Realtime APIs](https://developer.data.gov.my/realtime-api/gtfs-realtime) remain the transport sources. Interpretation uses the [GTFS shape reference](https://gtfs.org/documentation/schedule/reference/#shapestxt) and [VehiclePosition reference](https://gtfs.org/documentation/realtime/reference/#message-vehicleposition). Shapes and stops are WGS84 latitude/longitude. Standard GTFS-Realtime Position has no accuracy field; these feeds therefore show **GPS accuracy not supplied**. Distance from the route is an alignment residual, not an empirically measured GPS accuracy or a guarantee of the actual road used.

The static cache now retains validated progress geometry and optional shape_dist_traveled references. Shared shape arrays are sorted once by shape_pt_sequence and reused across trips. Invalid/missing coordinate or sequence rows and duplicate point sequences exclude a shape from progress inference; the existing display geometry flow is preserved. No new ZIP downloader, mapping service or dependency is introduced. In-memory observations and projected stop patterns reuse the existing 30-second realtime and 24-hour static caches.

## Trip/shape/stop validation

- Existing exact trip matching, unique full-descriptor fallback, public route-code alias validation, calendar exceptions and service-day handling remain authoritative. GPS is evaluated only for a valid matched vehicle run, with its service date/start and trip-specific shape_id. Future scheduled departure previews receive no vehicle progress.
- No railway, nearest-route or generic opposite-direction shape is substituted. Missing trip geometry retains scheduled-only/unknown progress. KTMB's current official static feed has no corresponding trip shapes; map railway relations do not establish a vehicle trip/direction, so KTMB GPS inference is not enabled.
- Cumulative metres use geodesic segment lengths. Each coordinate is projected onto the published polyline in a local longitude/latitude plane, with the along-route fraction applied to the segment's geodesic length. The chosen point remains on the original published geometry.
- Stops retain GTFS stop_sequence order. Candidate projections are checked globally with forward/backward monotonic feasibility. Repeated terminal coordinates can be resolved by intervening stops. Distinct feasible occurrences remain unknown. Valid published shape-distance anchors restrict candidates and are checked against the stop's coordinates; inconsistent units/anchors do not create a fabricated position.
- Missing/far/ambiguous/non-monotonic stop projections retain planned information. A missing intervening stop prevents naming a later projected stop as the actual next stop. A reliable current route position can still be shown without claiming an exact stop bracket.

## Configurable confidence rules

All thresholds are centralized in `lib/route-projection.ts` as PROGRESS_LIMITS:

| Rule | Default |
| --- | ---: |
| Maximum GPS age / future timestamp tolerance | 120 s / 30 s |
| Maximum route offset / high-confidence route offset | 60 m / 25 m |
| Maximum stop offset / anchor-coordinate tolerance | 100 m / 100 m |
| Competing candidate offset slack / cluster separation | 12 m / 40 m |
| Stop-order tolerance / backward position hysteresis | 15 m / 30 m |
| Minimum passage buffer beyond a stop | 50 m |
| Approaching zone | 45 m |
| Minimum consistent observation interval / forward movement | 15 s / 40 m |
| Maximum plausible route speed for continuity | 40 m/s, plus 50 m slack |
| Heading disagreement rejection | 55 degrees |
| Accuracy rejection / high-confidence limit, if explicitly supplied | 50 m / 25 m |
| Maximum individual published shape-segment length | 5 km |

A single fresh uniquely matched fix is **APPROXIMATE / MEDIUM** and cannot mark PASSED. Moving heading (when actually present) and observed movement direction filter competing segments. Previous progress bounds reachable segments; multiple remaining candidates stay unknown. Minor backward noise is held within hysteresis; major backward or implausible forward movement resets continuity. Reported protobuf default bearing/speed values are not mistaken for present fields.

**GPS-INFERRED / HIGH** requires consistent, fresh, forward observations and high-quality geometric residuals. A PASSED stop must also have a reliable stop projection and lie at least 50 m behind both consecutive matched positions. Once supported, confirmed route distance stays monotonic within the same valid observation chain. PASSED means the bus progressed beyond a projected stop location, not proof that it served the stop. Planned clocks remain labelled SCHEDULED/ESTIMATED, and no actual stop timestamp is added.

Existing explicit consistent realtime sequence/status has priority and is labelled **LIVE PROGRESS**. It retains its existing delay evidence rules. GPS alone never triggers the delay badge. At/near the terminal, GPS does not establish arrival or completion; only the existing explicit stop status can confirm completion.

## State, failure and UI behavior

The observation store is keyed by source and vehicle, with trip/route/direction/start identity and a bounded eight-fix window. It clears continuity when a vehicle disappears from a successful feed, the feed fails, the trip/start/date changes or the observation gap exceeds 120 seconds. Older packets, including an old trip packet, cannot replace a newer observation. Cached duplicate timestamps are not additional evidence. Progress state includes shape/stop validation fingerprints, so static geometry changes also restart inference. Source outages and untrusted query snapshots cannot seed verified GPS history.

The client rejects older same-vehicle run responses, preserves explicit timetable selection and downgrades current claims as timestamps age, even if refresh fails. STALE shows Last seen; current projected markers, passed claims and split highlights are withdrawn. Historical matched coordinates/timestamps remain clearly historical. No scheduled-time extrapolation advances the bus.

The timeline keeps the most recent PASSED stop visible, inserts a separate bus marker before the next validated stop and leaves upcoming planned times below it. Earlier passed stops remain expandable. Evidence shows source, confidence, GPS measurement time, route offset and whether accuracy was supplied. Map geometry behind high-confidence progress is grey; remaining geometry is blue. The selected bus icon is placed at the projected point and stays above paths. APPROXIMATE positions receive a marker without completed-route colouring. Closing/changing vehicle, timetable preview or stale/unavailable progress removes these overlays. Existing railway/station layers, controls and mobile sheet behavior remain.

Serverless caches are per instance. Cold starts and newly scaled instances lack temporal evidence and appropriately begin with APPROXIMATE/UNKNOWN. They do not claim continuity from another instance. This can reduce confidence temporarily; it cannot manufacture passed stops.

## Real-data audit before deployment

Three official observation rounds at about 15:00:55, 15:01:27 and 15:01:59 MYT on 7 November 2026 were evaluated. The final snapshot contained 350 bus vehicles; 274 had valid timed trip matches. Of those, 163 had HIGH GPS-inferred route progress, 64 were APPROXIMATE, and 47 had unknown progress. 153 vehicles had at least one supported PASSED stop.

| Source | Vehicles checked in final snapshot | Valid matched runs | HIGH / APPROXIMATE / UNKNOWN | Vehicles with PASSED stops |
| --- | ---: | ---: | --- | ---: |
| Rapid KL | 70 | 40 | 27 / 3 / 10 | 21 |
| MRT feeder | 128 | 116 | 67 / 28 / 21 | 65 |
| Rapid Penang | 152 | 118 | 69 / 33 / 16 | 67 |

Examples of HIGH progress included Rapid KL 220, 173, 782 and 772; MRT feeder T462, T180, T807 and T817; Penang 202, 101 and 302. These are dated tested vehicles/runs, not claims of operator-wide or whole-route coverage. Other vehicles on the same route can be ambiguous, stale, stationary or on unmatched runs. Initial single-observation matches were only APPROXIMATE. Conflicting headings, overlapping route branches and out-of-route coordinates were explicitly rejected.

The KTMB audit found seven drawable realtime vehicles and zero official trip paths/progress shapes. Its existing railway and station displays remain available, with no unsupported vehicle progress inference. Further per-vehicle production verification and actual desktop/mobile screenshots accompany deployment.

## Files and validation

New modules: `lib/route-projection.ts` (geometry/thresholds), `lib/vehicle-progress.ts` (typed confidence/state inference), `lib/vehicle-progress-history.ts` (official observation continuity), `lib/bus-progress.ts` (journey integration and response/stale guards), `components/gps-progress.tsx` (evidence and connected position row). Integration: official static/realtime parser, bus journey model/API, vehicle observation types/decoder, bus panel/map and scoped CSS. No timetable algorithm or train board was replaced.

Controlled tests cover before/between/beyond stops, multiple passed stops, terminal non-claims, opposite direction, parallel carriageways, loops, drift/accuracy, stale/future/missing timestamps, absent geometry/coordinates, far and non-monotonic stops, shape-distance anchors, noise/backward movement, impossible jumps, duplicate/old packets, trip/service/date/vehicle/source resets, disappearance/interruption, unchanged timetable clocks, explicit realtime priority and connected timeline/map/mobile behavior. Existing bus, train, alerts and station suites remain included.

Final local validation: TypeScript passed; ESLint passed; all 121 unit tests passed; all 60 Playwright browser tests passed against the optimized production build; `pnpm build` passed without build warnings. Tests include a disappeared vehicle retaining a labelled historical point/static route, while removing current GPS highlights. A production-only interaction check also exposed Leaflet's stale tooltip focus listener when a selected vehicle tooltip was conditionally unbound. Vehicle tooltips now stay mounted for the marker lifetime and only their content changes; a repeated close/reopen regression first reproduced the error and passes with the fix. The pre-existing generated tsconfig.tsbuildinfo modification is excluded from the feature commit. The projected marker also uses its own observation timestamp/coordinate pair, so an older dashboard cache cannot mark a fresh journey observation stale; a dedicated browser regression covers this.

Known limits: the system has no independent road-level ground truth; closely parallel unmodelled roads, inaccurate official shapes or unavailable accuracy metadata can remain uncertain. It does not infer actual stop service, ETA, GPS-derived delay or completion. Invalid projections preserve scheduled-only information. Thresholds are deliberately conservative and can be tuned centrally using validated evidence.
