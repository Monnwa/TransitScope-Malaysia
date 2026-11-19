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

New locations use hand-selected representative public landmark surroundings with six-decimal input precision. There are 11 Klang Valley and 5 Penang locations per new operator, with independent positions and stable IDs. Coverage includes Kuala Lumpur, Petaling Jaya, Subang Jaya, Sunway, Cyberjaya, Putrajaya, George Town, Gurney Drive, Tanjung Tokong, and Bayan Lepas. These points are not a parking directory, operating licence, or claim of public access/approved riding routes.

Every unified record has `isSimulation: true`, `operationalStatus: UNVERIFIED`, and null bike/dock availability. Synthetic records always carry SYNTHETIC / DEMONSTRATION_ONLY. LinkBike's adapter preserves original identities and coordinates and does not alter its original scenario, API, popup, inventory, or map selection flow.

## Map behavior

The existing micromobility control area contains independent operator checkboxes, all enabled initially, colour swatches, data-derived counts, source/synthetic subtotals, and disclosure. LinkBike retains its original zoom action and popup. New operators have explicit zoom actions across all their locations; toggles never fit/reset the viewport. Penang points are retained outside the initial viewport. Coverage points remain an independent overlay rather than changing existing transit records, search, indicators, or dashboard filters.

HelloRide is blue, TRYKE orange, Beam purple. Synthetic markers have dashed borders; source-backed markers have solid borders and an outer ring. A dedicated pane below rail hit targets prevents new markers intercepting existing station selection. Popups stay in Leaflet's popup pane, disclose provenance and precision, link evidence, and show no fabricated availability. Popup content scrolls within a compact mobile size. The existing control-avoidance system handles their zoom controls; a one-time immediate fit through the camera guard prevents scroll recovery from cancelling popup placement. Static marker layers remain stable across simulation-clock updates. Loading placeholders reserve count/summary space so API completion cannot shift the map.

## Validation and baseline

New automated coverage includes 34 data/API tests and six desktop/mobile browser tests. Browser tests cover all defaults, operator toggles, preserved rail marker counts and camera zoom, popup classifications, source URLs, popup containment and control overlap, Penang retention, null inventory, API integration, error/retry behavior, loading-layout stability, and LinkBike regression. Existing camera/dashboard network allowlists explicitly permit the new same-origin endpoint.

Final local acceptance: `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass. The complete active Playwright suite against the optimized build passes **95 tests**, with **7 existing device-specific skips**, zero failures, and no retries needed in that run. Final guarded-popup/layout scenarios also pass 12 repeated desktop/mobile checks. The full unit-suite baseline exceptions below remain visible.

Before implementation, the full Vitest suite had 571 passes / 3 failures (574 tests). After implementation it has 605 passes / the same 3 failures (608 tests). All 21 LinkBike tests pass. The existing failures are in `tests/rail-station-popup-recovery.test.tsx`, under `Rail coordinate validation before projection or placement writes`:

- `accepts a missing-native-anchor fallback only from the bound, mapped, record-consistent CircleMarker`
- `rejects a fallback inconsistent with the current station record`
- `rejects a native anchor inconsistent with the current source`

These failures match the existing documented native-anchor contract conflicts and were not altered. The retired suites excluded by Vitest/Playwright configuration remain excluded; they are not claimed as executed.

OneDrive's generated-cache `EINVAL readlink` issue required clearing `.next` before subsequent local builds. This changes no application/deployment configuration. Local QA uses the optimized `pnpm start` server and installed Edge via the existing Playwright executable-path override. Generated files, credentials, local environment files, and TypeScript build info are excluded from the feature commit.

Production baseline recorded from Vercel before push: deployment `dpl_Grt4ubTkzzdLwHzw4UhxzGhUwNRa`, master commit `5792a10eb51400bc089e4f18e658dbdf7b4ac18c`, Ready / Production / Current, domain `transit-scope-malaysia.vercel.app`, created 16 November 2026 at 20:01:49 MYT. Post-deployment verification and the actual Preview URL are reported in the completion report.
