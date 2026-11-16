# Phase SM-1.3 — LinkBike experimental integration

This opt-in experiment displays LinkBike station candidates and the bike counts reported by the Maintenance Portal. Inventory observation time, rentability and public station access remain unverified. The experiment has no operator authorization and is intended for local development or an explicitly configured preview.

## Sources and parsing

- The server reads the initial HTML document from `GET https://mm.linkbike.my/`. The parser uses parse5, which decodes entities and never executes page scripts or fetches subresources. It uses the station-card and name selectors, checks for one ID and name, and reads `Dock`, `Bike` and `Volt` through each label’s adjacent value in the same parent. It checks the expected card shape and requires a single raw `Last Updated` value. Changed structure or zero usable rows makes the portal unavailable. Invalid counts and duplicate IDs are quarantined. Station IDs stay strings. Voltage is discarded. [Maintenance Portal](https://mm.linkbike.my/) · [Phase SM-1.1 audit](linkbike-portal-integration-audit.md)
- The consumer map source returns a JSON array from `GET https://www.linkbike.my/linkbike_api/api_update_stationinfo.php`. Zod checks the container and individual rows. The adapter discards malformed rows and duplicate IDs, joins by exact ID and compares normalized names. Inventory disagreements produce station warnings and retain the portal’s counts. The secondary source is operated by LinkBike and does not independently verify inventory. [Consumer station JSON](https://www.linkbike.my/linkbike_api/api_update_stationinfo.php)
- Known IDs `28`, `29`, `80` and `1023` and rows labelled private, mobile or test are excluded. Other rows are station candidates with `is_public_station: null`. Only matched candidates inside the approximate Penang Island bounds of 5.1–5.6° N and 100.15–100.42° E can render as markers. Station `16` is always quarantined from the map. Raw coordinate strings remain in `source_coordinates` for diagnostics. Rejected or missing normalized coordinates are null. Passing these checks establishes geographic plausibility and a matched station identity.

## Feature flag and endpoint

Set `NEXT_PUBLIC_ENABLE_LINKBIKE_LAYER=true` before starting local Next.js development or building an authorized Vercel Preview. The default is off. Both Vercel environment identifiers must report `preview` to enable a hosted build. Production and unidentified production-mode builds stay off even with the flag set. The browser toggle appears in the normal dashboard and starts off. Enabling it loads the experimental layer and preserves the current view. Use **Zoom to LinkBike stations** to frame the candidates, then select a marker to open its independent station popup. Turning the layer off removes its markers and stops its refresh loop. [Phase SM-1.3.1 regression audit](linkbike-regression-audit.md)

`GET /api/micromobility/linkbike` returns 404 with the feature off, 200 with `UNVERIFIED` portal data when enabled, or 503 with `UNAVAILABLE` and no inventory when the portal fails. The two sources use independent process-local caches and coalesce in-flight requests per source. Each upstream request has an eight-second timeout and a 512,000-byte response limit. The API and upstream fetches use `no-store` so the adapter controls refresh. Failed results are cached within the same refresh window to avoid retry bursts. The previous inventory is discarded after a failed refresh. A consumer failure leaves parsed portal counts available in the API and removes the unvalidated markers.

The default refresh is 300 seconds. After operator approval, set `LINKBIKE_REFRESH_SECONDS` to an integer between 60 and 3,600 if the agreed cadence differs. The route sends that interval to the open overlay. Caches are local to a server process and reset on restart. The feature flag grants no data use rights.

### API response example

This abridged example shows one station and both source-health entries.

```json
{
  "source": "LinkBike",
  "status": "UNVERIFIED",
  "fetched_at": "2026-11-12T12:19:38.915Z",
  "upstream_updated_at": null,
  "upstream_updated_at_raw": "12/11/2026 08:19:38pm",
  "stations": [
    {
      "source": "LinkBike",
      "station_id": "2",
      "station_name": "Lebuh Light",
      "total_docks": 12,
      "available_bikes": 7,
      "available_docks": null,
      "latitude": 5.420024,
      "longitude": 100.342431,
      "source_coordinates": { "latitude": "5.420024", "longitude": "100.342431" },
      "upstream_updated_at": null,
      "upstream_updated_at_raw": "12/11/2026 08:19:38pm",
      "fetched_at": "2026-11-12T12:19:38.915Z",
      "data_status": "UNVERIFIED",
      "is_public_station": null,
      "coordinate_status": "VALIDATED_CANDIDATE",
      "validation_warnings": []
    }
  ],
  "source_health": {
    "portal": { "status": "HEALTHY", "fetched_at": "2026-11-12T12:19:38.915Z", "warning": null },
    "consumer_json": { "status": "HEALTHY", "fetched_at": "2026-11-12T12:19:38.912Z", "warning": null }
  },
  "refresh_seconds": 300,
  "excluded_stations": 4,
  "warnings": []
}
```

## Status and limits

| Status | Meaning |
| --- | --- |
| `UNVERIFIED` | Parsed portal counts, with unknown observation time and rentability. The raw portal clock is displayed with its qualifier. |
| `UNAVAILABLE` | The portal failed to respond or did not yield usable station inventory. |
| `STATIC` | Reserved for a future verified station registry. The consumer coordinate candidates cannot provide verified static fallback during a portal outage. |
| `STALE` | Reserved for a future verified observation time outside an explicitly configured age threshold. |
| `LIVE` | The experiment never emits this status. |

`fetched_at` records server retrieval time and stays unchanged on a cache hit. `available_bikes` contains the number reported by the portal. `available_docks` stays null because usable empty docks are undefined by the sources. Source health describes retrieval and parsing, with station-level warnings for inventory conflicts or unusable coordinates. A healthy HTTP response does not establish availability.

## Verification

On 12 November 2026 at 20:40 MYT, the enabled local API returned HTTP 200 and `Cache-Control: no-store` against both public sources. It returned **27 unverified station candidates**, of which **26** passed the coordinate checks. Four records were excluded and station **16** was quarantined from marker display due to its longitude of `80.280467`. The actual observation timestamp and available docks remained null.

TypeScript, ESLint and a local production build with the flag off passed. The unit suite passed 444 tests, including 18 LinkBike cases covering parsing, quarantine, filtering, clocks, endpoint gating, timeout, malformed and oversized payloads, cache expiry and request coalescing. The pre-change bus, rail and dashboard browser baseline passed 20 tests. The estimated-train visibility test also ran against the pre-change map and reproduced its existing failure at the re-enable step, with six markers rendered where the test expected 12. [Train visibility test](../e2e/train-positions.spec.ts)

The final enabled browser suite recorded 102 passes, one failure and one flag-specific skip. The selected flag-off suite recorded 28 passes, one failure and three flag-specific skips. All four LinkBike browser tests passed across the two runs. They covered the disabled route, the toggle and marker filtering at 390px and 1440px, station details and removal of old markers after a failed refresh. Both final runs had the same pre-existing train visibility failure.

## Files changed in this phase

- Server and data model. [Route](../app/api/micromobility/linkbike/route.ts) · [Source adapter](../lib/linkbike.ts) · [Parser](../lib/linkbike-parser.ts) · [Data types and flag](../lib/linkbike-data.ts)
- Opt-in map layer. [Page](../app/page.tsx) · [Dashboard](../components/dashboard.tsx) · [Transit map](../components/transit-map.tsx) · [LinkBike layer](../components/linkbike-layer.tsx) · [Layer styles](../app/linkbike.css)
- Runtime HTML parser declaration and coverage. [Package manifest](../package.json) · [Lockfile](../pnpm-lock.yaml) · [Unit tests](../tests/linkbike.test.ts) · [Browser tests](../e2e/linkbike.spec.ts)

## Requirements before a public integration

Obtain operator permission for automated retrieval, retention and redistribution. Request a supported feed contract, stable public station IDs and coordinates, verified inventory timestamps and time zone, rental/return status, definitions for rentable bikes and usable free docks, polling limits and attribution. Obtain the public station registry before labelling any candidate public or using station counts as an authoritative coverage measure. [Operator](https://www.linkbike.my/) · [Portal reuse assessment](linkbike-portal-integration-audit.md#terms-and-data-reuse)
