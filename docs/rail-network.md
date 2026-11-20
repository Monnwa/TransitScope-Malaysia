# Unified railway network

## Dashboard expansion, 20 November 2026

| Service | Canonical ID | Mode and service stops | Map colour | Simulated fleet |
|---|---|---|---|---:|
| ERL KLIA Ekspres Line | `erl-klia-ekspres` | ERL, 3 | Purple `#7946A3`, project display colour | 4 trains |
| ERL KLIA Transit Line | `erl-klia-transit` | ERL, 6 | Turquoise `#008B8B`, project display colour | 5 trains |
| LRT Shah Alam Line | `lrt-shah-alam` | LRT, 20 | Magenta `#FF00FF`, Prasarana GTFS | 14 trains |
| BRT Sunway Line | `brt-sunway` | Bus / BRT, 7 | Dark green `#115740`, Prasarana GTFS | 4 buses |

The checked-in [geography snapshot](../lib/data/expanded-service-geography.json) uses WGS84 `[latitude, longitude]`. [Malaysia Official GTFS Static](https://developer.data.gov.my/realtime-api/gtfs-static) (CC BY 4.0) publishes Shah Alam as route `SA` and Sunway as `BRT` in [Prasarana's Rapid Rail feed](https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl). Both directions of each route were extracted from the published trips, stop times and shapes. The Rapid Bus feed also includes Sunway as `B1000` with different platform IDs. Search maps its seven numeric IDs to the same canonical station entries. Prasarana confirms it operates Shah Alam and APAD records the start of passenger operations on 29 June 2026. Only the twenty stations present in both published directions are included. [Prasarana Rapid Rail](https://www.prasarana.com.my/rapid-rail/) · [APAD September 2026 ridership statistics](https://www.apad.gov.my/index.php/doclink/jumlah-penumpang-bulanan-perkhidmatan-rel-sem-malaysia-sept-2026/eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqdW1sYWgtcGVudW1wYW5nLWJ1bGFuYW4tcGVya2hpZG1hdGFuLXJlbC1zZW0tbWFsYXlzaWEtc2VwdC0yMDI2IiwiaWF0IjoxNzk0OTcwNTk1LCJleHAiOjE3OTUwNTY5OTV9.YHbdT5g0EXIXwIwlEUYcN_LNRFoYa1IgpndQoyp20p0)

The audited KTMB and Prasarana feeds omit ERL. Station points and codes `KE01`–`KE03` and `KT01`–`KT06` come from the Selangor Railway Map. The Ministry of Transport GIS railway layer covers only part of the corridor. Both ERL simulations use the same pair of directional paths, extracted from contiguous OpenStreetMap way segments in the Selangor map and attributed to OpenStreetMap contributors under ODbL. The map uses a dashed turquoise stroke over the purple centreline to show both services on the shared corridor. [Selangor Railway Map stations](https://services5.arcgis.com/2ZRAaoTSJbQ20ceg/arcgis/rest/services/SELANGOR_RAILWAY_MAP/FeatureServer/4) · [Selangor Railway Map alignments](https://services5.arcgis.com/2ZRAaoTSJbQ20ceg/arcgis/rest/services/SELANGOR_RAILWAY_MAP/FeatureServer/13) · [OSM outbound relation 8119876](https://www.openstreetmap.org/relation/8119876) · [OSM inbound relation 2082100](https://www.openstreetmap.org/relation/2082100) · [ODbL](https://www.openstreetmap.org/copyright)

The Ekspres simulation models the regular three-stop pattern. The operator also lists a late-night all-stations pattern outside the simulation scope. [KLIA Ekspres](https://www.kliaekspres.com/products-fares/klia-ekspres/) · [KLIA Transit](https://www.kliaekspres.com/products-fares/klia-transit/) · [Ministry of Transport](https://www.mot.gov.my/en/land/infrastructure/current-rail-services)

The canonical network reuses the existing marker IDs and positions for KL Sentral (Kelana Jaya, Monorail and KTM), Bandar Tasik Selatan (Sri Petaling and KTM), Putrajaya Sentral (MRT Putrajaya), Bandar Utama (MRT Kajang), Glenmarie (Kelana Jaya), USJ 7 (Kelana Jaya), and Setia Jaya (KTM Port Klang). The existing markers keep their simulation coordinates, which are approximate. Each new membership retains the operator-facing label, original stop ID and published coordinate separately. Both services share one marker at each KLIA terminal. Every new service stop has a source coordinate within 100 metres of its own published path in both directions. BRT's simulated boarding points are projected onto its shape for vehicle and journey display.

Positions, departure times and fleet sizes use the existing deterministic clock and carry the `SIMULATED` designation. The BRT uses the bus vehicle and journey layers with a dedicated alignment. All four service shapes and records load locally. The independent conventional bus-stop search still fetches upstream static feeds.

| Local dashboard measure | Before | With expansion |
|---|---:|---:|
| Canonical routes | 10 | 14 |
| Canonical station complexes, including BRT | 172 | 198 |
| Unique simulated stations and feeder stops | 250 | 276 |
| Simulated vehicles | 118 | 145 |
| Search records with local feeder stops and all micromobility locations | 325 | 351 |

The station total counts 26 added canonical complexes after 36 service-stop memberships are deduplicated. The dashboard combines canonical complex IDs with 78 unique feeder GTFS stop IDs, which have 85 route-specific boarding records. Route totals count distinct visible route IDs and vehicle totals count vehicle records. Shared-bike inventory continues to use the existing KPI, and universal search continues to index all 75 micromobility locations. The baseline Vitest run had 683 tests and three failures in `rail-station-popup-recovery.test.tsx`.

## Earlier static-feed integration

### Station loading fix

The former station request merged into `payload` only if the live vehicle payload already existed. A station-first response was silently dropped, and its one-shot request was never retried. Railway geometry was fetched separately so it could still appear without stations.

`/api/rail-network?source=rapid-rail-kl` and `?source=ktmb` now return stations and alignments together. The frontend keeps successful source snapshots separately from vehicle state and merges station complexes across sources. Vehicle refreshes, failed live requests and arrival order cannot clear these snapshots. The older bus static request also has independent state. Reload controls retry railway sources without clearing successful prior results.

### Data and rendering

All railway modes use the same RailLine, station membership, WGS84 validation, polyline and vector station rendering. routes/trips/stop_times establish membership; published stops supply positions. Cross-mode complexes with normalized identical names and nearby coordinates are merged into one marker with every line affiliation. Unrelated or differently named nearby stations are not guessed to be an interchange.

Rapid Rail uses official GTFS shapes for MRT1, MRT2, LRT Kelana Jaya, Ampang, Sri Petaling, and KL Monorail. Palette values are display choices supplied by the user, not official standards. White casing separates paths from the basemap. Markers use the higher marker pane. Every line has an independent visibility checkbox and a highlight button; station selection highlights its memberships. A shared station remains visible while at least one of its lines is enabled.

Official feeds and licensing: https://developer.data.gov.my/realtime-api/gtfs-static (CC BY 4.0). KTMB currently omits shapes.txt and trip shape_id. KTMB's route_type=0 is treated according to operator context as KTM, not LRT. Each route_id remains independent, including regional Komuter, ETS and intercity services.

For Klang Valley Komuter only, actual railway way members are retrieved from original OpenStreetMap relations:

- Port Klang / KA15_KD19: https://www.openstreetmap.org/relation/2565937
- Seremban / KC05_KB18: https://www.openstreetmap.org/relation/8390976

Relation route=train, network=KTM Komuter and ref values are checked. Only member railway=rail ways are rendered; platform and stop ways are excluded. No missing nodes or segments are bridged. Geometry must pass finite coordinates, Malaysia bounding region, adjacent point distance and official GTFS station coverage checks. Existing paths remain independent, preserving upstream track gaps. Attribution: OpenStreetMap contributors, ODbL, https://www.openstreetmap.org/copyright . These are community geometry, not KTMB survey geometry. The Port Klang relation itself carries a connectivity fixme around KL Sentral.

Other KTMB services currently have stations and independent controls but show "Stations only — geometry unavailable" where a validated shape cannot be obtained. No generic KTM corridor or station-to-station line is substituted.

### Verification and limits

2026-10-31 live API verification returned 136 merged Rapid Rail stations, six line memberships with valid shapes, and 155 KTMB stations. The two Klang Valley KTM services returned 160 and 147 original railway way paths respectively. Cross-source merging can reduce the final station count further at shared complexes.

Regression tests cover station-first arrival, 30-second vehicle refresh, manual refresh, line visibility and highlight, shared station selection, KTM separation and missing-geometry station retention. Unit tests cover cross-mode merging, distant-name collisions, KTM type classification and coordinate validation, alongside the existing MRT geometry tests. Browser fixture geometry is synthetic and isolated from production feeds.

Station aliases with different names are not automatically merged. Current scheduled departures retain the existing earliest-time display and are not live arrival predictions. Upstream geometry and service changes depend on source refreshes. Geometry absence is per line and does not suppress its stations.
