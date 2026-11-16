# Phase SM-1.1 — LinkBike Maintenance Portal integration audit

**TransitScope Malaysia · 12 November 2026 (MYT)**

**CONDITIONAL GO for an operator-approved pilot.** The Maintenance Portal is directly readable as anonymous HTML and its station counts can be extracted server-side. The audit could not establish an inventory observation clock, a supported data contract, or permission for recurring retrieval and public redistribution. Those gaps prevent implementation of `/api/micromobility/linkbike` at this phase.

## Actual source and request format

| Surface | Request and format | Evidence |
| --- | --- | --- |
| [LinkBike Maintenance Portal](https://mm.linkbike.my/) | Anonymous `GET https://mm.linkbike.my/`. HTTP 200 with `text/html; charset=UTF-8`. | The initial HTML document contains the complete station snapshot and one page-level `Last Updated` paragraph. The rows are cards inside `div.pnlstationInfo`. Each has a `Station: <id>` paragraph, a `p.stationInfo` name, and three `p.stationInfo2` labels paired with adjacent `p.stationInfo2Value` values. Labels are `Dock`, `Bike` and `Volt`. Classes such as `capacity` and `lowbike` provide display styling. |
| [LinkBike consumer station map](https://www.linkbike.my/) | Anonymous `GET https://www.linkbike.my/linkbike_api/api_update_stationinfo.php`. HTTP 200 with `text/html; charset=UTF-8` and a JSON array body. | The consumer homepage embeds initial map markers and its `center_changed` callback invokes `UpdateStation()` to request this JSON. The response keys are `StId`, `name`, `capacity`, `availbike`, `volt`, `lat` and `lng`. It has no update timestamp. [Station JSON](https://www.linkbike.my/linkbike_api/api_update_stationinfo.php) |

The portal has no inline script or HTML refresh directive in the observed response. Its linked scripts include Google Maps, jQuery, Dropotron, Scrolly, Scrollgress, Skel, `assets/js/util.js`, `assets/js/main.js`, `javascript/demo.js` and Owl Carousel. The nine LinkBike-hosted assets examined had no station-specific selector or reference to the consumer station JSON. A clean browser load rendered 31 cards and made no LinkBike XHR or fetch requests. The only observed XHR was Google Maps’ `maps.googleapis.com/maps/api/mapsjs/gen_204`. The initial document is sufficient to obtain the values with JavaScript disabled. The operator’s internal database, ingestion cadence and relationship between the two sites’ backend stores are undocumented. [Maintenance Portal](https://mm.linkbike.my/)

Both URLs responded to clean GET requests with no sign-in, cookies, authorization header, query string or session parameter. The sampled responses supplied neither a `Set-Cookie` nor a `Cache-Control` header. HTTP reachability establishes technical access. The station-card layout and consumer JSON have no published version, schema stability commitment, rate limit or service-level agreement. A layout or field change can break an adapter.

## Field mapping

| Normalized field | Proposed source and validation |
| --- | --- |
| `station_id` | Preserve the original string following `Station:`. Require a unique nonblank ID. Join across sources only on a validated exact ID, with the name and registry used to check the match. |
| `station_name` | Text of `p.stationInfo`. Decode HTML entities and trim display whitespace while retaining the original name. |
| `total_docks` | Integer from `Dock`. The HTML value uses class `capacity`, matches the JSON `capacity` in the paired samples, and corresponds to the consumer map's total-docks label. |
| `available_bikes` | Nonnegative integer from `Bike`, compared with the consumer JSON `availbike`. It is a reported count pending operator confirmation of rentability, operating state and observation time. A zero is meaningful as a reported value. |
| `available_docks` | Null. Neither source reports usable empty docks or a confirmed definition. Total capacity and reported bikes are insufficient to derive it. |
| `voltage` | The numeric `Volt` value is a maintenance reading. Keep it only in approved diagnostic data. Units, telemetry timing and meaning of zero are unconfirmed. It cannot indicate vehicle battery or rental availability. |
| `upstream_updated_at` | Null as a normalized inventory observation clock until its semantics and time zone are confirmed. Keep the literal page label as `upstream_updated_at_raw` for diagnostics. There is one label per HTML response and no per-station time. |
| `fetched_at` | UTC time TransitScope received this source response. Preserve across cache hits. |
| `data_status` | `UNVERIFIED` for these parsed availability snapshots. Apply the status rules below if a supported source becomes available. |
| `is_public_station` | `false` for explicitly private or test rows. Exclude the unverified mobile unit as well. `null` for unconfirmed rows. Require `true` from a verified registry before any public display. |

This sanitized diagnostic example uses one station from the first paired observation. It omits maintenance voltage and withholds coordinates until the station registry and location are verified.

```json
{
  "station_id": "2",
  "station_name": "Lebuh Light",
  "total_docks": 12,
  "available_bikes": 7,
  "available_docks": null,
  "upstream_updated_at": null,
  "upstream_updated_at_raw": "12/11/2026 08:19:38pm",
  "fetched_at": "2026-11-12T12:19:38.915Z",
  "data_status": "UNVERIFIED",
  "is_public_station": null,
  "latitude": null,
  "longitude": null
}
```

## Station scope and data quality

Each paired response in the initial series contained 31 station cards and 31 JSON records. The portal IDs were 1–29, 80 and 1023. In the first pair each ID matched one JSON row, with the same names after whitespace normalization. The audit excluded `28` Intel08 (private), `29` Intel09 (private), `80` LinkBike Mobile1 (mobile), and `1023` HQ Office Test. This leaves **27 candidate station rows**. The sources supply no public-access flag. The 27 candidates therefore do not constitute a verified public station count. [Maintenance Portal](https://mm.linkbike.my/) · [Station JSON](https://www.linkbike.my/linkbike_api/api_update_stationinfo.php)

## Repeated observations and timestamp reliability

On 12 November 2026, five paired anonymous GETs fetched the portal and consumer JSON in parallel, approximately 30 seconds apart. A sixth pair checked the voltage comparison after numeric conversion. Response time includes the connection and body transfer from the audit machine. The listed fetch times are MYT. The portal times are the displayed clock values, whose time zone is undocumented. Every displayed date was `12/11/2026`.

| Portal received (MYT) | Portal “Last Updated” | Portal HTTP / ms | Consumer JSON HTTP / ms | Portal / JSON rows | Bike-count changes from prior portal sample | Bike / dock count differences between sources |
| --- | --- | --- | --- | --- | --- | --- |
| 20:19:38.915 | 08:19:38pm | 200 / 240 | 200 / 228 | 31 / 31 | First sample | 0 / 0 |
| 20:20:09.337 | 08:20:08pm | 200 / 312 | 200 / 311 | 31 / 31 | 0 | 0 / 0 |
| 20:20:39.622 | 08:20:39pm | 200 / 223 | 200 / 205 | 31 / 31 | 0 | 0 / 0 |
| 20:21:09.915 | 08:21:09pm | 200 / 231 | 200 / 196 | 31 / 31 | 0 | 0 / 0 |
| 20:21:40.172 | 08:21:39pm | 200 / 221 | 200 / 214 | 31 / 31 | 0 | 0 / 0 |
| 20:22:35.781 | 08:22:35pm | 200 / 229 | 200 / 226 | 31 / 31 | Full comparison unavailable | 0 / 0 |

All 31 IDs joined uniquely in the initial series. No portal rows were missing an ID, name, dock count, bike count or numeric voltage. No portal bike count exceeded dock capacity. The two sources reported identical bike and total-dock counts in all six pairs. Voltage differed for 26 of 31 joined records in each pair, including after numeric conversion in the follow-up. Agreement on inventory fields does not establish that the portal uses the consumer JSON or that they share the same observation times.

The five-sample series lasted just over two minutes. Its portal label advanced each time and was within roughly 1.4 seconds of response receipt if read as MYT, while no bike count changed. Earlier direct portal observations documented in the parent audit showed station `3` (City Hall) reporting 3 bikes at `06:35:15pm` and 1 at `06:51:42pm`. The evening series and follow-up showed 5. These are changes in reported values. There was no independent field measurement, operator event log, per-station observation timestamp or documented update cadence to identify the age of the actual inventory. The near match to the request clock is consistent with a page-generation clock. Treat the label as unverified until the operator confirms its meaning. The samples demonstrate short-window reachability and count agreement only. [Parent audit](shared-micromobility-data-feasibility.md) · [Portal](https://mm.linkbike.my/)

| Status | Condition |
| --- | --- |
| `LIVE` | A supported source verifies the actual inventory observation clock. The value is recent under the agreed age limit, and the record passes validation and public-access checks. |
| `STALE` | A known inventory observation has exceeded the age limit. Suppress current availability. |
| `UNVERIFIED` | A count is retrievable, but freshness or rentability cannot be established. Use this for the sampled portal and consumer counts. |
| `UNAVAILABLE` | The source cannot be fetched or parsed into valid availability. Report the outage and suppress current availability. |
| `STATIC` | Verified station metadata only. No current availability claim. |

## Coordinates

The maintenance cards contain no latitude or longitude. The consumer map JSON is a first-party source of station coordinate candidates. For example, it reports station `2` at latitude `5.420024`, longitude `100.342431`. Station `16` has a reported longitude of `80.280467`, outside Penang, and must be quarantined from map display. The 2026 Penang Global Tourism map corroborates the existence of public docks but is illustrative. Obtain an operator- or MBPP-verified station register that matches the original IDs to approved public access and WGS84 coordinates. Store unknown or rejected coordinates as null. [LinkBike station map](https://www.linkbike.my/) · [Station JSON](https://www.linkbike.my/linkbike_api/api_update_stationinfo.php) · [Penang visitor map](https://www.mypenang.gov.my/uploads/downloads/PTM-ENG2026-1.pdf)

## Terms and data reuse

The portal footer links to Fast Rent Bike (PG)’s Privacy Policy and Personal Data Notice. Both address the handling of personal data. The Privacy Policy refers to site/app terms of use, and the public registration page includes a rider terms step. The public material inspected did not provide a feed licence, express permission for recurring automated access, or a grant for redistribution of inventory and coordinates. The audit made no registration or authenticated requests. Obtain written permission from the operator, or use its published feed under an applicable licence. Confirm approved URLs and fields, polling and retention limits, attribution, display and analysis rights, and a support contact. The operator publishes `info@fastrentbike.com` for enquiries. [Portal](https://mm.linkbike.my/) · [Privacy Policy](https://www.linkbike.my/privacypolicy) · [Personal Data Notice](https://www.linkbike.my/personaldataact) · [Registration](https://www.linkbike.my/signup) · [Operator contact](https://www.linkbike.my/)

## Recommended TransitScope integration

The repository uses Next.js App Router resource handlers and server-side adapters. The official transit adapter coalesces in-flight requests and caches by source. The rail network route returns an unavailable response with HTTP 503 and `Cache-Control: no-store` when upstream data cannot be loaded. The transit records model distinguishes source time, fetch time and feed health. Reuse those patterns with a LinkBike-specific status contract. [Transit route](../app/api/transit/route.ts) · [Official transit adapter](../lib/official-transit.ts) · [Rail network route](../app/api/rail-network/route.ts) · [Transit types](../lib/transit-data.ts)

1. **Confirm the source contract.** Ask Fast Rent Bike (PG) for a supported station-status feed, preferably a documented JSON endpoint, and confirmation of observation time, time zone, cadence, bike/dock definitions and official public station IDs. Use the portal HTML as an adapter input only if the operator approves it and agrees to stable structure and polling terms. Validate against representative operating hours and an operator-confirmed inventory change before claiming LIVE.
2. **Add a dedicated server-only adapter after approval.** Use a fixed approved upstream URL and explicit timeout and response-size limits. Validate schema, IDs, field ranges and registry membership. Quarantine invalid rows and treat an unexpected markup or schema change as an upstream failure. Keep inventory and coordinate metadata caches separate, coalesce concurrent refreshes, and honor the agreed rate limit and retention period. No client-side scraping or coupling to the bus and rail adapters is required.
3. **Expose the approved subset through `GET /api/micromobility/linkbike`.** Return station records, provenance, timestamps and source health as JSON. Use a 503 `UNAVAILABLE` response for an unusable source. Keep authorized static metadata available when inventory fails. Omit unverified availability from public counts and omit maintenance telemetry. Keep the cache lifetime and refresh strategy within the approved observation-age limit. Route, adapter, and map changes are deferred.
