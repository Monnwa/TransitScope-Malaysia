# Unified railway network

## Station loading fix

The former station request merged into `payload` only if the live vehicle payload already existed. A station-first response was silently dropped, and its one-shot request was never retried. Railway geometry was fetched separately so it could still appear without stations.

`/api/rail-network?source=rapid-rail-kl` and `?source=ktmb` now return stations and alignments together. The frontend keeps successful source snapshots separately from vehicle state and merges station complexes across sources. Vehicle refreshes, failed live requests and arrival order cannot clear these snapshots. The older bus static request also has independent state. Reload controls retry railway sources without clearing successful prior results.

## Data and rendering

All railway modes use the same RailLine, station membership, WGS84 validation, polyline and vector station rendering. routes/trips/stop_times establish membership; published stops supply positions. Cross-mode complexes with normalized identical names and nearby coordinates are merged into one marker with every line affiliation. Unrelated or differently named nearby stations are not guessed to be an interchange.

Rapid Rail uses official GTFS shapes for MRT1, MRT2, LRT Kelana Jaya, Ampang, Sri Petaling, and KL Monorail. Palette values are display choices supplied by the user, not official standards. White casing separates paths from the basemap. Markers use the higher marker pane. Every line has an independent visibility checkbox and a highlight button; station selection highlights its memberships. A shared station remains visible while at least one of its lines is enabled.

Official feeds and licensing: https://developer.data.gov.my/realtime-api/gtfs-static (CC BY 4.0). KTMB currently omits shapes.txt and trip shape_id. KTMB's route_type=0 is treated according to operator context as KTM, not LRT. Each route_id remains independent, including regional Komuter, ETS and intercity services.

For Klang Valley Komuter only, actual railway way members are retrieved from original OpenStreetMap relations:

- Port Klang / KA15_KD19: https://www.openstreetmap.org/relation/2565937
- Seremban / KC05_KB18: https://www.openstreetmap.org/relation/8390976

Relation route=train, network=KTM Komuter and ref values are checked. Only member railway=rail ways are rendered; platform and stop ways are excluded. No missing nodes or segments are bridged. Geometry must pass finite coordinates, Malaysia bounding region, adjacent point distance and official GTFS station coverage checks. Existing paths remain independent, preserving upstream track gaps. Attribution: OpenStreetMap contributors, ODbL, https://www.openstreetmap.org/copyright . These are community geometry, not KTMB survey geometry. The Port Klang relation itself carries a connectivity fixme around KL Sentral.

Other KTMB services currently have stations and independent controls but show "Stations only — geometry unavailable" where a validated shape cannot be obtained. No generic KTM corridor or station-to-station line is substituted.

## Verification and limits

2026-10-31 live API verification returned 136 merged Rapid Rail stations, six line memberships with valid shapes, and 155 KTMB stations. The two Klang Valley KTM services returned 160 and 147 original railway way paths respectively. Cross-source merging can reduce the final station count further at shared complexes.

Regression tests cover station-first arrival, 30-second vehicle refresh, manual refresh, line visibility and highlight, shared station selection, KTM separation and missing-geometry station retention. Unit tests cover cross-mode merging, distant-name collisions, KTM type classification and coordinate validation, alongside the existing MRT geometry tests. Browser fixture geometry is synthetic and isolated from production feeds.

Station aliases with different names are not automatically merged. Current scheduled departures retain the existing earliest-time display and are not live arrival predictions. Upstream geometry and service changes depend on source refreshes. Geometry absence is per line and does not suppress its stations.
