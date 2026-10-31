# Scheduled departures and official announcements

## Scope and baseline

Checkpoint branch: `codex/checkpoint-scheduled-alerts-20261101`, pointing to pre-edit commit `6b2658a`. The existing generated `tsconfig.tsbuildinfo` modification was preserved and excluded from commits. Baseline TypeScript, ESLint, 12 unit tests and 5 browser tests passed.

The work adds two isolated endpoints and small additions to the existing selected-station and Alerts panels. No route geometry, station positions, transport classification, map events, rail filters or palette were changed. No runtime dependencies were added or upgraded.

## Timetables

- `/api/departures?stop=rapid-rail-kl:KG20&stop=rapid-rail-kl:PY23` accepts up to 20 validated canonical stop references from the five existing official feeds. The actual refs come from stops.txt and are preserved when interchange records are merged. They are not inferred from marker IDs or station-name guesses.
- Existing ZIP download/parser and 24-hour in-memory feed cache are reused. stop_times is indexed by stop, trips/routes provide service and direction, stop_sequence supplies destination when headsign is absent, and platform/stop code is displayed where present. Terminal-only arrivals and pickup_type=1 are excluded from upcoming departures.
- calendar and calendar_dates are both respected. Missing calendars are not assumed to mean daily service. Times use Asia/Kuala_Lumpur fixed UTC+08:00; GTFS extended hours are added to service-day midnight exactly once. Previous service days are considered for overnight trips; tomorrow's services can be shown after today's service ends. Departures are deduplicated and sorted, with at most 10 displayed.
- GTFS frequencies are important: Rapid Rail and some Rapid KL buses publish headways with no exact_times=1. These are displayed as official SCHEDULED frequency windows, not invented precise departures. Only exact_times=1 windows can expand to specific scheduled times. MRT, LRT and Monorail generally use this frequency form; KTMB and feeder buses provide exact stop_times.
- LIVE ETA is explicitly UNAVAILABLE. The official realtime documentation still says VehiclePosition only: https://developer.data.gov.my/realtime-api/gtfs-realtime . No trip-update predictions are derived from positions.
- Sources: https://developer.data.gov.my/realtime-api/gtfs-static and existing Prasarana/KTMB feeds, CC BY 4.0. Official published alternatives were investigated at https://www.ktmb.com.my/TrainTime.html and Rapid KL operating-hours material. KTMB offers dated PDF timetables, while the existing GTFS provides indexed station schedules. This implementation does not automatically parse/override schedules from those PDF matrices or use third-party schedules. If GTFS cannot be retrieved there is an explicit unavailable state; published-PDF fallback remains a limitation.

### Measured published-record coverage, 2026-11-01

These are canonical GTFS stops before interchange/marker merging, including stops outside the currently displayed map subset. Record coverage does not guarantee a valid service runs on a selected date.

| Existing official feed | Stops with published records | Stops without records |
| --- | ---: | ---: |
| Rapid Rail KL | 187 | 0 |
| KTMB | 155 | 0 |
| Rapid KL Bus | 4,106 | 0 |
| MRT feeder bus | 2,122 | 0 |
| Rapid Penang | 1,931 | 0 |
| Total | 8,501 | 0 |

Read-only coverage diagnostics: `/api/departures?coverage=<existing-source-id>`. These return counts only, not credentials or user data. Schedule validity is evaluated separately for each selected station request.

## Official announcements

- `/api/alerts` reads public official Prasarana RSS and KTMB homepage notices after checking their robots policies. Source retrieval uses timeouts, approved fixed hosts, a 2 MB size cap and no redirect bypass. Procurement/lifestyle items are filtered out. Canonical official URLs deduplicate notices. React renders sanitized text rather than upstream HTML.
- Verified usable: https://www.prasarana.com.my/feed/ (RSS) and https://www.ktmb.com.my/index.html (public HTML). Prasarana may have zero relevant operational items even when the feed is healthy.
- Rapid KL RSS is blocked/access-protected in current checks; MRT Corp RSS returns HTTP 403. No challenge or protected page is bypassed. The UI reports source health and last successful retrieval separately.
- No authorised X or Facebook connector/API credentials are configured. Both are explicitly UNAVAILABLE and no social scraping is performed. Official Rapid KL social handles can be found in the operator's published carriage conditions, but their content is not ingested without authorised access.
- Supported categories: disruption, delay, closure, maintenance, diversion, restoration, general. Severity is a conservative dashboard interpretation and defaults UNKNOWN, never CRITICAL based on alarm words. Only explicit line names produce map associations; no stations are fabricated. Alert selection uses the existing station-selection behavior for a reliable single-line match and otherwise adds no map highlight.
- Undated KTMB notices show publication time unavailable, current status UNKNOWN and a stale/undated warning. Retrieval time is never presented as publication time. Recent explicitly worded disruptions can be ACTIVE; explicit expiry becomes EXPIRED, and restorations can be RESOLVED. Different incidents are not merged by line name alone; resolution matching requires a confirmed same incident ID and source/timeline. Current sources generally lack those IDs, so uncertain notices stay separate.
- Polling: browser every 5 minutes; server per-source cache 10 minutes and CDN max-age 5 minutes/stale-while-revalidate 10 minutes. Last successful notices are retained when a source fails, with stale source status. Fetched history is retained within the warm server process and browser session. There is no durable cross-deployment incident archive/database; cold-start retention is a limitation, not a claim of permanent history.

## Verification

Unit fixtures are clearly synthetic and never shown as real incidents. Tests cover calendar exceptions, overnight times, missing data, exact versus non-exact frequency windows, terminal arrivals, alert source/URL validation, tender exclusion, robots rules, expiry, conservative restoration matching and cached upstream failure.

Browser tests cover all five transport modes, departures refresh, unavailable information, official notices/links/filter/map association, and frequency transparency. Existing MRT geometry/stations/interchange, rail toggle and refresh-persistence, bus search, bike filter and alert interaction tests remain in the suite. Local real-source calls verified rail frequencies, exact KTM/feeder departures, official notices and source-access failures. Final production status and commit are reported after deployment.
