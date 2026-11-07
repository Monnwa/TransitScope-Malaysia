# Upcoming train arrivals

## Data and calculation

The existing `/api/departures` endpoint and shared official timetable cache now also return `trainArrivals` and `arrivalFrequencyCoverage`. Existing departures/frequency fields remain available for KTM, buses and clients using the previous response. No second timetable downloader, transport source, dependency, project or deployment configuration was introduced. The existing parser retains raw arrival records and the first stop by `stop_sequence`, alongside its original departure index. Terminal arrivals are valid even when there is no onward departure.

Source: [Malaysia official Rapid Rail GTFS Static](https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl), using routes, trips, stop_times, frequencies, calendar and calendar_dates. Interpretation follows the [GTFS Schedule frequencies specification](https://gtfs.org/documentation/schedule/reference/#frequenciestxt).

For each active trip, service-day midnight is interpreted in Asia/Kuala_Lumpur. The selected stop's arrival offset is `arrival_time − first stop departure_time`. A frequency slot is `service midnight + start_time + arrival offset + k × headway_secs`, with nonnegative integer k. The selected station's service window is shifted by that same offset; its end is exclusive. Each window/direction is calculated independently. Departed events are removed, events are sorted globally, duplicates are removed, and at most ten are returned. Previous service dates are considered for times above 24:00; calendar exceptions override weekdays.

- Exact stop_times and exact_times=1 frequency slots are **SCHEDULED**.
- Omitted/zero exact_times slots are **ESTIMATED**. This is a model anchored to the published first-vehicle departure, not a guarantee of the phase of individual trains. Actual arrivals may differ. Explicit timepoint=0 stop times also remain estimated.
- Missing first departures, missing selected arrival times, impossible offsets, conflicting origins, malformed/overlapping frequency windows or invalid headways do not produce modeled timestamps. Existing valid frequency information remains visible instead. A later stop's minimum timestamp is never substituted for an incomplete origin.
- **LIVE ETA remains unavailable**. VehiclePosition is not converted into a live prediction. Existing verified-prediction guards remain in place.

The API's legacy top-level SCHEDULED availability status continues to describe a published timetable, not the accuracy class of each train. Consumers must use each arrival's `classification`. Coverage identifiers include source, trip, platform and dated frequency window, so a supported window cannot hide unrelated fallback frequency information.

## Official feed audit, 7 November 2026

All 106 frequency records in the retrieved feed omitted exact_times. Consequently none of the tested Rapid Rail lines provides exact SCHEDULED arrival slots in this feed. The implementation supports exact slots if a subsequent official feed publishes them.

At the midday audit, the calculation returned estimated arrivals for every route/stop membership on the existing mapped Rapid Rail lines:

| Line | Canonical GTFS stops | Classification |
| --- | ---: | --- |
| Kajang (KGL) | 29 | ESTIMATED |
| Putrajaya (PYL) | 36 | ESTIMATED |
| Kelana Jaya (KJ) | 37 | ESTIMATED |
| Ampang (AG) | 18 | ESTIMATED |
| Sri Petaling (PH) | 29 | ESTIMATED |
| KL Monorail (MR) | 11 | ESTIMATED |

No checked station on these six lines needed frequency-only fallback at that time. This is a dated feed audit, not a promise of future coverage or actual operating conditions. The feed also contains Shah Alam (SA) records; they can be calculated as published LRT timetable records, but this enhancement does not add a new map line or assert operational service. BRT records are excluded from train-arrival modeling, despite the pre-existing route_type mapping. Existing bus and KTM presentation remains separate.

## Presentation, refresh and regression boundaries

Train rows show the existing line colour, destination, direction and platform, followed by 12-hour MYT arrival, current countdown and a neutral SCHEDULED or amber ESTIMATED badge. Five trains appear initially; expansion to ten requires no API request. Contiguous line/direction groups preserve chronological order; each row repeats its own affiliation so alternating directions remain clear. Tomorrow's arrivals carry a date. Estimated information includes an explanation and never uses the green live indicator.

The clock updates every 15 seconds. Open train boards recalculate via the existing cached endpoint approximately every minute. Manual refresh, timeout, abort, station-key reset and stale-response guards remain. Failed refresh retains prior valid data, while passed rows still disappear. Static ZIP caching remains 24 hours with shared in-flight retrieval. Station selection never starts a separate ZIP download path.

KTM/bus 24-hour scheduled rows, bus headways, transport maps, geometry, station merging, marker interactions, filters, official alerts and LIVE/STATIC/SIMULATED labels are unchanged. New calculations add information to STATIC timetable data; they are not simulated transport data.

## Validation

- TypeScript and ESLint.
- Controlled unit fixtures for all six mapped rail lines, exact/approximate slots, arrival offsets, independent headways, boundaries, directions, duplicates, calendars/exceptions, >24-hour service, no more service, malformed windows, missing anchors, terminal arrivals, BRT exclusion, bus/KTM regression and countdown formatting.
- Playwright coverage for five/ten expansion, chronology, direction labels, 12-hour display, scheduled/estimated distinction, unavailable LIVE ETA, ticking countdowns, automatic refresh failure retention, station switching, per-window fallback, empty states and 390px/1440px layout. Existing map, bus, KTM and alert browser tests remain included.
- Production build and live-data checks on actual MRT/LRT stations, with desktop/mobile screenshots after deployment.

Final local results: TypeScript passed; ESLint passed; 56 unit tests passed; all 31 Playwright tests passed against the optimized production build; `pnpm build` passed without build warnings.

Modified implementation files: `lib/scheduled-departures.ts` (additive arrival indexes), `lib/train-arrivals.ts` (new calculation), `app/api/departures/route.ts` (additive response), `lib/departure-board.ts` (types/time formatting), `components/upcoming-departures.tsx` (integration/refresh), `components/train-arrival-rows.tsx` (new rows), `app/departure-board.css` (scoped styles). Validation files: `tests/train-arrivals.test.ts`, `tests/departure-empty-states.test.ts`, `e2e/train-arrivals.spec.ts` and this report. The pre-existing generated `tsconfig.tsbuildinfo` modification remains excluded from the feature commit.

Remaining limitations: frequency-based estimates cannot predict delays, cancellations, dwell variations or exact train positions. Official calendars and templates may change or fail to download; cached/fallback and unavailable states remain explicit. Platform fields are only the official code when no named platform is supplied. No new real-time arrival source has been added.
