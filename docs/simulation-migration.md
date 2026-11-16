# TransitScope Malaysia simulation migration

## Audit and dependency map

The initial audit was read-only. The old demo consisted of the fixed `demoRecords` and `demoAlerts` in `lib/transit-data.ts`, selected through the dashboard mode switch and `/api/transit?mode=demo`. It supplied two buses, four rail examples, two bike hubs and one notice. The test fixtures also had synthetic data and captured evidence for historical regression checks.

| Before migration | Internal route and processing | Dashboard consumers |
| --- | --- | --- |
| Malaysia Open Data GTFS-Realtime VehiclePosition for Rapid KL Bus, MRT Feeder Bus, Rapid Penang and KTMB | `/api/transit` and `/api/bus-journey` imported `lib/official-transit.ts`. Protobuf decoding joined vehicle observations with static route and trip records. Bus processing used coordinate projection, observation history, inferred passage and timetable adherence. | Map vehicles, filters, overview indicators, charts, record table, selected bus timeline, ETA and route overlays |
| Malaysia Open Data GTFS Static ZIPs for Rapid KL Bus, MRT Feeder Bus, Rapid Penang, Rapid Rail KL and KTMB | `/api/transit?includeStatic=1`, `/api/bus-journey`, `/api/departures`, `/api/train-positions`, `/api/rail-network` and `/api/mrt-lines`. Static CSV tables supplied stops, route shapes, calendars, service frequencies and trip times. Train positions were inferred from Rapid Rail schedules and geometry. | Stop and interchange markers, railway controls, table, bus journey, departure board, train overlay and train detail |
| OpenStreetMap API KTM Komuter relations | `/api/rail-network?source=ktmb` called `lib/osm-ktm.ts` when GTFS geometry was absent. | KTM route polylines |
| Prasarana, Rapid KL and MRT Corp RSS, KTMB notices and ERL updates | `/api/alerts` fetched and classified announcements through `lib/official-alerts.ts`, including upstream robots checks. | Alerts, impact chart, selected alert detail, service notes and station operations |
| LinkBike maintenance portal and consumer station JSON | `/api/micromobility/linkbike` used `lib/linkbike.ts` and `lib/linkbike-parser.ts`. A local/preview environment gate controlled access. | LinkBike map toggle, station markers, zoom and station popups |
| Redis REST and PostgreSQL-compatible classification archive | Official bus handling could persist observation and classification evidence. The gated `/api/internal/preview/evidence-replay` route could use recorded fixtures and a replay database. | Bus analysis and diagnostics, plus development replay tooling |
| OpenStreetMap basemap tiles and browser geolocation | Leaflet and the browser accessed these independently of the transit API routes. | Map background and optional user-location marker |

## Implementation

- `lib/simulation/clock.ts` defines a shared five-second tick and seeded random generator. The same tick and seeds reproduce positions and times across the browser and local adapters. Refresh controls read the current tick. They do not regenerate random data.
- `lib/simulation/network.ts` defines the local bus routes and rail network. It reuses the existing rail line IDs, colors, station merging and Bandar Tasik Selatan / Putrajaya Sentral service relationships.
- `lib/simulation/vehicles.ts` drives both directions of each route, with station dwell, bearing, speed and operating status. Stable vehicle IDs are separate from individual trip IDs. The engine supplies the 324-bus fleet, 114 trains, bus stop progress and timing, and eight future arrivals per stop. The board and journey panels derive times from the same trips that drive vehicle positions.
- `lib/simulation/scenarios.ts` supplies four service notice categories and 27 simulated LinkBike stations. Every bike station’s count and free docks sum to its capacity. `lib/simulation/index.ts` assembles dashboard snapshots.
- `app/page.tsx` and `components/dashboard.tsx` initialize the shared clock and render the specified simulation notice. Map, search, filters, charts, tables, responsive navigation and alert detail use the snapshot. Train and LinkBike overlays retain their individual toggles.
- `components/transit-map.tsx`, `simulated-bus-panel.tsx`, `journey-map-layers.tsx`, `upcoming-departures.tsx`, `estimated-train-*.tsx` (controls, layer and panel), `linkbike-layer.tsx` and `station-operations.tsx` display simulated positions and times, and preserve stop navigation, rail line controls, popups, departure expansion and station-service filtering. `app/globals.css` styles the notice. Shared types and helpers changed in `lib/bus-journey.ts`, `rail-model.ts`, `train-position-display.ts`, `transit-data.ts` and `station-operations.ts`.
- All eight public API routes now read only local simulation data. Legacy transit mode query parameters have no effect. The internal evidence replay route returns HTTP 404. The historical provider clients and replay code remain in the repository, with no imports from active app routes or dashboard components. The migration does not require an environment flag or credentials.

## Validation

- TypeScript compilation and the Next.js production build passed using the installed project dependencies. The OneDrive workspace required running those commands outside the Windows sandbox to resolve pnpm junctions and Next.js’s native path checks.
- Three focused tests cover reproducibility, stable IDs, shared vehicle positions, journey states and preview selection, all station boards, capacity bounds, and each API adapter. The adapter check substitutes a failing external fetch and verifies that it receives no calls.
- A production Chrome smoke check exercised the Leaflet map, charts, table and search, bus progress, stop navigation and departure preview, interchanges and the eight-row board, simulated trains, LinkBike zoom and popup, alert filters and detail, and the mobile bus panel. There were no page errors. Observed request destinations were localhost and OpenStreetMap basemap tile hosts. The browser test blocked external tile responses and exercised the interactive map with its local overlays.

## Remaining limits

- Rail covers six Rapid KL lines and two Klang Valley KTM Komuter corridors. Station coordinates are approximate, the local catalog omits parts of the former GTFS inventory, and regional KTM, ETS and intercity services are outside the simulation.
- Service alerts are recurring demonstration scenarios. They do not change the vehicle movement model. ERL and TBS appear in the interchange service panel with simulated status. The model does not run their fleets.
- Leaflet uses the existing external OpenStreetMap basemap. Simulation overlays and the dashboard work with tile requests blocked.
- Public API paths remain, with simulation payloads. Consumers of the old operational payloads and legacy tests that assert live feeds, evidence replay or unverified LinkBike coverage require updates if reused.
- Production deployment is pending approval. No commit, push, deployment or Vercel configuration change was made.
