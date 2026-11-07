# Bus animation and exact stop navigation

## Display interpolation

`lib/route-animation.ts` is an injected-clock controller. The selected journey owns one controller; its requestAnimationFrame subscribers update the selected Leaflet marker, the two route segments, and the timeline icon imperatively. Other map layers and the React tree do not rerender per animation frame. Route segments update at most about 15 times per second; the marker and timeline use the same current cumulative distance. Existing journey polling and GTFS caches are reused.

Only consecutive fresh HIGH GPS matches on the same vehicle/run, observation session, route and geometry animate. The first observation, reduced motion, confidence changes, discontinuities and identity changes update directly. A new target replaces the pending animation from the currently rendered distance. Distance advances linearly along the original WGS84 GTFS shape; coordinates and bearing come from the containing shape segment, including curves. Duration is at least the source observation interval, and is increased when catching up would otherwise exceed observed speed. There is no extrapolation after the latest target. Duplicate or older observations do not restart animation; small backward noise preserves the current forward animation. Confirmed passed-stop evidence beyond the rendered distance triggers a direct authoritative update, keeping passed stops above the bus.

The timeline locates visible stop nodes by their exact sequence and interpolates their pixel positions using the same shape distance fraction. It remeasures on layout changes, without scrolling on GPS updates. Its caption distinguishes interpolation from a new observation. Animation never changes stop states, times, delay evidence or ETA. A stale withdrawal freezes the rendered historical point and cancels frames; freshness recovery starts directly. Vehicle changes and panel unmount cancel resources. OS reduced-motion changes immediately finish the visual transition at the verified target.

## Stop selection

`JourneyStop.position` comes from the exact `stop_id` in the existing official `stops.txt` table. Both ID and sequence identify a selected row, so repeated stop visits and neighbouring stops with the same name are distinct. Missing/invalid coordinates retain the row and show “Map location unavailable”; they never navigate to a guessed location. Selection belongs to the vehicle/route/departure context, survives GPS refreshes, and clears on context changes or closing the panel.

`lib/journey-stop-selection.ts` contains pure selection and viewport calculations. `components/journey-map-layers.tsx` manages Leaflet navigation and the separate selected-stop ring/popup. Explicit row clicks choose zoom 17, retaining an existing stop-level zoom of 16–18. The target is offset into the visible map area after subtracting overlapping headers and the expanded mobile sheet. Resize/sheet changes keep it visible. GPS updates do not follow, pan, scroll or replace the selected stop. The popup reports exact ID/sequence, scheduled times, route, status and confidence. `Locate bus` clears the stop and focuses the displayed verified bus position; timeline scrolling affects only the panel body. The bottom sheet keeps its expansion state.

## Sources and boundaries

No new geometry or polling source is introduced. Shape geometry, stops and timetable relations remain from the [Malaysia official GTFS Static API](https://developer.data.gov.my/realtime-api/gtfs-static); observations remain from the [official GTFS-Realtime API](https://developer.data.gov.my/realtime-api/gtfs-realtime). Coordinates use Leaflet latitude/longitude order. The existing confidence, ambiguity, continuity and stale guards remain authoritative. LIVE POSITION is still a source observation; moving display positions are visual interpolation, never LIVE ETA.

Offline/missing geometry, ambiguous projection, low-confidence fixes and timetable previews cannot produce an animated GPS claim. Sparse or stationary feeds may display a fixed marker until another verified movement arrives. Slow observation intervals intentionally produce delayed visual motion instead of a prediction. GPS cannot establish whether a bus actually served a stop.

## Validation

`tests/route-animation.test.ts` uses an injected clock and synthetic shape: straight and curved travel, bearing, cumulative distance, speed cap/catch-up, invalid jump, jitter, duplicate/out-of-order packets, stale freeze/recovery, trip/route/shape/vehicle/session changes, cleanup, reduced motion, low confidence, passed-state integrity, timeline fractions, exact IDs, missing coordinates and mobile/desktop viewport obstructions.

`e2e/bus-animation.spec.ts` uses explicitly synthetic GTFS/GPS responses and Playwright clock control. It checks marker movement, the route corner, synchronized timeline distance/fraction, endpoint/stale behaviour, reduced motion, first/middle/last stop clicks, popup/highlight, stable selection and panel scroll on refresh, Locate bus, mobile/desktop offsets, and trip/vehicle/close cleanup. Existing rail, alerts, timetable and GPS browser regressions remain part of the full suite.
