# Data sources and integration status

## Implementation status

This release has no connected Malaysian transport provider feed. It uses a deterministic local dataset with fictional identifiers such as `DEMO-BUS-101`; values are clearly marked SIMULATED. Static rail station references are marked SCHEDULED demonstration references. No live endpoint, credential, rate limit or licence has been invented.

## Verified standards and prospective adapters

| Provider / standard | URL | Data type and fields | Update / auth | Licence / limitation |
| --- | --- | --- | --- | --- |
| GTFS Schedule | https://gtfs.org/documentation/schedule/reference/ | Static agencies, routes, trips, stops, shapes and times. | Publisher-defined; not an API. | Feed publisher specifies licence. No verified KL feed connected. |
| GTFS Realtime | https://gtfs.org/documentation/realtime/reference/ | VehiclePosition, TripUpdate and Alert entities. | Publisher-defined HTTP feed; auth publisher-defined. | Must relate to a GTFS feed. No verified Malaysian endpoint connected. |
| GBFS | https://www.gbfs.org/documentation/ | Station information, station status and free-floating vehicle status. | Provider-defined, usually frequent JSON refreshes. | Provider defines access and licence. No verified Kuala Lumpur GBFS endpoint connected. |
| OpenStreetMap | https://www.openstreetmap.org/copyright | Basemap tiles and attribution. | Public tiles subject to usage policy; no credentials in this app. | Open Database License / attribution required. |

## Adapter contract

The common model records identifier, mode, operator, route, station, coordinates, report timestamp, data source, freshness, status and data mode. Future provider adapters should map GTFS static, GTFS-RT VehiclePosition, TripUpdate and Alert, and GBFS station or vehicle data to this model. A failed live source must remain unavailable or stale; it must never switch silently to the simulation.
