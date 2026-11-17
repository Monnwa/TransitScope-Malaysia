# SM-2.3K.2A + K.2B — Local Implementation Report

Date: 17 November 2026 (Asia/Kuala_Lumpur).

Verdict: **PASS WITH LIMITATIONS**.

K.2A/K.2B are implemented locally. Functional checks, the production build, and rendered overlay/layout inspection pass. Real OpenStreetMap cartography and label readability have not been visually accepted: all automated browser evidence uses synthetic or deliberately failed tiles. No deployment or Git publication was performed.

## 1. Candidate identity and safety gate

Candidate root:

`C:\Users\loong\.codex\visualizations\2026\11\16\01a1e476-2151-7c73-a64c-169bd7893a94\sm23j-candidate`

The following identity is unchanged before and after implementation:

| Field | Value |
|---|---|
| Branch | `candidate/sm23j-combined-bus-map-ux` |
| HEAD | `28247ab9aac0ed17efba21e7c788a664b75a709d` |
| Committed tree | `11ad5d0d591079ababe6d96ed42438fd3d15b307` |
| Parent | `5792a10eb51400bc089e4f18e658dbdf7b4ac18c` |

Before editing, the directory's own `.git` was inspected: it is a real directory containing HEAD, config, objects, refs and index; `core.bare=false`, no `core.worktree` override. This is a standalone checkout-shaped snapshot, not a registered linked worktree of the original repository. Its HEAD names the intended Candidate branch.

The original repository's existing object database verified the expected commit/tree/parent. Its local Candidate branch ref is absent, but its already-available `refs/remotes/origin/candidate/sm23j-combined-bus-map-ux` points to the expected commit. Nothing was fetched.

An in-memory comparison checked all 201 tracked paths and raw file bytes using Git blob hashes. All 201 matched, with zero missing, mismatched or line-ending-only differences. The snapshot's 201 stage-zero index entries matched the expected modes/object IDs and inventory. No extra source files existed. Existing `.git/`, `.next/` and `node_modules/` were identified separately. Unsandboxed read-only Git status was clean. The implementation script repeated the clean-status, expected-HEAD and 201-file checks before writing.

After implementation, HEAD and the committed tree remain unchanged; the working tree intentionally contains the local changes listed below. No changes are staged. The six modified previously tracked files are the CSS, three components and two existing E2E specs listed below; the other 195 original tracked files remain byte-identical. There are seven new files including this report.

## 2. Root cause of the earlier Git-status failure

**The failure was specific to sandboxed execution, not a damaged Candidate index or a bare/worktree misconfiguration.**

Controlled comparison used the same Git executable, Candidate directory and command:

`git --no-optional-locks status --porcelain=v1 -uall`

Inside the sandbox it returned `fatal: this operation must be run in a work tree`. Outside the sandbox it succeeded and reported a clean checkout before implementation. Read-only setup tracing inside the sandbox nevertheless resolved the correct worktree and `.git`, and `rev-parse` reported inside-work-tree=true and bare=false. Disabling fsmonitor for the command did not resolve it. This establishes the sandbox boundary as the cause category; the precise low-level sandbox/Git interaction was not diagnosed further.

No Git configuration, index or worktree repair was performed. Subsequent status/diff validation ran outside the sandbox with approval.

## 3. Files changed

All paths below are relative to the Candidate root stated above.

| File | Reason |
|---|---|
| `lib/map-basemap.ts` (new) | Central OSM URL, attribution, maximum zoom, light-tile class and neutral failed-tile fallback |
| `lib/bus-map-routes.ts` (new) | Stable T401/T402 regional display geometry, joined from both existing internal simulation legs |
| `components/bus-route-layers.tsx` (new) | Memoized overview/context/emphasis layers, zoom-aware weights and explicit route-selection bounds fitting |
| `components/dashboard.tsx` | Pass route selection and Bus/SIMULATED visibility into the map; existing table/record filtering unchanged |
| `components/transit-map.tsx` | Compose route layers and dedicated panes; quiet rail visuals in bus context; wire selected journey emphasis and basemap configuration |
| `components/bus-vehicle-marker.tsx` | Optional opacity reduction for other-route vehicles while preserving SVG, icon memoization, selection outline, popup and offsets |
| `app/markers.css` | Whole-raster light treatment, neutral map background and bus-route legend sample |
| `tests/bus-map-routes.test.ts` (new) | Verify regional scope, exact source-coordinate preservation, both internal legs and stable overview extent |
| `e2e/bus-route-hierarchy.spec.ts` (new) | Network/route fitting, switching/clearing, stable geometry across updates, screenshots and tile-failure regression |
| `e2e/map-zoom.ts` (new) | Reach an explicit fixture zoom through existing Leaflet zoom buttons |
| `e2e/bus-map-ux.spec.ts` | Use requested viewports/new overview; allow fixed-clock popup pans to complete; retain selection, dismissal and upright-icon assertions |
| `e2e/bus-stop-popup-boundary.spec.ts` | Reach its original zoom-12 boundary fixture explicitly rather than assuming initial zoom 13 |
| `docs/SM-2.3K.2AB-local-implementation.md` (new) | This report |

`components/journey-map-layers.tsx` was temporarily adjusted while checking stacking, then its original stop ordering was restored through an explicit edit after pointer-interception tests exposed the issue. Its final contents are byte-identical to the Candidate baseline. No Git discard/reset/checkout operation was used.

## 4. Basemap decision

Retained the existing OpenStreetMap raster provider and changed its subdomain template to the currently documented canonical URL:

`https://tile.openstreetmap.org/{z}/{x}/{y}.png`

Attribution remains `© OpenStreetMap contributors`, linked to the provider copyright page. The existing Leaflet attribution control remains visible in the captured map output.

The tile layer alone receives `grayscale(.85) saturate(.3) contrast(.88) brightness(1.07)`. Transit layers, labels in the UI, popups and attribution are outside that filter. A data-URI neutral tile supplies the background when a tile fails, without switching providers or disrupting independent transit layers. Coverage, Leaflet interactions and maximum tile zoom 18 are retained. URL/options/attribution are centralized.

This is the minimum viable light treatment within the existing service boundary. Raster road/label/building/POI details remain baked into the tiles: CSS cannot independently remove or restyle them. More selective minimization requires a suitable pre-styled raster source or vector renderer and separate authorization where credentials/service setup are involved.

Provider documentation reviewed on the audit date:

- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/): canonical HTTPS URL, visible attribution, browser identification/referrer and normal caching, no bulk/prefetch/offline collection. No cache-bypass, proxy or prefetch feature was introduced.
- [CARTO Basemap Terms](https://carto.com/legal/basemap-terms/): current service terms specify a CARTO-issued API key. CARTO was evaluated but not adopted; no account, key, paid plan or external configuration was introduced.

No real tile service was exercised by the automated tests. Mocked screenshots do not establish real-provider label readability or feature contrast.

## 5. Route hierarchy and camera boundary

Only the existing simulated Klang Valley routes T401 and T402 are included. The regional allowlist prevents a future Penang bus fixture from being pulled into this overview automatically. This is the available simulated network, not a claim to represent every operational Klang Valley route.

Each full route path joins the original two internal legs at their shared endpoint once at module initialization. Source geometry, stops, timetables and vehicle calculations are unchanged. No label represents either internal leg as an officially published independent direction.

- Default overview: both routes, muted `#617b99`, opacity .65, width 3px below zoom 14 / 3.5px at closer zoom.
- Emphasized route: `#1458b8`, opacity 1, width 4.5px / 5.5px, white 8px / 9px casing.
- Other route geometry: remains visible at opacity .24.
- Selected vehicle: original upright SVG, gold outline and offset 1100 preserved. Other-route vehicles can dim to opacity .45 when a journey is selected. Existing route dropdown record filtering still applies; other-route geometry remains even when those vehicles are filtered out.
- Selected journey: original completed/remaining colors and preview styling retained above full-route context. Stops remain selected-journey-only.
- Rail: quieter dashed alignment and smaller, translucent station circles while buses are visible and no rail line is highlighted. Explicit rail highlighting restores the original stronger rail treatment. Rail geometry, simulation, controls and data are unchanged.

Panes: rail paths 400; bus network 420; selected route 430; journey paths 450; default rail markers 600; bus markers/stops 625; default tooltip/popup panes remain above. Within the bus-marker pane, original bus/stop ordering is retained to preserve bus click access at coincident stops.

Bounds fitting runs on initial enabled overview, route dropdown changes, bus-layer enablement and the existing Fit to region/reset signal. It accounts for zoom controls and the current legend height, caps at zoom 14 and does not animate. Clearing route selection fits the network again. Vehicle selection can emphasize its route without triggering a new route-bounds fit. Vehicle position/time updates do not drive this effect. The old fixed-region reset is used only when the bus overview layer is disabled, avoiding two competing reset moves.

No vehicle-follow mode, FREE_EXPLORE state, Return to Vehicle control, hybrid camera or new mobile-sheet behavior was introduced.

## 6. Validation commands and results

Commands ran from the Candidate directory using installed dependencies. No dependency installation was completed.

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit --incremental false` | Wrapper failed before the check: automatic install attempted, then `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` |
| `pnpm lint` | Same wrapper/install-abort failure |
| `pnpm exec vitest run tests/bus-map-routes.test.ts tests/bus-marker-graphic.test.ts` | Same wrapper/install-abort failure |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS, including final post-build check; no incremental file rewrite |
| `node node_modules/eslint/bin/eslint.js .` | PASS, including final check |
| `node node_modules/vitest/vitest.mjs run tests/bus-map-routes.test.ts tests/bus-marker-graphic.test.ts` | PASS: 2 files, 17 tests |
| `node node_modules/vitest/vitest.mjs run` | PASS: 29 files, 381 tests; final run 6.96s |
| `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100` | Local development server started for validation; subsequently stopped |
| `node node_modules/next/dist/bin/next build` | PASS: optimized compile, lint/type validation, static generation and build traces |
| `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100` | Built application started locally for final acceptance; subsequently stopped |
| `git --no-optional-locks diff --no-ext-diff --check` | PASS |

Browser command, run against both development and final local production servers:

```powershell
$env:TRANSITSCOPE_TEST_URL='http://127.0.0.1:3100'
$env:TRANSITSCOPE_TEST_CHROME='C:\Program Files\Google\Chrome\Application\chrome.exe'
node node_modules/@playwright/test/cli.js test e2e/bus-route-hierarchy.spec.ts e2e/bus-map-ux.spec.ts e2e/bus-stop-popup-boundary.spec.ts e2e/dashboard.spec.ts --workers=2 --reporter=line
```

These are process-local test settings, not project/deployment environment changes.

Final development result: **18 passed, 6 skipped, 0 failed**, 35.7s.

Final production-build result: **18 passed, 6 skipped, 0 failed**, 21.7s.

The six skips come from existing platform guards: five mobile-only boundary cases skipped in the desktop project and one desktop-only case skipped in the mobile project. Existing configured retired-contract unit/E2E exclusions were left intact.

Functional coverage includes initial network; T401/T402 full-route fitting and switching; clearing selection; stable route DOM/geometry after a simulation tick; failed tiles; bus selection; departure preview; selected-journey stops; route-ahead/behind segments; upright icons across changing bearings; popup close and dismissal; rail filters/trains; simulated LinkBike selection/fitting; alerts; and horizontal mobile layout.

No failed iterations are concealed: the first browser run had 5 failures / 13 passes / 6 skips. An intermediate run had 4 failures / 14 passes / 6 skips. Resolved issues were an immutable Leaflet CSS class requiring a key on the emphasized route, raised stop pins intercepting bus clicks, and old fixed-view/fixed-clock assumptions that stalled popup auto-pan after the new overview fit. Existing interaction and popup-hit assertions were retained. Final runs are green.

## 7. Desktop/mobile visual evidence

Screenshots were captured from rendered local production output at CSS viewports **1265 × 720** and **375 × 844**. Mobile PNG pixel dimensions reflect the emulated device pixel ratio. The overview, T401 and T402 screenshots were inspected during development; final production desktop T401 and mobile overview captures were also inspected.

All screenshots use synthetic test tiles. They validate route/marker hierarchy, fitting, layout and visible attribution, not real OpenStreetMap labels, roads or POIs.

Evidence folders under the Candidate root:

- `test-results/bus-route-hierarchy-frames-e734a-w-without-following-updates-desktop-chromium/`
- `test-results/bus-route-hierarchy-frames-e734a-w-without-following-updates-mobile-chromium/`

Each contains `overview-mocked-tiles.png`, `T401-mocked-tiles.png` and `T402-mocked-tiles.png`.

Measured existing popup-boundary checks reported zero popup/close-control overflow and successful hit testing at all five sampled close-button points for the tested desktop and mobile cases.

## 8. Performance and remaining limitations

Route geometry is derived once at module load; React.memo isolates route layers from dashboard time/vehicle updates; style objects are memoized; zoom-dependent changes use a zoomend listener. Stable overview route DOM and SVG geometry across a simulation tick are tested. The selected emphasis layer remounts only when route identity changes to handle Leaflet's immutable class name. No large dependency or clustering was added. No FPS/CPU benchmark is claimed.

Remaining limitations:

1. Whole-raster filtering cannot remove provider POIs/buildings or independently style labels. Actual tile contrast/readability still needs authorized visual acceptance.
2. Network coverage is limited to existing simulated T401/T402 fixtures. Additional regional fixtures need explicit curation.
3. Existing record filters can hide other-route vehicles while their route geometry remains as context.
4. Existing mobile sheet size, controls and vehicle/stop coincidence behavior remain; no new responsive UX or follow behavior is claimed.
5. Pre-existing one-shot journey-navigation request deduplication was outside this phase and remains for later camera work.
6. Build/test outputs are local, ignored artifacts, not deployment evidence. Re-running Playwright may replace test-results screenshots.

## 9. Preserved systems and final state

No changes to simulation modules, route fixtures, timetable logic, API handlers, SIMULATED labels, bus SVG, journey navigation implementation, mobile sheet CSS/behavior, LinkBike feature gates, rail simulation or alert logic.

No dependencies added or updated; manifests and lockfile match the Candidate baseline. No new account, API key or service configuration. No AWS, Production LinkBike, hosted Preview or Production system accessed. No fetch, commit, staging, push, branch/worktree creation or switch, reset, clean, stash, discard, merge, PR or deployment operation performed.

Original workspace remains clean and unchanged:

`C:\Users\loong\OneDrive\Documents\ChatGPT\TransitScope Malaysia`

Branch `feature/postgres-outbox-preview`, HEAD `433e8140773305d738482a02a94c1c9d7b304683`.

All project changes are confined to the isolated Candidate. The helper implementation script is a task artifact in the current Codex visualization directory, outside the original workspace. Local validation servers were stopped.

Stop point: local K.2A/K.2B implementation and report complete. K.2C and subsequent Git/deployment work require separate authorization.