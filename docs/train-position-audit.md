# Train position source audit — 7 November 2026

Source: [Malaysia official Rapid Rail GTFS Static](https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl), retrieved 2026-11-07 14:21 UTC. Agency timezone is `Asia/Kuala_Lumpur`. The existing shared static loader caches the parsed timetable, validated trip shapes and shape-distance references for 24 hours with in-flight request reuse. The new feature must consume that loader; it must not download or parse another ZIP on each update.

All six requested lines have trips in directions `0` and `1`, complete stop-level arrival/departure templates, and direction-specific shape IDs. Routes must be joined through `trips.route_id`: some `stop_times` rows contain legacy route abbreviations that differ from `routes.route_id`.

| Line | route_id | Exact scheduled trips without frequencies | Frequency precision | Fully matched trip geometries | Individual train position now |
| --- | --- | --- | --- | --- | --- |
| MRT Kajang | KGL | 0 | `exact_times` absent → 0 | 6 / 6 | Unavailable: headway only |
| MRT Putrajaya | PYL | 0 | `exact_times` absent → 0 | 6 / 6 | Unavailable: headway only |
| LRT Kelana Jaya | KJ | 0 | `exact_times` absent → 0 | 0 / 6 | Unavailable: headway only; terminal mismatch |
| LRT Ampang | AG | 0 | `exact_times` absent → 0 | 6 / 6 | Unavailable: headway only |
| LRT Sri Petaling | PH | 0 | `exact_times` absent → 0 | 6 / 6 | Unavailable: headway only |
| KL Monorail | MR | 0 | `exact_times` absent → 0 | 6 / 6 | Unavailable: headway only |

Each line has six weekday/weekend/direction templates. No requested line publishes an `exact_times=1` frequency row. Service calendars and date exceptions remain mandatory: the audited calendar validity ends on 2026-12-31, so the engine must not assume service after that date. Weekend and weekday windows/headways differ; Putrajaya also differs between directions. GTFS times can exceed 24:00.

The [GTFS frequencies specification](https://gtfs.org/documentation/schedule/reference/#frequenciestxt) distinguishes approximate headway service from compressed exact schedules. A headway template is not evidence that an individually identifiable train departed on a generated time grid. Without an observed departure or a defensible, bounded phase interval, it cannot justify a precise train marker or a next-station countdown. The existing station-arrival headway model remains separate and explicitly estimated; its phase grid is not reused as a vehicle observation.

The existing railway map uses official GTFS WGS84 shapes for all six lines, with the established display colours. Position eligibility additionally requires every exact trip stop to project uniquely and monotonically onto that trip's own validated shape. A line-level proximity check alone does not establish trip geometry, direction or timing. Missing or ambiguous stops, invalid directions and mismatched shapes suppress that trip.

The downloaded archive was independently run through the new preparation engine. Five lines pass the complete station-to-shape check in all six templates. Kelana Jaya fails the stricter position check at Putra Heights (`KJ37`): its stop coordinate has no candidate within the existing projection module's 100 m limit on its own trip shape. Its existing line and station rendering remain unchanged. The feature does not move the station, alter the track or relax the shared bus projection limits to manufacture eligibility.

The implementation supports exact scheduled trips and exact frequency runs if a future valid feed supplies them. Current approximate-only service receives an explicit unavailable state and no precise marker. BRT and the source's additional Shah Alam route are outside the requested six-line scope; KTM and existing bus tracking are unchanged.

Raw audit details and the independently downloaded source archive are retained with the task's verification artifacts. Deterministic synthetic fixtures cover positive train-marker behaviour; they are never substituted for the official production feed.

## Implementation and operation

- `lib/train-positions.ts`: independent prepared timetable/geometry index, exact run generation, service date handling, and cumulative-distance positioning. Current and next two minutes of runs only, with an upper fleet bound. Expiry boundaries are exclusive. Approximate frequency templates never become an individual departure grid.
- `app/api/train-positions/route.ts`: consumes the existing static loader; no new feed download/parser/cache. Fifteen-second shared response caching, explicit 503 on source failure. No client-supplied trip, geometry or clock override.
- `lib/train-position-display.ts`: independent map filtering and pixel grouping. A group icon remains at a real member coordinate and lists its separate runs; no coordinate offsets or spiderfying.
- `components/estimated-train-{context,controls,layer,panel}.tsx` and `app/estimated-trains.css`: opt-in map overlay, line availability, estimated icons, bounded group selector, and passenger details. One shared 15-second clock and at most one automatic request per minute while enabled. Disabling the overlay cancels its request/timer. No per-marker polling or animation loops. Markers update directly from absolute Malaysia service time and the railway shape, including with reduced motion.
- `components/dashboard.tsx`, `components/transit-map.tsx`, `components/passenger-copy.ts`: provider integration, separate estimated information filter, existing rail visibility controls, and passenger labels. Train estimates are separate models, never inserted into the official vehicle records or LIVE indicators. Selecting a bus or station clears the train selection; selecting a train closes the previous transport detail.
- `tests/train-positions{,-api}.test.ts`, `tests/fixtures/train-positions.ts`, `e2e/train-positions.spec.ts`: deterministic synthetic positive and negative coverage. Test coordinates and schedules are explicitly synthetic and cannot enter the production API.

The six lines retain existing colours: Kajang `#006B3F`, Putrajaya `#F2C500`, Kelana Jaya `#E75480`, Ampang `#E87524`, Sri Petaling `#7651A8`, Monorail `#2878B5`. Both directions are independent. The panel shows previous/next station, destination, timetable-derived estimated next arrival where defensible, Malaysia update time and Estimated status. Source/run/projection diagnostics stay in collapsed Technical information.

The exact-run method assumes uniform progress in cumulative track distance between published stop times, with dwell at published station intervals. It cannot account for disruptions, speed changes or delays; it is never an observed train location. No visual smoothing adds precision. Runs and source responses expire; unavailable estimates have no next-station countdown. The current official source produces **zero precise train markers on all six lines**, as required by the eligibility rules, while existing stations, departure boards, railway lines, bus GPS tracking and adherence remain intact.

## Verification

- 221 unit tests passed, including 34 new engine/display/API tests.
- 84 Chromium browser tests passed, including eight new feature scenarios: six lines/both directions, shape movement and bounded requests, train selection/passenger labels, map filters/toggle, approximate-only fallback, expiry/outage, unchanged-coordinate grouping, and mobile/reduced motion.
- TypeScript, ESLint and optimized production build passed.
- Source audit artifacts include the original official ZIP, source summary, and prepared geometry diagnostics. Production desktop/mobile screenshots show the actual unavailable state; synthetic positive UI screenshots are labelled separately if provided.
