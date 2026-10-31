# Data sources and integration status

## Implementation status

TransitScope now integrates Malaysia's Official Open API server-side. Successful GTFS-Realtime requests appear as LIVE only after Protocol Buffer decoding and coordinate validation. GTFS ZIP downloads provide STATIC stop, route and trip context. The optional local dataset uses fictional identifiers such as `DEMO-BUS-101` and appears only when the user explicitly selects demonstration mode. A failed official feed remains UNAVAILABLE or STALE; it never silently becomes demonstration data.

## Verified standards and prospective adapters

| Provider / standard | URL | Data type and fields | Update / auth | Licence / limitation |
| --- | --- | --- | --- | --- |
| Malaysia Open API GTFS-Realtime | https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl | VehiclePosition protobuf: vehicle, trip, route, position and timestamp. Rapid KL Bus, MRT Feeder, Rapid Penang and KTMB are integrated. | 30-second updates; no API token; app refreshes at most every 30 seconds. | CC BY 4.0. Current API supplies vehicle positions only, not official alerts or trip updates. |
| Malaysia Open API GTFS Static | https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl | ZIP GTFS: agency, routes, stops, trips, stop_times, calendar and shapes when published. Rapid KL Bus, MRT Feeder, Rapid Rail KL, Rapid Penang and KTMB sources are processed. | KTMB daily 00:01; others as required. Server cache refreshes every 24 hours. | CC BY 4.0. Not a source of live vehicle locations or arrival predictions. |
| GTFS Schedule | https://gtfs.org/documentation/schedule/reference/ | Static agencies, routes, trips, stops, shapes and times. | Standard reference. | Used to interpret published static feeds. |
| GTFS Realtime | https://gtfs.org/documentation/realtime/reference/ | VehiclePosition, TripUpdate and Alert entities. | Standard reference. | The selected Malaysian source currently supplies VehiclePosition only. |
| GBFS | https://www.gbfs.org/documentation/ | Station information, station status and free-floating vehicle status. | Provider-defined, usually frequent JSON refreshes. | No accessible verified Malaysian GBFS feed was identified for this implementation; bike availability stays unavailable. |
| OpenStreetMap | https://www.openstreetmap.org/copyright | Basemap tiles and attribution. | Public tiles subject to usage policy; no credentials in this app. | Open Database License / attribution required. |

## Endpoint and limitation notes

- Rapid KL Bus: `https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl`
- MRT Feeder Bus: `https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder`
- KTMB: `https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb`
- Rapid Penang: `https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-penang`
- The official documentation warns that Rapid KL Rail does not yet have stable realtime feeds. TransitScope therefore treats it as STATIC station information only.
- The official documentation notes legacy Rapid Penang route/trip ID mismatches. TransitScope retains the published ID if a static match is unavailable.

## Adapter contract

The common model records identifier, mode, operator, route, station, coordinates, report timestamp, data source, freshness, status and data mode. Future provider adapters should map GTFS static, GTFS-RT VehiclePosition, TripUpdate and Alert, and GBFS station or vehicle data to this model. A failed live source must remain unavailable or stale; it must never switch silently to the simulation.
