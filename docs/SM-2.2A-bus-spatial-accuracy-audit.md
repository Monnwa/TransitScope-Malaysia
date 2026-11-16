# SM-2.2A — Bus Spatial Accuracy Audit

## Executive summary

**MULTIPLE CAUSES.** The simulated bus fleet uses straight segments between hand-authored stops. Ten of the 12 bus routes reproduce at least one complete segment between consecutive MRT or LRT stations. **T801, T802 and T803 reproduce their respective MRT subsections end to end.** At the fixed audit tick, 133 moving buses lay on those shared MRT/LRT segments, including 99 more than 200 m from the nearest MRT/LRT station. The overlap exists in the coordinates sent to the map.

The fleet has 324 buses at 306 distinct coordinates. All 29 buses at repeated coordinates were dwelling at stops. Some moving buses also run very close together because the simulation applies independent schedule offsets to a fleet of 27 buses per route. The 30 px markers magnify the crowding at the default zoom. The source and runtime checks found no evidence of a bus snapping to rail during interpolation or of the frontend assigning the same geographic coordinate to distinct records.

The primary snapshot is the **14 November 2026, 12:00:00 MYT** tick (`2026-11-14T04:00:00.000Z`, epoch milliseconds `1794628800000`). This is the repository's existing deterministic simulation test tick. The audit used the local working tree over Git HEAD `3bb0e2a`, which already contained uncommitted simulation and dashboard source. The incident screenshot and its original tick were unavailable. Read-only requests to the [documented Production alias](https://transit-scope-malaysia.vercel.app/) failed to resolve from this environment, so the results reproduce the symptom in the working tree and do not establish deployed revision parity. Distances are to modeled rail alignments and stations. This audit did not survey real tracks, roads, or bus boarding points.

## Root causes

| Finding | Classification | Evidence |
| --- | --- | --- |
| Simulated buses follow modeled MRT/LRT between stations | Geometry and data model | Shared station coordinates and 22 matching consecutive stop pairs across 10 routes. Each pair generates the same straight geographic segment, in either direction. All 81 fleet vehicles on T801–T803 lie on MRT polylines at the audit tick. |
| Multiple buses occupy a stop coordinate | Fleet and stop model | All 11 repeated coordinate sites are stops. Buses remain at their stop coordinates during 25 s dwell. Inbound terminal dwell and the next leg's outbound origin dwell can give a continuous 50 s stay at the same coordinate. Some interchanges also serve several bus routes at one modeled point. |
| Moving buses run at very small separations | Fleet schedule | Four same-route, same-direction moving pairs were within 10 m. For D100-06 and D100-10, the 240,031 ms difference in base phase is almost cancelled by a 240,000 ms difference in schedule offset. Their same-direction trips start 31 ms apart, producing a 0.224 m gap at 26 km/h. |
| Several buses look like one symbol, or symbols cover rail | Map presentation | Each bus has its own Leaflet marker. At zoom 13, 43 buses share a projected pixel with another bus and 1,127 pairs have intersecting nominal icon boxes, including 982 pairs farther than 100 m apart. |
| An interpolation, initialization or stale position defect | Unsupported by checks | All 324 API positions, journey positions and current trip IDs matched at the same tick. Every position lay on its active bus segment. No same-route, same-direction moving buses shared exact progress. Across one five-second tick, 290 buses changed position and the remaining 34 were at a stop at both samples. |

## Bus positioning data flow

1. **Route and geometry.** `busCorridors` supplies a fixed route ID, operator and ordered stops. `busRoutes` assigns 27 buses, a speed of 26–32 km/h and a route seed. `prepareRoute` builds an outbound leg and a reversed leg. `leg` subdivides each straight stop-to-stop chord into approximately 2 km steps or shorter and indexes the resulting path using cumulative Haversine distance. The stop coordinates define the shape and its timing anchors. Invalid geometry throws during construction. There is no rail lookup, fallback path or road network in the bus geometry builder. [Network construction](../lib/simulation/network.ts#L130) · [Shape indexing](../lib/route-projection.ts#L19)
2. **Fleet identity and first position.** `makeFleet` binds each bus to its route and assigns `bus:<routeId>:<number>`. Its seeded phase is `round((index + U × 0.6) × period / 27)`, with a separate deterministic offset of −3, 0 or +4 minutes. There is no initial spawn coordinate. The first requested tick uses the same trip and position calculation as later ticks. [Fleet creation](../lib/simulation/vehicles.ts#L6)
3. **Clock, trip and position.** `simulationTime` floors wall-clock time to five seconds. `cycleStart` finds the current cycle relative to `EPOCH - phase + offset`. `currentTrip` selects the leg. `locate` finds the latest reached stop, holds the bus there during dwell and otherwise interpolates the cumulative distance from departure to the next arrival. `pointAtDistance` clamps to the bus leg, finds the active segment and interpolates its latitude and longitude. The old nearest-shape projection helpers do not participate in this path. [Clock](../lib/simulation/clock.ts#L1) · [Trip and location calculation](../lib/simulation/vehicles.ts#L27) · [Distance interpolation](../lib/route-projection.ts#L55)
4. **Journey, progress and departures.** `busJourney` finds the stable vehicle ID and calls the same `locate` function. It derives the next stop and ETA from the current leg, computes progress as distance divided by leg length, and exposes the trip ID and per-stop status. A departure preview can show the selected run's path and stops while the bus retains its current position. Station-service references include the route ID, so sharing a physical point does not join a bus to a rail trip. Departure events use the same trip generator and stop offsets. [Journey](../lib/simulation/vehicles.ts#L132) · [Visit calculation](../lib/simulation/vehicles.ts#L102) · [Service references](../lib/simulation/network.ts#L206) · [Departures API](../app/api/departures/route.ts#L8)
5. **API and map.** `simulationSnapshot` combines bus records, trains, stops, alerts and LinkBike. The scenario module generates alerts and bike availability separately from movement. The transit API emits the snapshot with `no-store`. The dashboard starts at the server-provided tick and polls its own clock once per second. It computes the same snapshot locally, filters records and passes them to the map. The active bus marker receives `record.position` in `[latitude, longitude]` order and uses the stable record ID as its React key. [Page](../app/page.tsx#L6) · [Snapshot](../lib/simulation/index.ts#L6) · [Scenarios](../lib/simulation/scenarios.ts) · [Transit API](../app/api/transit/route.ts#L6) · [Dashboard](../components/dashboard.tsx#L41) · [Map marker](../components/transit-map.tsx#L141)

## Bus and rail geometry

Bus and rail have distinct route definitions, stop arrays and generated leg arrays. The arrays are not independent sources of geographic coordinates. Some entries reuse the same stop object and position array, such as KL Sentral, Pasar Seni and Kwasa Damansara. Others create separate stop objects with equal coordinates, such as Surian, Stadium Kajang and Cyberjaya Utara. Matching adjacent coordinates generate identical alignments even when the path arrays are different objects or the traversal direction is reversed. The same builder generates the modeled rail paths sent to the map. There is no runtime bus-to-rail matching, no rail polyline selected by a bus ID, and no evidence of a separate road alignment for these demonstration corridors. [Station fixtures and rail definitions](../lib/simulation/network.ts#L21) · [Bus corridors and rail export](../lib/simulation/network.ts#L130)

The fleet uses **12 distinct full bus alignments** when direction is ignored, or **24 ordered paths**. Every bus shares its full alignment with 26 buses on the same route. No two bus route IDs use the same full alignment. Three pieces are shared between different bus routes.

| Shared bus segment | Routes | Rail coincidence |
| --- | --- | --- |
| KL Sentral–Pasar Seni | D100 and D300 | LRT-KJ |
| Pasar Seni–Masjid Jamek | D100 and D200 | LRT-KJ |
| Pengkalan Weld–Komtar | P101 and P102 | None in this model |

At the audit tick, 27 moving buses occupied one of those three shared bus segments. Six additional buses were dwelling at their endpoints. That partial sharing explains some cross-route crowding. For example, `bus:D100:03` and `bus:D300:05` were 6.62 m apart on KL Sentral–Pasar Seni. D200 and D700 also reproduce Monorail segments. The MRT/LRT statistics below exclude Monorail and KTM.

## Fleet distribution and clustering

The audit froze the clock, invoked the local `/api/transit` and `/api/rail-network` handlers directly, and analyzed the JSON response bodies without a map or an HTTP server. Both handlers returned 200. The transit JSON matched `simulationSnapshot(tick)` after serialization. The cohort includes every `Bus` record with `recordKind: "vehicle"` at that tick and excludes stops. Repeated coordinates use the full emitted numeric precision. Bus-to-bus separation is Haversine distance. Rail offset is the minimum point-to-segment distance across the emitted polylines, using a local tangent-plane projection to find the clamped nearest point on each short segment, followed by a Haversine distance to that point. All threshold counts are inclusive. [Distance implementation](../lib/route-projection.ts#L12) · [Rail API](../app/api/rail-network/route.ts#L4)

- **306 unique coordinates**, **11 repeated sites**, **29 buses at those sites**, and **18 duplicate records beyond the first bus at each repeated site**.
- **270 buses (83.3%) in Greater Kuala Lumpur/Klang Valley**, including 189 on Rapid KL routes D100–D700 and 81 on feeder routes T801–T803. Snapshot bounds are 2.93128–3.23100° N and 101.57402–101.79094° E.
- **54 buses (16.7%) on Penang Island**, on P101 and P102. Snapshot bounds are 5.37158–5.41700° N and 100.28095–100.34028° E. No other region has simulated buses in this catalog. Of these 54, 29 had a bus neighbor within 100 m.

| Distance to another bus | Buses with at least one neighbor | Unordered bus pairs | Same-route pairs | Pairs with both buses moving |
| ---: | ---: | ---: | ---: | ---: |
| ≤10 m | 49 | 37 | 30 | 8 |
| ≤25 m | 83 | 58 | 49 | 25 |
| ≤50 m | 127 | 86 | 72 | 53 |
| ≤100 m | 184 | 145 | 117 | 96 |

Thirty-nine buses were dwelling at the audit tick. Examples of duplicate coordinates include four buses at Pasar Seni (`bus:D200:03`, `bus:D200:25`, `bus:D300:07`, `bus:D300:10`), four at Medan Tuanku (`bus:D200:05`, `:09`, `:15`, `:18`) and three at Jelutong (`bus:P102:02`, `:06`, `:17`). The Pasar Seni group mixes routes and direction-specific progress values of 0 and 1. Progress equality at a common stop follows from the dwell model. The Jelutong group shows that dwell clustering also occurs away from the rail network.

### Sensitivity across ticks

Each row uses a separate complete snapshot of 324 buses. The reported counts above use only the baseline row.

| Offset from baseline | Unique points | Buses at repeated points | Buses with a neighbor ≤100 m | Buses within 50 m of MRT/LRT |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 306 | 29 | 184 | 190 |
| +5 s | 306 | 28 | 181 | 188 |
| +10 s | 304 | 30 | 197 | 188 |
| +1 min | 309 | 26 | 204 | 195 |
| +15 min | 312 | 21 | 187 | 187 |
| +1 h | 296 | 47 | 190 | 186 |
| +24 h | 307 | 29 | 198 | 192 |

## MRT/LRT overlap by route

For route geometry, a shared segment means an exact match of the unordered endpoint coordinates of two adjacent authored stops. Percentages use the sum of matching chord lengths divided by total one-way chord length. This proves coincidence for the listed segments. It does not count partially collinear or nearby chords as exact endpoint matches. Counts of buses near rail use the actual exported MRT/LRT polylines and count each bus once at each threshold.

| Bus route | Example or extent of exact MRT/LRT alignment | Route length shared | Buses ≤50 / ≤100 / ≤200 m | Moving on matched chords | Sample vehicle |
| --- | --- | ---: | ---: | ---: | --- |
| D100 | LRT-KJ, KL Sentral–Pasar Seni–Masjid Jamek | 41.1% | 17 / 21 / 24 | 8 | `bus:D100:03` |
| D200 | LRT-KJ, Masjid Jamek–Pasar Seni | 20.2% | 11 / 13 / 15 | 4 | `bus:D200:01` |
| D300 | LRT-KJ, Universiti–Kerinchi and Bangsar–KL Sentral–Pasar Seni | 65.4% | 24 / 25 / 27 | 16 | `bus:D300:13` |
| D400 | LRT-PH, Bandar Tasik Selatan–Salak Selatan–Cheras–Chan Sow Lin | 78.7% | 27 / 27 / 27 | 17 | `bus:D400:10` |
| D500 | LRT-KJ, KLCC–Ampang Park | 13.9% | 6 / 7 / 9 | 2 | `bus:D500:22` |
| D600 | LRT-KJ, Gombak–Taman Melati–Wangsa Maju | 37.2% | 11 / 11 / 11 | 9 | `bus:D600:03` |
| D700 | MRT1, Maluri–Cochrane | 20.5% | 13 / 14 / 18 | 4 | `bus:D700:12` |
| T801 | MRT1, Kwasa Damansara–Mutiara Damansara | 100% | 27 / 27 / 27 | 25 | `bus:T801:13` |
| T802 | MRT1, Kajang–Bukit Dukung, reverse of rail's catalog order | 100% | 27 / 27 / 27 | 22 | `bus:T802:06` |
| T803 | MRT2, Putrajaya Sentral–16 Sierra, reverse of rail's catalog order | 100% | 27 / 27 / 27 | 26 | `bus:T803:11` |
| P101 | None | 0% | 0 / 0 / 0 | 0 | — |
| P102 | None | 0% | 0 / 0 / 0 | 0 | — |
| **Total** | **MRT1, MRT2, LRT-KJ and LRT-PH have matching bus segments** | | **190 / 199 / 212** | **133** | |

Using all eight displayed rail lines, including Monorail and KTM, the counts are **206 / 215 / 226** at the same thresholds.

- **Interchange proximity.** Twenty-nine dwelling buses occupied an exact modeled MRT/LRT station point. For example, `bus:D200:03` and `bus:D300:10` were at Pasar Seni `[3.143, 101.696]`. Serving a rail interchange is legitimate. Real curbside boarding coordinates would be needed to assess the accuracy of the specific point.
- **Shared alignment away from stations.** Of 162 buses at effectively zero offset from the modeled MRT/LRT polylines (within 0.01 mm for floating-point comparison), 133 were moving on matched chords and 29 were dwelling at shared stations. `bus:T802:06` was at `[3.01386271, 101.77900228]` on MRT1, 1,558 m from its nearest MRT/LRT station. `bus:D400:10` was at `[3.08789925, 101.70935572]` on LRT-PH, 1,355 m from the nearest MRT/LRT station. Both buses follow the shapes assigned to their bus routes. This is a defect in the modeled bus alignment, with no evidence of a rail snap in the positioning pipeline.
- **Nearby or crossing.** A finite offset can reflect a crossing, nearby travel or interchange access. Of the 190 buses within 50 m of MRT/LRT, 28 had a nonzero offset under the audit tolerance. Proximity alone does not determine whether those positions follow a road.
- **Visual overlap at a finite offset.** `bus:D100:15` was 259 m from MRT1 and 229 m from the nearest line in the full rail network (Monorail). At zoom 13, 259 m is about 14 CSS px in Klang Valley, within the combined 15 px icon radius and 2 px half-width of the normal rail stroke. At zoom 17 the same MRT1 gap is about 217 px. The visual test here is a footprint estimate based on the raw segment geometry and nominal strokes. Rendering can also vary with line simplification, highlights and shadows.

## Frontend rendering

The map uses a centered `30 × 30` CSS px Leaflet `DivIcon` with anchor `[15, 15]`. Bearing rotates the glyph inside the marker. Selection changes stacking via `zIndexOffset`. The map places a marker at each filtered bus position without a clustering or collision rule. React Leaflet calls `setLatLng` when the position prop changes. Leaflet projects the coordinates to integer layer pixels, so distinct coordinates can still share a pixel. Rail is drawn separately from the simulation rail paths, with a 4 px color stroke and 7 px white casing at normal emphasis. [Icon and map implementation](../components/transit-map.tsx#L24) · [Marker styles](../app/markers.css) · [Rail overlays](../components/transit-map.tsx#L120)

`MovingVehicle` in `journey-map-layers.tsx` supports motion frames but is outside the active simulated-bus marker path. The selected route overlay receives the already split geometry without a motion animator. Journey navigation projects the target to move the camera, and the stop highlight uses the stop coordinates. These operations do not mutate bus positions. The one-second dashboard refresh checks for a new five-second simulation tick. This can create visible steps or stationary periods between ticks. The checks found no evidence of stale shared coordinates under normal updates. [Journey map layers](../components/journey-map-layers.tsx#L12) · [Dashboard clock and snapshot](../components/dashboard.tsx#L41)

An in-process DOM check mounted the actual `TransitMap` with React Leaflet and a 960 × 400 map container. All 324 marker positions matched the projected raw positions after accounting for the common map origin at zoom 13, at the next tick, and at zoom 17. At baseline the markers occupied 299 pixels at zoom 13 and 305 at zoom 17. The true duplicate at Pasar Seni remained overlaid at both zooms and separated when one bus moved at the next tick. The 0.224 m D100 pair still shared a pixel at zoom 17. This check verifies the local component and marker positions. Full browser rendering could not be verified because the local browser test could not connect to the local server in this environment.

The table below projects all 324 coordinates before viewport clipping. “Box overlap” means two 30 px square icon bounds intersect in both axes. Actual circular icons have less overlap near the box corners, and the table does not count shadows or other overlays.

| Zoom | Approx. 30 px across in Klang Valley | Buses at a shared pixel | Buses with any icon box overlap | Overlapping pairs | Of those, pairs >100 m apart |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 4,580 m | 158 | 324 | 12,817 | 12,672 |
| 13 (default) | 572 m | 43 | 323 | 1,127 | 982 |
| 15 | 143 m | 31 | 246 | 230 | 85 |
| 17 | 36 m | 31 | 108 | 73 | 0 |

## Remediation options and regression plan

| Priority | Option for review | Risk and validation |
| --- | --- | --- |
| 1 | Author independent road-following bus shapes with explicit boarding stops near interchanges. Start with T801–T803 and D400, then replace the other matching corridors. Use reviewed local fixtures, with optional offline validation against openly licensed road or static bus data. | Highest impact on runtime if distances still drive the timetable. Preserve route IDs, bus IDs, stop identities and sequencing. Make the timing change explicit or separate stop timings from the visual geometry. Verify length, stop order and road access in both directions. Flag consecutive MRT/LRT chord matches, and review short crossing or interchange exceptions individually. Record before/after moving overlap away from stations at several fixed ticks. |
| 2 | Review effective departure spacing after applying offsets, including across the cycle boundary. Keep stable fleet IDs and legitimate stop dwelling. | A change to phase, offset or period can change trip IDs and departures. Test minimum same-direction headway against an agreed threshold, and measure near pairs separately for moving buses, opposite directions and dwell. Verify progression at arrival, departure, terminal turnaround and cycle rollover. |
| 3 | At low zoom, show a count or a selectable list for overlapping markers. Keep each underlying coordinate and individual marker available when zoomed in or selected. | Changes click and keyboard behavior in crowded areas. Verify vehicle selection, search, filters, popups and journey navigation at overview and street zooms on desktop and mobile. Compare displayed anchors to the raw records. This improves legibility while the geometry work addresses spatial accuracy. |

Use the fixed audit tick and the additional tick offsets above for acceptance comparisons. In each run, verify the 324 stable bus IDs, dashboard/transit API and journey agreement, next-stop and ETA consistency, and the match between departure boards and the actual simulated trips. Compare rail path coordinates, line colors and train positions at matched ticks. Also check LinkBike controls, availability and labels, and the existing Production data-mode copy. Use no paid routing or real-time feeds and no coordinate jitter.

The existing `tests/simulation.test.ts` suite passed all three tests using the installed Vitest runner with symlink preservation for this Windows workspace. The audit also asserted position, current trip ID and next-stop agreement for all 324 buses and checked each emitted position against its active bus segment. To reproduce the metrics, freeze `Date.now()` at the recorded tick, call the two local handlers, and group or compare the emitted positions as described above. For geometry comparison, compare consecutive stop coordinates in either order and canonicalize whole directional paths by choosing the lesser serialization of the forward path and its reverse, at nine decimal places. The SHA-256 of `JSON.stringify(buses.map(b => [b.id, b.position]))` in API order is `e99a20dfd03411b1d94ac2026b757ba34a74f6b3469cdff3d1a37b563281f910`. [Existing simulation tests](../tests/simulation.test.ts)

This report is the only workspace deliverable. Remediation is pending review.

**MULTIPLE CAUSES**

