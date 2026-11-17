# SM-2.3K.2C + K.2D — Local Implementation Report

Date: 17 November 2026 (Asia/Kuala_Lumpur).

Verdict: **PASS WITH LIMITATIONS**.

Local hybrid-camera and responsive work is complete. All configured unit/component tests, production build, TypeScript, ESLint and final production browser checks pass. Desktop, mobile and tablet screenshots were captured and inspected. Browser tiles are synthetic: this report does not claim visual acceptance of real OpenStreetMap cartography or validation on physical mobile hardware.

## 1. Candidate identity and mandatory preflight

Candidate root:

`C:\Users\loong\.codex\visualizations\2026\11\16\01a1e476-2151-7c73-a64c-169bd7893a94\sm23j-candidate`

| Field | Before and after implementation |
|---|---|
| Branch | `candidate/sm23j-combined-bus-map-ux` |
| HEAD | `28247ab9aac0ed17efba21e7c788a664b75a709d` |
| Committed tree | `11ad5d0d591079ababe6d96ed42438fd3d15b307` |
| Parent | `5792a10eb51400bc089e4f18e658dbdf7b4ac18c` |

The Candidate has its own real `.git` directory, `core.bare=false`, and no `core.worktree` override. Git identifies the expected directory as a worktree. It is a standalone checkout-shaped snapshot, rather than a registered linked worktree of the original repository. Read-only Git status/diff/index checks ran outside the sandbox because the prior audit established that sandboxed worktree-status operations fail spuriously. No Git configuration or worktree repair was attempted.

The existing K.2A/K.2B report was read in full. Preflight found exactly its expected six tracked modifications and seven untracked files, with no staged changes or unexpected paths. The complete SHA-256 inventory was captured before editing and checked again immediately before the implementation script wrote source.

### Complete preflight change inventory

`M` means an unstaged tracked modification; `??` means an untracked file. Paths are relative to the Candidate root above. Hashes are pre-edit SHA-256 values, not hashes of the committed originals.

| Status | File | Preflight bytes | SHA-256 | Final disposition |
|---|---|---:|---|---|
| M | `app/markers.css` | 3751 | `0edbce0d312470982a00c0a37210fe4bcbdb668fa4859dfae0a8f5ecd91d19dd` | Byte-identical |
| M | `components/bus-vehicle-marker.tsx` | 1398 | `9c466c715b7fba9ea370814f1cbae6c0d6c4dcee952fd40e0a7addea5b8f055b` | Extended for K.2C/K.2D |
| M | `components/dashboard.tsx` | 16112 | `2f91f6d9504ab15d43304ed6e48f711c923e66673875d77c389ad8802418b072` | Extended for K.2C/K.2D |
| M | `components/transit-map.tsx` | 11760 | `e49dd6612e9ccd4c16894a7cbf0c2e1486da89e305473ea67d53010270366a08` | Extended for K.2C/K.2D |
| M | `e2e/bus-map-ux.spec.ts` | 12187 | `b493e544ab3c3ab39d04743237a15a492bd80697b2f2e03ccb0f6c69d07934d1` | Byte-identical |
| M | `e2e/bus-stop-popup-boundary.spec.ts` | 10044 | `09bc21f1b322cccf6160ed1af0aae9f3393d77218bc843761b8276b5ebc9669d` | Byte-identical |
| ?? | `components/bus-route-layers.tsx` | 2691 | `8995e1cccc4e96d3d1ea9ff0bbec59e95eaa9160e99ea030899545bfa8b9b7f9` | Extended for K.2C/K.2D |
| ?? | `docs/SM-2.3K.2AB-local-implementation.md` | 16952 | `44f652540772d42d0019725c633552c72530f737a3a160bd41451f961491b1fc` | Byte-identical |
| ?? | `e2e/bus-route-hierarchy.spec.ts` | 4701 | `d499c6ef50d6127aa967f3be12b04a930a0cdc81394c3cf2dd4b359eeab347ca` | Byte-identical |
| ?? | `e2e/map-zoom.ts` | 731 | `530eda8855a7dd02b912b97fb2c4e13ea9dad9a5c534b44a0d008950ee21960d` | Byte-identical |
| ?? | `lib/bus-map-routes.ts` | 973 | `e69d24f283b6f7dfdae59c92978b661d1e5ffd29495bb9be597143fd543b033f` | Byte-identical |
| ?? | `lib/map-basemap.ts` | 770 | `40bf22084aea9f4cd079f8b40307000cc58fc5380d2e577f0356694b20be9560` | Byte-identical |
| ?? | `tests/bus-map-routes.test.ts` | 1445 | `b2bc02e07a59155342c0efe3b3f9a0bf6544439ab9c5b4d22d6b52ace4c73ae0` | Byte-identical |

The full preflight manifest, including the seven existing evidence-file hashes, is saved at:

`C:\Users\loong\.codex\visualizations\2026\11\17\01a1e7e7-9ecd-7b43-aed4-0c7401c8308b\sm23k2cd-preflight.json`

The original workspace was and remains clean on `feature/postgres-outbox-preview`, HEAD `433e8140773305d738482a02a94c1c9d7b304683`:

`C:\Users\loong\OneDrive\Documents\ChatGPT\TransitScope Malaysia`

## 2. K.2A/K.2B preservation and final inventory

Nine of the thirteen preflight files remain byte-identical. Four UI files were extended: `components/dashboard.tsx`, `components/transit-map.tsx`, `components/bus-vehicle-marker.tsx`, and `components/bus-route-layers.tsx`. Their K.2A/K.2B behavior is preserved by source review and the unchanged route/marker/popup regression assertions.

The light OSM configuration, attribution, neutral failed-tile fallback, regional allowlist, full T401/T402 paths, route colors/weights/context, rail hierarchy, bus SVG, selected outline and offsets, selected-only journey stops, and SIMULATED data boundaries remain. `components/journey-map-layers.tsx`, simulation/route data, APIs, manifests, lockfile, feature gates and test configuration are unchanged from the committed Candidate.

All seven original `test-results` artifacts match their preflight hashes. New runs use distinct output directories. Earlier K.2A/K.2B evidence and this phase's failed-run evidence were retained.

Final blob comparison: **192 of 201** original tracked files remain byte-identical to the committed Candidate; the nine modifications are the six existing K.2A/K.2B paths plus three newly extended tracked paths. All **201 stage-zero index entries** still match the committed tree, with no staged changes. Including this report, the final working tree has **9 modified tracked files and 15 untracked files**. This phase extends seven existing working-tree files and adds eight new files, including the report.

## 3. Camera architecture and transitions

`BusCameraProvider` is the single state owner. It wraps the existing dashboard content without a changing key. Dashboard vehicle selection and navigation requests remain inputs; the dashboard and marker components do not own separate camera modes.

`cameraReducer` owns `OVERVIEW`, `VEHICLE_FOCUS`, `FREE_EXPLORE`, the selected vehicle association and explicit command revisions. `BusMapCamera` is the sole active bus-camera executor. K.2B route rendering is still memoized, but its fitting effect and the old active `MapView`/`JourneyMapNavigation` call sites were removed to avoid competing camera owners. The legacy navigation export remains unused by this dashboard path.

| Current state | Event | Result / camera intent |
|---|---|---|
| Initial | Map becomes visible | OVERVIEW; fit available simulated T401/T402 network |
| OVERVIEW | Select a bus in table or marker | Stay OVERVIEW; selection and journey context update, without following |
| OVERVIEW | Locate bus | VEHICLE_FOCUS at latest valid selected position |
| VEHICLE_FOCUS | Position updates | Stay VEHICLE_FOCUS; move only when follow policy requires |
| Any mode | User map drag, wheel, zoom button, pinch or map navigation key | FREE_EXPLORE; cancel pending follow and stop camera animation |
| FREE_EXPLORE | Position/polling updates | Stay FREE_EXPLORE; keep center and zoom |
| FREE_EXPLORE | Return to Vehicle | VEHICLE_FOCUS at latest valid position |
| FREE_EXPLORE | Bare FOCUS action | Ignored by reducer; Return is required |
| VEHICLE_FOCUS | Different bus selected | FREE_EXPLORE; retain view; following is not transferred |
| Selected bus | Position unavailable or hidden by filters | Following pauses in FREE_EXPLORE; retain identity and view; explain unavailability |
| Unavailable | Return attempted | No camera movement and no fallback to a different vehicle |
| Unavailable | Position becomes available again | Stay suspended until explicit Return |
| Any mode | Clear bus selection | OVERVIEW; frame current route context or network |
| Any mode | Change/clear bus route or request Overview | OVERVIEW; selected route fit or restored network, never vehicle following |
| Any mode | Navigate to a journey stop | FREE_EXPLORE; explicit stop focus, keeping vehicle selection |

Route intent takes precedence over following: the existing route dropdown clears vehicle selection and fits the chosen full route; clearing the route fits the network. The Overview control preserves selected-vehicle detail while framing the current route filter, or the network when no route is selected.

Existing rail and LinkBike selection intent remains usable. Selecting another transport mode does not first pull that view back to the bus network. Explicit LinkBike station fitting suspends bus following and uses the shared guard. Its provider, feature gates, data and Production systems are untouched.

Source references:

- `lib/map-camera.ts`: `cameraReducer`, `ProgrammaticCameraGuard`, `followDecision`, `cameraArea`, `cameraAnchor`.
- `components/bus-camera-context.tsx`: `BusCameraProvider`, `useBusCamera`.
- `components/bus-map-camera.tsx`: `BusMapCamera`, `followLatest`, command, layout and input effects.
- `components/dashboard.tsx`: provider boundary, existing `select`, and explicit Locate navigation callback.

## 4. Manual versus programmatic movement

Manual detection uses native input within the Leaflet container and Leaflet `dragstart`/`zoomstart` events. Wheel, zoom-control clicks, pinch and navigation keys suspend immediately. Pinch and wheel also work when they begin over the bus marker. Pointer state provides a zoom-start fallback; popup/form interaction is excluded. Bottom-sheet interactions occur outside the map input listeners and do not change camera mode.

Programmatic operations run in a nested, exception-safe scoped guard. All new camera commands are immediate (`animate:false`), so generated Leaflet move/zoom events occur within that scope. There is no arbitrary timeout used to infer whether a movement was programmatic. The follow-throttling timer serves a separate scheduling purpose.

Drag and genuine input take precedence over scripted motion. Map movement/end events record actual view coordinates; they do not themselves imply manual exploration. Resize reflow uses the last actual view and Leaflet's immediate reset path to preserve exact FREE_EXPLORE center/zoom rather than accumulating half-pixel center drift.

Bus popup automatic panning is disabled under the camera provider so a moving open popup cannot defeat FREE_EXPLORE. The controller handles an explicit popup-open adjustment once, without enabling following. Existing stop popup behavior and close/dismissal semantics remain. Repeated Locate/stop requests are recognized by their event object and command revision, avoiding the old retained string-key deduplication issue after reselection.

## 5. Follow threshold, cadence and obstruction handling

- Explicit focus uses current zoom when it is 16–18; otherwise it deliberately chooses zoom 16 for useful street context. Stop navigation retains the previous 16–18 policy with default 17.
- Ordinary following preserves zoom and does not fit route bounds.
- The projected vehicle must leave a 24px safe interior before following recenters it.
- Displacement must reach **12 metres**, accumulated from the last camera-follow target. Unchanged positions and smaller jitter do not move the map.
- Follow moves are separated by at least **1,500ms** of real elapsed time. Rapid updates use one trailing timer reading the latest position. Manual interaction, mode changes, selection changes and unmount cancel it.
- Simulation positions normally update in five-second slots; the camera does not move on each one-second dashboard check. The safe-area condition reduces movements further.
- Explicit focus, popup and responsive layout actions can adjust immediately; they are separate from the periodic position-follow policy.

`cameraArea` reuses `visibleMapArea` and measures actual map/viewport, header, desktop detail, mobile sheet, toolbar, legend, zoom control and attribution rectangles. `cameraAnchor` also reserves measured bus-popup headroom. Hidden/offscreen or invalid geometry yields no invalid camera target. There is no fixed latitude/longitude offset tuned to one screen size.

All scripted camera transitions are intentionally immediate in both motion settings. This avoids overlapping flights/snapping oscillations and respects reduced motion. Smooth animated follow transitions are not added in this implementation.

Observers/listeners are bounded and cleaned up: a resize observer, coalesced layout frame, window resize/scroll handlers, map events and native input handlers all have teardown. Stable map and bus SVG DOM identity across a simulation update is verified by browser tests. No FPS or CPU benchmark is claimed.

## 6. Desktop, mobile and tablet UX

Desktop 1265 × 720: a compact camera status/action bar sits above the map, apart from zoom controls, legend, attribution and popup close targets. The existing bus detail card is sticky below the header on wide screens, with a viewport-relative height and its existing scrollable body, keeping its heading readable while the map is focused.

Mobile 375 × 844: the existing bottom sheet remains the only sheet. Expanded height is half the viewport, and the map frame adapts to the remaining half using flex layout. The camera bar stays reachable above the map in expanded and collapsed states. The header uses a compact grid, and close/toggle/locate, zoom and popup-close touch targets are enlarged to 44px. No horizontal overflow was observed in acceptance checks.

The informational legend hides while a popup is open so it cannot cover the close target; it returns on dismissal. Original popup boundary and five-point close-button hit tests pass unchanged. A new check confirms all four bus-marker corners remain unobscured after closing a focused popup.

Tablet 820 × 1180: grid/flex minimum-width fixes keep the existing single-column map/detail arrangement inside the viewport. The search/freshness header can shrink/wrap appropriately. Focus, drag suspension, Return visibility, attribution and horizontal layout were tested.

## 7. Files changed in this phase

Paths below are relative to the Candidate root. Earlier K.2A/K.2B-only changes remain in the working tree in addition to this phase's delta.

| File | Reason |
|---|---|
| `lib/map-camera.ts` (new) | Deterministic state machine, guard, follow policy and measured-area helpers |
| `components/bus-camera-context.tsx` (new) | Single authoritative shared camera state |
| `components/bus-map-camera.tsx` (new) | Camera execution, user-input detection, following, popup/layout coordination and portal controls |
| `app/map-camera.css` (new) | Toolbar, responsive sheet/map sizing, sticky desktop detail, tablet shrink behavior and touch targets |
| `components/dashboard.tsx` | Provider boundary and explicit Locate request callback; no duplicate mode state |
| `components/transit-map.tsx` | One active camera controller, toolbar host and responsive frame |
| `components/bus-route-layers.tsx` | Preserve visual layers and move fitting responsibility to the camera controller |
| `components/bus-vehicle-marker.tsx` | Coordinate popup panning with FREE_EXPLORE; SVG/icon/outline/offset behavior retained |
| `components/simulated-bus-panel.tsx` | Read shared mode to expose Return wording after suspension |
| `components/linkbike-layer.tsx` | Honor explicit station-fit intent through suspension/guard; no data or provider change |
| `tests/map-camera.test.ts` (new) | 29 state/guard/threshold/cadence/invalid-position/obstruction cases |
| `tests/bus-camera-context.test.tsx` (new) | Shared state persistence, selection/focus distinction and no transfer of following |
| `e2e/bus-hybrid-camera.spec.ts` (new) | Desktop/mobile/tablet camera, gestures, unavailable selection, popup and screenshot acceptance |
| `e2e/dashboard.spec.ts` | Update the existing scoped Locate locator to accept its contextual Return wording; functional assertions retained |
| `docs/SM-2.3K.2CD-local-implementation.md` (new) | This report |

## 8. Commands and results

Commands ran from the isolated Candidate with already-installed dependencies. `pnpm` was not invoked, and no dependencies were installed or updated. Existing Vitest/Playwright exclusions were unchanged.

| Exact command | Result |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/map-camera.test.ts tests/bus-camera-context.test.tsx tests/bus-map-routes.test.ts tests/bus-marker-graphic.test.ts` | PASS: 4 files, 47 tests |
| `node node_modules/vitest/vitest.mjs run` | PASS: 31 files, **411 tests**, final run 7.48s |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS, including final post-build check; tracked incremental output not rewritten |
| `node node_modules/eslint/bin/eslint.js .` | PASS, including final check |
| `node node_modules/next/dist/bin/next build` | PASS: optimized compilation, lint/type checking, static generation and build traces |
| `git --no-optional-locks diff --no-ext-diff --check` | PASS |

Development server:

```powershell
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100
```

Local production server:

```powershell
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
```

Final full configured production browser command:

```powershell
if(Test-Path -LiteralPath 'test-results/sm23k2cd-production-04'){throw 'Evidence directory already exists; refusing to overwrite'}
$env:TRANSITSCOPE_TEST_URL='http://127.0.0.1:3100'
$env:TRANSITSCOPE_TEST_CHROME='C:\Program Files\Google\Chrome\Application\chrome.exe'
node node_modules/@playwright/test/cli.js test --workers=2 --reporter=line --output=test-results/sm23k2cd-production-04
```

The environment variables are process-local test inputs, not project/deployment settings.

Final production result: **29 passed, 7 expected platform skips, 0 failed**, 38.1 seconds, **36 configured cases**. The preceding complete production runs also passed (27/29 applicable cases as cases were added, with the same seven platform skips).

The seven skips are explicit platform guards: five existing mobile-only popup cases skipped on desktop, one existing desktop-only popup case skipped on mobile, and the new tablet case skipped in the mobile project because it runs once through desktop Chromium. Pinch testing was supported and passed; it was not skipped. Older retired-contract suites remain excluded by their existing configuration and are outside the configured PASS count.

Focused camera browser commands used the same environment prefix and:

```powershell
node node_modules/@playwright/test/cli.js test e2e/bus-hybrid-camera.spec.ts --workers=2 --reporter=line --output=test-results/sm23k2cd-dev-01
node node_modules/@playwright/test/cli.js test e2e/bus-hybrid-camera.spec.ts --workers=2 --reporter=line --output=test-results/sm23k2cd-dev-02
node node_modules/@playwright/test/cli.js test e2e/bus-hybrid-camera.spec.ts --workers=2 --reporter=line --output=test-results/sm23k2cd-dev-03
```

Full development regressions used `test --workers=2 --reporter=line` with separate `--output=test-results/sm23k2cd-dev-regression-01` and `...-02` directories. Full earlier production runs used separate `.../sm23k2cd-production-01` and `...-02` directories. The additional popup/legend check used `test e2e/bus-hybrid-camera.spec.ts --grep 'closing a focused bus popup' --workers=2 --reporter=line --output=test-results/sm23k2cd-popup-review-01` and passed both desktop/mobile cases.

### Failed iterations and resolutions

Failures were retained and resolved, without changing exclusions or weakening existing assertions:

- Initial focused unit run: 46 passed, 1 failed because the existing Vitest JSX transform required an explicit React import in the new provider. Fixed the import; all 47 passed.
- First focused browser run: 3 failed, 4 passed, 1 skipped. Corrected tablet intrinsic-width overflow and exact FREE_EXPLORE center preservation during sheet resize. Increased the test's vehicle displacement so it actually leaves the desktop safe interior; recentering while still safely visible is intentionally avoided.
- First full development regression: 5 failed, 22 passed, 7 skipped. Fixed opened-popup versus overview-reflow priority, retained the last actual view through selection/sheet reflow, and prevented legend overlap with enlarged close targets. The unchanged boundary/hit-test assertions subsequently passed.
- Later full development regression: 27 passed, 7 expected skips. Marker-origin gesture checks then passed 9 cases with 1 expected tablet duplicate skip. Earlier production runs passed 27/29 cases with the same 7 skips as cases were added.

Final coverage includes selection without follow; explicit Locate; moving/unchanged/jitter/throttled positions; drag/wheel/button/touch/pinch suspension; stable FREE_EXPLORE through multiple updates and sheet changes; Return; unavailable selection/recovery; no follow transfer to a different bus; clearing selection; route switching/clearing; reduced motion; stable map/glyph identity; route hierarchy; tile failure; journey stops/preview; original popup boundaries/close hits; rail, LinkBike and alert dashboard flows.

## 9. Production visual evidence

Screenshots use synthetic tiles and CSS-pixel capture sizes. The screenshot helper waits for the map's scroll/resize layout frames rather than a timed sleep. The following rendered production output was inspected:

| Viewport | State / sheet | Captured production file | CSS-pixel image size |
|---|---|---|---|
| Desktop | overview | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-desktop-chromium/overview-synthetic-tiles.png) | 1265 × 720 |
| Desktop | vehicle-focus-expanded | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-desktop-chromium/vehicle-focus-expanded-synthetic-tiles.png) | 1265 × 720 |
| Desktop | free-explore-return | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-desktop-chromium/free-explore-return-synthetic-tiles.png) | 1265 × 720 |
| Mobile | overview | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-mobile-chromium/overview-synthetic-tiles.png) | 375 × 844 |
| Mobile | vehicle-focus-expanded | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-mobile-chromium/vehicle-focus-expanded-synthetic-tiles.png) | 375 × 844 |
| Mobile | vehicle-focus-collapsed | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-mobile-chromium/vehicle-focus-collapsed-synthetic-tiles.png) | 375 × 844 |
| Mobile | free-explore-return | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-mobile-chromium/free-explore-return-synthetic-tiles.png) | 375 × 844 |
| Mobile | collapsed-return | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-mobile-chromium/collapsed-return-synthetic-tiles.png) | 375 × 844 |
| Mobile | expanded-return | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-explicit-e0c15-route-intent-stays-explicit-mobile-chromium/expanded-return-synthetic-tiles.png) | 375 × 844 |
| Tablet | tablet-overview | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-tablet-l-f5dda-a-controls-without-overflow-desktop-chromium/tablet-overview-synthetic-tiles.png) | 820 × 1180 |
| Tablet | tablet-focus | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-tablet-l-f5dda-a-controls-without-overflow-desktop-chromium/tablet-focus-synthetic-tiles.png) | 820 × 1180 |
| Tablet | tablet-free-explore | [PNG](C:/Users/loong/.codex/visualizations/2026/11/16/01a1e476-2151-7c73-a64c-169bd7893a94/sm23j-candidate/test-results/sm23k2cd-production-04/bus-hybrid-camera-tablet-l-f5dda-a-controls-without-overflow-desktop-chromium/tablet-free-explore-synthetic-tiles.png) | 820 × 1180 |

Desktop: 1265 × 720. Mobile: 375 × 844. Tablet: 820 × 1180. Screenshots show readable mode/Return controls, selected marker contrast, route context, attribution and the existing sheet states. Desktop detail heading visibility and control/attribution hit testing are also asserted. Existing popup tests report zero overflow and successful hit-testing at all five close-button sample points.

## 10. Known limitations

1. Real OSM labels, roads/buildings/POIs and service availability were not visually accepted; deterministic browser tiles were synthetic or deliberately failed. The K.2A whole-raster filter limitation remains.
2. Touch drag/pinch were exercised through Chromium mobile emulation and CDP native touch events, not physical devices or Safari.
3. Scripted camera transitions are immediate rather than animated, including with normal motion preferences. Following is conditional and rate-limited; no FPS/CPU improvement is claimed.
4. This regional simulation contains only T401/T402. It does not represent every real Klang Valley bus route. No geometry, stop, timetable, speed or progression changes were made.
5. Browser evidence is local acceptance of this working tree and local build, not hosted Preview/Production acceptance. Viewports beyond the tested sizes were not exhaustively validated.

## 11. Preserved systems and strict stop boundary

No staging, commit, fetch, push, branch/worktree change, reset, clean, stash, discard, Git repair, merge, PR or deployment operation was performed. The 201 index entries still match the committed tree. The original workspace is unchanged and clean. All project edits are in the isolated Candidate; preparation/fingerprint artifacts are in the current Codex visualization directory.

No dependency, API key, paid service, OSM provider, live transit feed, transit API contract, simulation data/progression, rail simulation, alert data, LinkBike feature gate, Production LinkBike, AWS or Vercel configuration was changed. No hosted Preview or Production system was accessed. Existing Candidate evidence was not deleted or cleaned up. Local validation servers were stopped after acceptance.

## 12. Verdict

**PASS WITH LIMITATIONS** — K.2C/K.2D local implementation, regression checks, production build, viewport inspection and report are complete. The limitations concern real cartography/hardware coverage and the documented immediate-transition choice. No Git publication or deployment is authorized or performed. Work stops here.
