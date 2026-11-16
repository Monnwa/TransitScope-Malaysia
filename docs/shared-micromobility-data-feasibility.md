# Shared micromobility data feasibility audit

**TransitScope Malaysia · 12 November 2026 (MYT)**

Scope covers public shared conventional bicycles, e-bikes, e-scooters and other micromobility vehicles. This is a read-only audit of the working tree and publicly exposed sources. An operator’s presence, a reachable endpoint, verified rental availability and permission to publish the data each require their own evidence.

## Operator coverage and decisions

**NO-GO for a live rollout.** LinkBike, Beam and TRYKE qualify for provider outreach. A **GO** requires a supported feed, verified coverage and freshness, and a licence or agreement covering TransitScope’s use. **CONDITIONAL GO** means the provider is a candidate for outreach and a scoped pilot after validation. **NO-GO** means the current evidence is insufficient to advance a provider to integration.

| Operator | Malaysian coverage and vehicle type | Public location and availability data | Decision |
| --- | --- | --- | --- |
| LinkBike | George Town and surrounding areas on Penang Island, including Bayan Baru in the council’s published programme. Docked conventional bicycles. | Anonymous station JSON exposes station coordinates, capacity and a bike count. Freshness, public station membership, free docks and reuse rights are unverified. [Operator map](https://www.linkbike.my/) · [Council programme](https://www.mbpp.gov.my/en/services/jabatan/jabatan-pesuruhjaya-bangunan?catid=86%3Abandar-mesra-usia&id=595%3Abandar-mesra-usia&showall=1&view=article) | **CONDITIONAL GO** for a supported, licensed station feed. |
| Beam Mobility | Officially documented e-scooter sandbox in SS15, Subang Jaya, Selangor. Other marketed regions and past sites require confirmation. | Rider app and a published partnership channel. No Malaysian public GBFS, documented inventory API, vehicle coordinates, available inventory or reuse licence located. [MBSJ bulletin, p. 28](https://www.mbsj.gov.my/sites/default/files/FA%20Buletin%20Bandar%20Raya%20EDISI%201%202026%20Majalah.pdf#page=28) · [Beam Malaysia partnerships](https://partner.ridebeam.com/my/partners) | **CONDITIONAL GO** for an SS15 agreement and pilot. |
| OoGyaa | Historical e-scooter evidence for Kuala Lumpur and Petaling Jaya. Current cities and fleet unverified. | Public holding page and contact address. No public API/GBFS or current vehicle data located. [OoGyaa](https://www.oogyaa.com/) · [MIROS sandbox announcement](https://miros.gov.my/xs/dl.php?filename=KENYATAAN+MEDIA_Micromobility+Day+2023.pdf) | **NO-GO** pending verified service and supported data access. |
| Anywheel / Anywheels | Historical Penang and Shah Alam pilots involving e-scooters and e-bikes. Current app listing does not list Malaysia. | No Malaysian public API/GBFS or available inventory located. [MIROS/Futurise report, §2.4.1](https://www.futurise.com.my/wp-content/uploads/2024/01/Unlocking-the-Potential-of-Micromobility-in-Malaysia.pdf) · [Operator’s app listing](https://play.google.com/store/apps/details?id=com.ytyiot.ebike.anywheel) | **NO-GO** pending verified service and supported data access. |
| Neuron | Historical Cyberjaya e-scooter pilot. Current Malaysian service unverified. | No Malaysian public API/GBFS or available inventory located. [MIROS/Futurise report, §2.4.1](https://www.futurise.com.my/wp-content/uploads/2024/01/Unlocking-the-Potential-of-Micromobility-in-Malaysia.pdf) · [Neuron impact report](https://www.rideneuron.com/wp-content/uploads/2025/03/IMPACT-REPORT-2023-2024-Driving-a-Better-Future.pdf) | **NO-GO** pending verified service and supported data access. |
| Zeus | Catalogued Kuala Lumpur e-scooter system. Current rental operation unverified. | Anonymous GBFS v2.2. All 47 listed vehicles are disabled, with observation times from 2022–2024. Feed licence unspecified. [Catalog](https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv) · [Vehicle status](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/free_bike_status.json) | **NO-GO** pending a verified operating fleet, fresh data and reuse permission. |
| TRYKE | Perbadanan Putrajaya identifies Phase 2 as operating. Shared e-scooters and e-bikes in designated Putrajaya zones, with virtual parking hubs. | Authority describes an in-app live map. No publicly documented GBFS or reusable inventory API located. [Putrajaya Smart City](https://smart.putrajaya.my/en/initiatives/tryke-micromobility/) | **CONDITIONAL GO** for a Putrajaya agreement and pilot. |

The audit used public catalog, operator, authority and public website sources. It checked ordinary, anonymous web responses and documented public client behavior. No operator has confirmed terms or supplied credentials for this audit.

## Existing TransitScope architecture

| Area | Working-tree implementation |
| --- | --- |
| API routes | Next.js App Router GET handlers live under `app/api/<resource>/route.ts`. `/api/transit` is a dynamic Node.js route. It serves official updates by default, static records with `includeStatic=1`, and the deterministic demo with `mode=demo`. Rail network, departures, alerts, bus journeys and estimated train positions have their own routes. [Transit handler](../app/api/transit/route.ts) · [Rail network handler](../app/api/rail-network/route.ts) · [Departures handler](../app/api/departures/route.ts) |
| GTFS Static | The server fetches official Malaysia Open API ZIPs, reads their tables with JSZip, and builds stop, route, trip, calendar, timetable and shape indexes as available. Sources cover Rapid KL Bus, MRT Feeder, Rapid Penang, Rapid Rail KL and KTMB. Rail stations and line geometry have a separate loading path with station merge and validated geometry. [GTFS adapters](../lib/official-transit.ts) · [Rail network](../lib/rail-network.ts) · [Rail client](../components/use-rail-network.ts) |
| GTFS-Realtime | The server decodes official VehiclePosition protobufs for Rapid KL Bus, MRT Feeder, Rapid Penang and KTMB, validates position and retains the vehicle observation time and feed header time separately. Cached GTFS Static can enrich route and trip context. Bus updates also feed existing journey and progress processing. Rapid Rail train positions are timetable-derived estimates on a separate route. [GTFS adapters](../lib/official-transit.ts) · [Observation validation](../lib/vehicle-observation.ts) · [Train position handler](../app/api/train-positions/route.ts) |
| Caching | Per-source process memory caches GTFS Static for 24 hours and successful GTFS-Realtime results for 30 seconds. In-flight requests are coalesced per source. Upstream binary fetches use a timeout and `no-store`. Failed realtime fetches return empty source records with stale or unavailable feed health. The live transit response is `no-store`, supports gzip and has a payload size cap. The static transit response uses a 30-second HTTP cache and 60-second stale-while-revalidate. Rail geometry and official alerts have independent cache policies. The dashboard polls transit every 30 seconds and stores static and rail results independently of live responses. [GTFS adapters](../lib/official-transit.ts) · [Transit handler](../app/api/transit/route.ts) · [Live response](../lib/transit-response.ts) · [Alerts cache](../lib/official-alerts.ts) · [Dashboard](../components/dashboard.tsx) |
| Data states | `DataMode` includes `LIVE`, `STATIC`, `SIMULATED`, `UNAVAILABLE`, `STALE`, `SCHEDULED` and `UNKNOWN`. Official vehicle records use `LIVE`. Map rendering separately checks each vehicle clock and labels missing or delayed observations. `STATIC` identifies published stops or timetable data. `SIMULATED` is selected explicitly through demo mode. `FeedHealth` carries healthy, stale or unavailable state and source/last-success timestamps. Train estimates have a separate `ESTIMATED` model. [Transit data types](../lib/transit-data.ts) · [Map](../components/transit-map.tsx) · [Train position model](../lib/train-positions.ts) |
| Map and shared bikes | The client loads Leaflet dynamically. The map has an OpenStreetMap basemap, rail polylines and station circles, bus/vehicle markers, selected journey layers and a separate estimated-train overlay. The transit model has a `Shared bike` mode and optional bike/dock counts. Its two shared-bike records are demo hubs, rendered through the common map. The shared-bike KPI shows station information as unavailable. Repository search found no GBFS handler, live shared-bike adapter or independent micromobility layer. [Dashboard](../components/dashboard.tsx) · [Map](../components/transit-map.tsx) · [Journey layers](../components/journey-map-layers.tsx) · [Demo records](../lib/transit-data.ts) |

The [official GTFS Static](https://developer.data.gov.my/realtime-api/gtfs-static) and [GTFS-Realtime](https://developer.data.gov.my/realtime-api/gtfs-realtime) references describe the transport datasets used today. Their licences apply to their respective feeds.

## MobilityData GBFS catalog and Zeus feed

The official catalog CSV returned HTTP 200 on 12 November 2026. Parsing by `Country Code` returned **one exact `MY` match across 1,279 system records**. The row identifies **Zeus Kuala Lumpur**, primary city **Kuala Lumpur**, system ID `zeus_kuala lumpur`, GBFS **2.2** and operator site `https://zeusscooters.com/`. The three catalog authentication fields are blank. Catalog absence leaves open the possibility of a privately contracted or unlisted feed. [Pinned MobilityData Systems Catalog](https://github.com/MobilityData/gbfs/blob/2d011cd0fff70c6dc7b6767215fec00bf50f5cc8/systems.csv) · [Zeus Scooters](https://zeusscooters.com/)

The auto-discovery URL is `https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/gbfs.json`. Anonymous GETs returned HTTP 200 and `application/json; charset=utf-8` for discovery and all six linked feeds. Discovery published one English listing at **18:51:51 MYT**. All six feed envelopes in the inspected snapshot carried version **2.2**, `ttl=0` and `last_updated=1794480729` (**18:52:09 MYT**, 12 November 2026). Repeated GETs showed advancing envelope times. Requests with a cross-origin `Origin` header returned no `Access-Control-Allow-Origin` or rate-limit headers. Rate limits remain undocumented.

| Feed | HTTP | Snapshot evidence |
| --- | --- | --- |
| [`gbfs.json`](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/gbfs.json) | 200 | English discovery lists six feeds. |
| [`system_information.json`](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/system_information.json) | 200 | Reports `Zeus Scooters`, catalog system ID, `Asia/Kuala_Lumpur` and operator support contact. No feed licence or terms declared. Failed schema validation because the optional phone number and both rental app objects were present with null values. |
| `station_information.json` | — | Absent from discovery. No station registry available to validate. |
| `station_status.json` | — | Absent from discovery. No station inventory available to validate. |
| [`free_bike_status.json`](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/free_bike_status.json) | 200 | GBFS v2.2 uses this name for the feed called `vehicle_status` in v3. All 47 records carry coordinates and type `yimi_plus_3`, all are disabled and none are reserved. Vehicle `last_reported` values span 1 January 2022 07:53:28 to 13 July 2024 21:38:59 MYT. Zero vehicles in this response qualify as current rentable inventory. |
| [`vehicle_types.json`](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/vehicle_types.json) | 200 | Two scooter types, `yimi_plus_2` and `yimi_plus_3`, both declared `electric_assist` with 35 km maximum range. |
| [`geofencing_zones.json`](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/geofencing_zones.json) | 200 | One GeoJSON feature with riding and through-travel rule fields. Current geographic applicability unverified. |
| [`gbfs_versions.json`](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/gbfs_versions.json) | 200 | Lists 2.2 only. |
| [`system_pricing_plans.json`](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/system_pricing_plans.json) | 200 | Three EUR plans. Local tariffs unverified. |

Discovery, versions, vehicle types, vehicle status, geofencing and pricing passed checks against MobilityData’s GBFS v2.2 JSON schemas. Schema conformance checks structure. A current envelope and conforming vehicle file can still contain years-old locations. [Official GBFS v2.2 schemas](https://github.com/MobilityData/gbfs-json-schema/tree/master/v2.2)

Zeus’s current cities page omits Malaysia. MIROS proceedings mention Zeus among historical Malaysian operators. The old vehicle observations and disabled flags leave present operation and rentable fleet size unverified. The rental terms supply no feed redistribution grant. The feed declares GBFS 2.2, so the licence defaults introduced in v3 do not establish permission for this feed. [Zeus cities](https://zeusscooters.com/cities/) · [MIROS proceedings](https://www.miros.gov.my/xs/dl.php?filename=%28FA%29_eProsiding+Refleksiminar+2022.pdf) · [Zeus rental terms](https://zeusscooters.com/terms-and-conditions/) · [GBFS licensing](https://gbfs.org/documentation/reference/#licensing)

## LinkBike public website and station data

The [main operator site](https://www.linkbike.my/) advertises docked bicycles and shows a public station map. Penang Global Tourism identifies coverage in George Town and nearby neighbourhoods, and its 2026 visitor map identifies docking stations. The council’s programme page also names Bayan Baru. Published station counts and site rows cover different scopes and dates. The current set of public, installed stations needs operator confirmation. [Penang Global Tourism transport guide](https://mypenang.gov.my/abt_png.php?id=WjRiaEVUSWxRdERPNzFRYnlxNEdBdz09) · [2026 visitor map](https://www.mypenang.gov.my/uploads/downloads/PTM-ENG2026-1.pdf)

The homepage includes inline marker definitions with station ID/name, coordinates, dock capacity and bike counts. Its public Google Maps callback `center_changed` invokes `UpdateStation()`, which uses a same-origin GET to `https://www.linkbike.my/linkbike_api/api_update_stationinfo.php`. A direct anonymous browser visit returned a JSON array of **31 rows** with no sign-in, key or query parameters. The homepage, maintenance page and endpoint each returned HTTP 200 with `Content-Type: text/html; charset=UTF-8` in the header check. This is an undocumented first-party website backing endpoint. The 31 rows include private/mobile/test labels and are unsuitable as a public station count. [Public station endpoint](https://www.linkbike.my/linkbike_api/api_update_stationinfo.php)

| JSON key | Observed type and meaning |
| --- | --- |
| `StId` | String station identifier. The snapshot contains duplicate placeholder `"0"` values. |
| `name` | String display name. Labels alone cannot verify public access. |
| `lat`, `lng` | Numeric strings for station coordinates. At least one longitude falls outside Penang, so geographic validation is necessary. |
| `capacity` | Numeric string displayed on the map as total docks. A separate free-dock value was absent. |
| `availbike` | Numeric string displayed as available bikes. Rentability semantics and operating-state flags require operator confirmation. |
| `volt` | String maintenance reading. Omit from public display and analytics. |

The separately hosted maintenance landing page renders an HTML table with station numbers and names, dock and bike counts, voltage and a single page-level update time. On 12 November 2026, the City Hall bike count changed from 3 to 1 between the portal’s `06:35:15pm` and `06:51:42pm` snapshots. The portal does not document its time zone or per-station clocks. The station JSON itself had no timestamp, station access, rental or return flags. The HTML portal timestamp cannot establish JSON observation age. The data also lack individual bike positions and verified free docks. [Public maintenance page](https://mm.linkbike.my/)

The ordinary website request is same-origin. A request with a cross-origin `Origin` header returned no `Access-Control-Allow-Origin` or rate-limit headers. Direct browser access from the TransitScope origin is unverified, and polling limits and SLA remain undocumented. LinkBike’s privacy policy supplies no station-data reuse licence. Ask Fast Rent Bike (PG) at `info@fastrentbike.com` and MBPP for an approved public station register and a supported station endpoint. Request stable IDs, public access and operational flags, WGS84 coordinates, bike counts by type, actual usable free docks, total capacity, time zone-qualified observation timestamps, polling limits and written display, cache and analysis rights. A production adapter requires these confirmations and a supported feed. [Operator contact](https://www.linkbike.my/) · [LinkBike privacy policy](https://www.linkbike.my/privacypolicy)

## Beam integration feasibility

The strongest deployment evidence is the **SS15 commercial-area sandbox in Subang Jaya**. MBSJ names Beam as operator and reports the 18 March 2026 opening at SS15 LRT, with 45 e-scooters across three designated parking points at launch. The ministry-approved trial window runs from 1 February 2025 through 31 January 2027. The launch count is a dated figure. Current availability and operation beyond that window require confirmation. MBSJ describes geofenced operating areas and parking points. [MBSJ bulletin, p. 28](https://www.mbsj.gov.my/sites/default/files/FA%20Buletin%20Bandar%20Raya%20EDISI%201%202026%20Majalah.pdf#page=28)

Beam's Malaysia site lists a broad footprint. Its earlier releases describe cities such as Kuala Lumpur, Ampang Jaya, Petaling Jaya, Shah Alam, Kuantan and Langkawi and university rollouts. Those pages establish marketed or dated deployment evidence. Dungun's 5 May 2026 council visit was a feasibility assessment for e-scooters and e-bikes. Shared e-scooters are documented in the confirmed SS15 scope. Current Malaysian e-bike deployment or further active service areas were unverified. [Beam Malaysia](https://ridebeam.com/my) · [2023 six-city announcement](https://www.ridebeam.com/newsroom/wheels-turn-for-micromobility-in-malaysia-as-beam-now-operational-in-six-cities) · [Campus announcements](https://ridebeam.com/newsroom/beam-mobility-partners-malaysian-universities-for-car-free-commutes) · [Dungun council](https://mpd.gov.my/index.php/en/dmc/media-centre/news/lawatan-tapak-bersama-beam-mobility-malaysia-di-kawasan-operasi-mpd)

The official rider guide directs riders to the app to locate vehicles. Beam has a transit/MaaS partnership channel and supplied ridership data for a 2023 government sandbox. No public Malaysia API documentation, GBFS URL, vehicle locations, available inventory or reuse licence was found through these sources. Beam's Malaysia terms §§5.1–5.2 restrict use of site/app materials without permission. A provider-approved public feed or partner agreement is required for TransitScope. [Rider guide](https://www.ridebeam.com/my/rider) · [Beam partnership page](https://partner.ridebeam.com/my/partners) · [Government sandbox partnership](https://ridebeam.com/newsroom/beam-under-mot-national-regulatory-sandbox-for-e-scooter) · [Malaysia terms](https://ridebeam.com/terms-of-service/malaysia)

Beam publishes `partnerships@ridebeam.com` for partnership enquiries. The SS15 request should cover the following.

- **Coverage and access.** Current public service areas with provider, market and system IDs, operating dates and hours, service status, geofences and designated parking areas. Confirm public versus restricted access and the programme end date.
- **Vehicles.** Public, rotating vehicle ID, type and propulsion, WGS84 coordinates for accessible idle vehicles, source observation time and verified rentable, reserved and disabled flags. Request charge/range only if its definition and availability are documented.
- **Stations and hubs.** Stable hub IDs, coordinates or parking-zone geometry, public access and operational flags, rentable counts by type, usable free docks and capacity where physical docking exists.
- **Feed contract.** Approved URLs and schema/version, snapshot publication time and TTL, refresh cadence, rate limits, authentication method, known outage and empty-inventory semantics, support contact and SLA. Request permission for polling, caching, display, attribution, aggregated analysis and retention. Exclude active-rental positions, trip histories and rider identifiers.

## Other operator verification

- **OoGyaa.** A 2022 operator interview and April 2023 launch coverage describe historical e-scooters in Kuala Lumpur and near Taman Jaya LRT in Petaling Jaya. Petaling Jaya coverage refers to a joint Zeus OoGyaa rider app. MIROS named OoGyaa as a participant in developing the 2023 sandbox guidance. The operator site now displays a holding page. Current service areas, fleet and reusable data access remain unverified. [Operator interview](https://theedgemalaysia.com/node/637344) · [Petaling Jaya launch](https://www.thestar.com.my/metro/metro-news/2023/04/29/escooters-to-help-with-last-mile-connectivity-in-pj) · [Joint rider app coverage](https://www.lowyat.net/2023/299028/kumpool-petaling-jaya-pj/autoload/) · [MIROS announcement](https://miros.gov.my/xs/dl.php?filename=KENYATAAN+MEDIA_Micromobility+Day+2023.pdf) · [Operator site](https://www.oogyaa.com/)
- **Anywheel / Anywheels.** The MIROS/Futurise study describes pilots in Penang and Shah Alam and reports that deployments ceased by 2020. Its descriptions of the operator are internally inconsistent, so the pilots are historical evidence. The operator’s app listing names Singapore, Thailand and Vietnam. No current Malaysian city, API access or rentable fleet was corroborated. [MIROS/Futurise study, §2.4.1](https://www.futurise.com.my/wp-content/uploads/2024/01/Unlocking-the-Potential-of-Micromobility-in-Malaysia.pdf) · [Operator’s app listing](https://play.google.com/store/apps/details?id=com.ytyiot.ebike.anywheel)
- **Neuron.** The same study identifies a historical Cyberjaya Living Lab e-scooter pilot and a cessation by 2020. Neuron’s 2023/24 impact report omits Malaysia. Public evidence of Neuron’s map integrations in other markets does not establish a Malaysian feed. [MIROS/Futurise study, §2.4.1](https://www.futurise.com.my/wp-content/uploads/2024/01/Unlocking-the-Potential-of-Micromobility-in-Malaysia.pdf) · [Neuron impact report](https://www.rideneuron.com/wp-content/uploads/2025/03/IMPACT-REPORT-2023-2024-Driving-a-Better-Future.pdf) · [Neuron map partnership](https://www.rideneuron.com/neuron-is-now-integrated-with-google-maps/)
- **Zeus.** Kuala Lumpur has a public GBFS listing and historical operator evidence. The observed vehicle data are unusable for current operations or first/last-mile analysis for the reasons documented above. [System information](https://zeus.city/api/v1/mds/gbfs/kuala%20lumpur/system_information.json)
- **TRYKE.** Perbadanan Putrajaya’s register marks the initiative and its second phase as operating, with e-scooters and e-bikes near the lake and designated commercial areas. Its report dates Phase 2 to 1 August 2025 and describes station plans for Anjung Floria, Millennium Monument and Taman Wawasan. TRYKE’s August 2025 operator page also mentions Cyberjaya, KLCC/Bukit Bintang and selected Gamuda sites. Treat those as dated operator reports and reconfirm before expansion. A separate station-return e-motorbike product has eligibility requirements and is outside the proposed initial scope. Start with a Putrajaya-only request for a supported fleet or hub feed. The public authority page describes app access and TRYKE’s terms do not establish third-party feed rights. [Putrajaya initiative](https://smart.putrajaya.my/en/initiatives/tryke-micromobility/) · [Authority report, §3.3](https://www.ppj.gov.my/storage/laporan04/855/855.pdf) · [Operator locations](https://www.tryke.co/post/tryke-micromobility-service-in-malaysia) · [Motorbike service](https://www.tryke.co/motorbike) · [Rider terms](https://www.tryke.co/terms-conditions)

## Licensing and access criteria

Before implementing an adapter, record who controls the dataset and the applicable licence or signed agreement. Confirm the allowed fields, geographic scope, third-party display, attribution, polling quotas, access method, cache/retention limits, derived analyses and terms for termination or changes. Confirm whether source URLs and attribution can be shown without disclosing credentials. Keep authenticated access server-side. Public website and app display, a transport operating approval and an HTTP 200 each establish different facts from a data reuse grant.

Add an external dependency only after a provider clears these criteria and the approved data fill a verified user need. Prefer a versioned GBFS feed for standard location and inventory fields. A documented partner API is appropriate where it provides comparable fields and predictable access. Static station locations can qualify independently if they have a licensed registry and verified public access. Current counts require a supported status feed with trustworthy timestamps.

## Proposed normalized data model

One record represents a provider-reported rental station or one provider-reported vehicle. A record can retain an identifier with null coordinates for diagnostics. The map requires a validated WGS84 coordinate pair. Use provider- and system-scoped IDs. Use `vehicleId` as a snapshot key when a provider rotates it. Keep virtual parking areas and geofences as system-level geometry.

```ts
type MicromobilityVehicleType =
  | "bicycle"
  | "electric_bicycle"
  | "electric_scooter"
  | "other";

type MicromobilityDataStatus =
  | "LIVE"
  | "STATIC"
  | "STALE"
  | "UNAVAILABLE"
  | "SIMULATED";

interface SharedMicromobilityRecord {
  providerId: string;
  systemId: string;
  kind: "station" | "vehicle";
  systemType: "docked" | "free_floating" | "hybrid" | null;
  vehicleId: string | null;
  stationId: string | null;
  vehicleType: MicromobilityVehicleType | null;
  latitude: number | null;
  longitude: number | null;
  bikesAvailable: number | null;
  docksAvailable: number | null;
  isReserved: boolean | null;
  isDisabled: boolean | null;
  lastUpdated: string | null;
  sourceTimestamp: string | null;
  dataStatus: MicromobilityDataStatus;
  sourceUrl: string | null;
  sourceReportedAt?: string | null;
  vehiclesAvailable?: number | null;
  vehiclesAvailableByType?: Partial<Record<MicromobilityVehicleType, number>>;
}
```

- **Identity and location.** Require `stationId` on station records and `vehicleId` on vehicle records. Use station coordinates from a verified registry or `station_information`. A vehicle’s optional station association comes from the provider. Require the provider's own vehicle coordinates for a vehicle marker. When a vehicle lacks coordinates, leave both null.
- **Availability.** Join station status to station information by `stationId`. Store the station total in `vehiclesAvailable` and type-level counts when the source identifies those types. Populate `bikesAvailable` only for verified conventional/electric bicycle inventory, including verified bike-only station totals. Store verified free docks in `docksAvailable`. Published capacity is separate metadata. Check station rental/return flags before displaying rentable inventory or return availability. On individual vehicles retain the source's reservation and disablement flags. Display a vehicle as rentable only when eligibility is verified, including reservation, disablement and accessible service status. Preserve a verified zero as zero and missing values as null or omitted.
- **Time and provenance.** Decode clocks according to the feed version and normalize to ISO 8601 UTC. GBFS v2.2 uses epoch seconds. The current reference uses timestamp strings. Display times in MYT. `lastUpdated` is the time TransitScope last accepted the upstream record. `sourceTimestamp` is the upstream feed or snapshot publication time. `sourceReportedAt` is the provider's station/vehicle observation time when supplied. Preserve all three on a cache hit. `sourceUrl` is an approved public feed or documentation URL with no credentials.
- **Status.** Use `LIVE` for current verified observations and `STATIC` for verified published geometry or metadata. Use `STALE` for aged observations and `UNAVAILABLE` for absent, invalid or unverified data. Clear rentable counts and vehicle availability on stale/unavailable responses. Keep `SIMULATED` confined to explicitly selected demonstration data or test fixtures. [GBFS current reference](https://gbfs.org/documentation/reference/) · [GBFS versioned specifications](https://gbfs.org/documentation/)

## Proposed independent map layer

1. **Server adapter and route.** Once a provider qualifies, add an independent same-origin GET route, proposed as `/api/micromobility`, backed by server-only adapters with approved source URLs. Fetch static and availability endpoints independently. Validate the declared GBFS version or contract schema with Zod, check response size, clocks, coordinates, counts and ID joins, and isolate per-provider failures. Return validated records plus source health, including latest successful fetch, publication time and freshness. A validated empty snapshot can return zero inventory within its confirmed scope. Track failed and unverified sources through health metadata, with an unavailable response when all requested sources fail.
2. **Independent cache and refresh.** Cache static metadata separately from availability per provider/system/endpoint, coalesce refreshes, and observe upstream TTL, documented rate limits and agreed retention. Use bounded timeouts and backoff for upstream failures. Set a provider-specific freshness threshold from the update contract. Cap GBFS near-realtime data at five minutes, applying any tighter threshold. Check feed and per-record clocks when present, including future skew. Require a trustworthy source clock under the provider contract. A fetch receipt alone cannot establish freshness. A good prior station registry can remain visible through a status outage while availability expires. [GBFS data quality and latency](https://gbfs.org/documentation/data-quality/)
3. **Leaflet overlay.** Add a toggle labelled **Shared micromobility**, with dedicated station and vehicle groups and their own selection state. Use distinct shapes and text for docked stations and free-floating vehicles. Show virtual parking zones and geofences separately if available and useful. Provide provider and vehicle-type filters, including support for stations that publish multiple types and a visible unknown-type state. Station details show verified bikes and free docks, when reported. Vehicle details show type and verified availability. Both show provider attribution, source time and a clear freshness or unavailable message. Keep the overlay out of transit records, bus markers, bus journey selection, rail filters and transit KPIs.
4. **Performance and access.** Start with the overlay off. Fetch only while enabled and the page is visible. Abort superseded requests, limit updates to the selected provider and viewport, and cluster or summarize dense points at low zoom. Keep the station/vehicle groups independent of the bus refresh cycle. Give controls and details keyboard access, accessible text labels and touch-sized targets. Test on a mobile viewport with transit layers and the overlay enabled, including filter and selection behavior during refresh and outages.

## First-mile / last-mile analysis proposal

Use validated GTFS locations for MRT, LRT, Monorail and KTM station complexes and for bus stops. Use stable source and stop IDs, deduplicate interchanges and grouped boarding points where justified, and record the GTFS snapshot date and geographic scope. Use only approved, fresh micromobility snapshots from the same analysis window. Report separately for transit mode, geography, time window, provider and vehicle type. The Malaysian official GTFS Static datasets currently carry CC BY 4.0 attribution requirements. [Malaysia Official Open API GTFS Static](https://developer.data.gov.my/realtime-api/gtfs-static)

| Metric | Proposed method |
| --- | --- |
| Rentable vehicles within 300 m, 500 m and 1 km | Calculate WGS84 geodesic distances to free-floating vehicle points and to eligible station locations weighted by verified rentable counts. Prefer mapped station entrances where verified. Exclude docked vehicle rows already represented in station totals. Deduplicate within each transit catchment. Overlapping catchments may share a vehicle, so deduplicate again for regional totals. |
| Transit stop and station coverage | For each radius, divide the number of eligible transit stops or complexes with at least one verified rentable vehicle by the number with observable provider coverage. Publish the eligible count, full in-scope transit denominator and unknown-data count. Classify zero availability only when data are fresh and complete for the providers and locations included in that measure. |
| Spatial gaps | Map verified zero-availability areas and measure recurrence across defined weekday/weekend and time-of-day samples. Show unobserved areas separately. Geodesic radii measure proximity. A later walking-network analysis can account for access points and barriers if an appropriate network is available and licensed. Before evaluating routes by scooter or e-bike, validate permitted links and operating zones with the provider and relevant authority. |
| Provider distribution | Aggregate fresh point counts and verified station inventory by agreed geography, provider and type. Publish coverage area, snapshot window, missing data and retention method. Use approved aggregate retention and avoid vehicle trajectories. |

No metrics were computed in this audit.

## Recommended phases

1. **Confirm service and rights.** Prioritize LinkBike for docked-station coverage and approach MBSJ/Beam and Perbadanan Putrajaya/TRYKE for geographically limited availability feeds. Request sample payloads, a published licence or signed agreement, a data owner, and an operating-area and parking register. Leave the four NO-GO providers out of the shortlist until new evidence resolves their gaps.
2. **Validate samples off production.** Recheck catalog and endpoint discovery, declared-version schemas, legal access, source clocks, public access flags, inventory semantics, retries, empty snapshots, and any rate or caching restrictions. Measure availability and freshness over representative operating hours, including outages. Record assumptions and publish eligibility criteria before selecting a pilot.
3. **Pilot the isolated overlay.** After a provider passes validation, begin with one verified system or city. Use station-only display if the agreement and data cover a station registry only. Add live station availability or free-floating vehicle points once those fields pass validation. Verify mobile usability, payload sizes and regression coverage for existing transit refresh and interactions.
4. **Add first-mile / last-mile reporting.** Start once enough valid snapshots exist and the agreement permits aggregated analysis. Publish observation windows and unknown coverage. Expand by provider or city only as each independently meets the same evidence requirements.
