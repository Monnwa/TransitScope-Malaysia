# Multi-operator micromobility simulation

Reviewed 19 November 2026, Asia/Kuala_Lumpur. Preview-only release from `codex/micromobility-multi-operator`; do not merge into `master` or promote to Production.

## Data and evidence

`GET /api/micromobility/stations` returns all four operators. Optional, single-valued filters: `operator` (LINKBIKE, HELLORIDE, TRYKE, BEAM), `state` (Kuala Lumpur, Selangor, Putrajaya, Penang), and `area` (case-insensitive exact match). Invalid, duplicate, or unknown query parameters return 400; valid empty results return 200. Validation failures return 503. Responses follow the existing `no-store` convention, with no runtime external requests, keys, or added dependencies.

| Operator | Source-backed named locations | Synthetic locations | Total |
| --- | ---: | ---: | ---: |
| LinkBike (existing scenario adapter) | 0 | 27 | 27 |
| HelloRide | 0 | 16 | 16 |
| TRYKE | 2 | 14 | 16 |
| Beam Mobility | 0 | 16 | 16 |
| Total | 2 | 73 | 75 |

The two TRYKE records are **APPROXIMATE_LOCATION**, not VERIFIED_LOCATION. The [Putrajaya authority's initiative page](https://smart.putrajaya.my/en/initiatives/tryke-micromobility/) names Ayer@8 and Millennium Monument among virtual parking stations. It does not publish exact hub coordinates or live status. Representative public-area positions show those named locations with the precision limitation, attribution, and operational status UNVERIFIED. This classification verifies the named location's documentary association only, never its exact parking position or present operation.

[TRYKE's August 2025 article](https://www.tryke.co/post/tryke-micromobility-service-in-malaysia) describes service areas and a forthcoming expansion. Those dated promotional references do not establish exact operating stations. DPulze's historical reference is deliberately not promoted to a currently confirmed station.

[HelloRide's official site](https://www.helloride-global.com/) identifies Malaysia and a Puchong office. An office is not a station and is excluded. No station-coordinate registry was established from the reviewed public material. [Beam Malaysia](https://www.ridebeam.com/my) identifies regional presence without a complete exact public parking-coordinate dataset in the reviewed material. HelloRide and Beam records therefore remain synthetic. See also the existing [feasibility audit](shared-micromobility-data-feasibility.md). No private API or authenticated source was scraped.

New locations use hand-selected representative public landmark surroundings with six-decimal input precision. There are 11 Klang Valley and 5 Penang locations per new operator, with independent positions and stable IDs. Each has four Penang Island locations and one Mainland location. The [inventory and distribution refinement audit](micromobility-inventory-distribution.md) records the complete coverage and measured before/after spacing. These points are not a parking directory, operating licence, or claim of public access/approved riding routes.

Every unified record has `isSimulation: true`, `operationalStatus: UNVERIFIED`, and null real bike/dock availability. New operators also have a separate, explicitly SIMULATED `simulatedInventory` object, generated deterministically from the stable station ID. Inventory provenance is independent of location provenance, including the two source-backed TRYKE locations. Synthetic records always carry SYNTHETIC / DEMONSTRATION_ONLY. LinkBike's adapter preserves original identities and coordinates and does not alter its original scenario, API, popup, inventory, or map selection flow.

## Map behavior

All four operators render by default. Select a marker or a station search result to open its popup, which shows availability, simulated inventory and provenance where applicable. An active search hides ordinary markers and reveals the selected micromobility result. Clearing search restores normal marker visibility. Penang points are retained outside the initial viewport.

HelloRide is blue, TRYKE orange, Beam purple. Synthetic markers have dashed borders; source-backed markers have solid borders and an outer ring. A dedicated pane below rail hit targets prevents new markers intercepting existing station selection. Popups stay in Leaflet's popup pane, disclose provenance and precision, link evidence, and show deterministic demonstration inventory with an explicit disclaimer. Their inventory fields use LinkBike's wording, two-column definition list and integer formatting. Popup content scrolls within a compact mobile size. A one-time immediate fit through the camera guard prevents scroll recovery from cancelling popup placement. Static marker layers remain stable across simulation-clock updates. The stations request retries once on failure, independent of the map layout and the LinkBike layer.

## Validation and baseline

Current automated coverage includes 59 data/API/geography tests and eight desktop/mobile browser tests. Browser tests cover default marker counts for every operator, absence of the coverage panel, popup classifications, source URLs, popup containment and control overlap, Penang retention, separate simulated inventory, API integration, automatic retry, loading-layout stability, and LinkBike regression. The Universal Station Search browser suite verifies that searching hides ordinary markers, that selection shows only the matching micromobility marker, and that clearing a search restores the markers for all four operators.

Original release acceptance: `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed. Its complete active Playwright suite against the optimized build passed **95 tests**, with **7 existing device-specific skips**. Current refinement results are recorded in the refinement audit and completion report. The full unit-suite baseline exceptions below remain visible.

Before the original implementation, the full Vitest suite had 571 passes and 3 failures. It had 605 passes and the same 3 failures after the original implementation, then 630 passes and the same 3 failures after the inventory and distribution refinement.

### Known issue — rail station popup recovery

The three cases in `tests/rail-station-popup-recovery.test.tsx` under `Rail coordinate validation before projection or placement writes` fail on baseline commit `2facc1f35acb0b3b5720c4eb147d72386a3900aa` and after the layer controls were removed. Run `pnpm exec vitest run tests/rail-station-popup-recovery.test.tsx` to reproduce them.

- `accepts a missing-native-anchor fallback only from the bound, mapped, record-consistent CircleMarker`
- `rejects a fallback inconsistent with the current station record`
- `rejects a native anchor inconsistent with the current source`

These failures match the previously documented native-anchor contract conflicts. The full suite after the control removal recorded 656 passes and these three failures. All 21 LinkBike unit tests passed.

### Local build and deployment

OneDrive's generated-cache `EINVAL readlink` issue required clearing `.next` before subsequent local builds. This changes no application/deployment configuration. Local QA uses the optimized `pnpm start` server and installed Edge via the existing Playwright executable-path override. Generated files, credentials, local environment files, and TypeScript build info are excluded from the feature commit.

Production baseline recorded from Vercel before push: deployment `dpl_Grt4ubTkzzdLwHzw4UhxzGhUwNRa`, master commit `5792a10eb51400bc089e4f18e658dbdf7b4ac18c`, Ready / Production / Current, domain `transit-scope-malaysia.vercel.app`, created 16 November 2026 at 20:01:49 MYT. Post-deployment verification and the actual Preview URL are reported in the completion report.
