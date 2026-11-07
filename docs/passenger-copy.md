# Passenger-facing copy

This update changes presentation only. No files under `lib/` or `app/api/` are changed. The GPS projection, animation controller, passage interpolation, ±120-second adherence threshold, scheduled reference selection, history retention, timetable parsing, prediction eligibility and API responses remain intact. Internal enum values and IDs are still used for matching, controls and exact map selection.

## Terminology

| Previous default UI | Passenger-facing copy |
| --- | --- |
| GPS-INFERRED / GPS confidence / projection details | Hidden under Technical information |
| Progress inferred from GPS | Vehicle location |
| Current matched GPS position | Current bus location |
| En route / between stops | On the way to the next stop |
| APPROXIMATE | Approximate bus location |
| Progress unknown | Location unavailable |
| STATUS UNKNOWN | Status unavailable |
| Stale position / stale GPS | Location update delayed |
| Last seen | Last updated |
| Stop sequence, raw stop/trip/shape IDs | Hidden under Technical information |
| ON TIME | On time |
| DELAYED 22 MIN | 22 min late |
| EARLY 11 MIN | 11 min early |
| SCHEDULED / ESTIMATED | Scheduled / Estimated |
| LIVE ETA unavailable | Live arrival information unavailable |
| Frequency information / headway | Service intervals / Every N min |
| No upcoming service | No more services today |
| No scheduled service today | No service today |
| STATIC / SIMULATED mode labels | Timetable / Demo data |

LIVE vehicle records are labelled Vehicle location; they are not relabelled as live arrival predictions. A Live arrival remains eligible only through the existing verified prediction filter. Scheduled, Estimated and Live remain distinct. Demo data remains clearly labelled. Raw platform/stop identifiers are hidden; recognisable platform numbers remain useful passenger information.

## Updated surfaces

- `components/passenger-copy.ts`: UI-only wording/formatting helpers, contextual location/stop status and protection against exposing internal route codes as names.
- `components/dashboard.tsx`: overview, transport update status, filters, list/table, alerts, source/error explanations and a collapsed source diagnostic disclosure.
- `components/bus-journey-panel.tsx`, `components/gps-progress.tsx`: route header, location information, timeline, loading/errors and retained technical diagnostics. Exact stop selection still uses unchanged IDs/sequences in internal attributes. Only the visible/accessibility labels are simplified.
- `components/timetable-adherence.tsx`: readable timing labels; one expandable “About these times” explanation instead of repeated per-stop engineering text. Passing times use “Around” and historical results use “Earlier update”; neither asserts a confirmed stop arrival or departure.
- `components/transit-map.tsx`, `components/journey-map-layers.tsx`: rail availability, legends, vehicle/station tooltips, selected-stop popups and delayed-location wording.
- `components/upcoming-departures.tsx`, `components/train-arrival-rows.tsx`: consistent departure/arrival types, service intervals, contextual empty states and hidden stop/trip diagnostics.
- `components/official-alert-metadata.tsx`: readable announcement status/category, dates and original source links; raw classification metadata remains expandable.
- CSS and page metadata: sentence-case presentation, readable diagnostic disclosures and wrapping on mobile. Existing status colours remain paired with text.

## Diagnostics and accessibility

Existing technical disclosures are reused. The bus disclosure preserves the original matching/progress/stop/adherence data, confidence, raw sequences and timestamps. Station disclosures preserve stop references, arrival details, prediction eligibility reasons and source errors. Dashboard source diagnostics preserve feed health and errors. No data fields were removed from API models or responses, and no new debug service, polling or persistence system was introduced.

Screen-reader controls remain named and keyboard accessible. Stop controls now say “Show [stop name] on map”; internal sequence numbers remain available to the application for repeated-stop disambiguation. Timetable and historical status labels remain textual, not colour-only. Shared presentation helpers provide a single place to adjust English wording for future localisation; no translation is introduced here.

`e2e/passenger-copy.spec.ts` checks visible desktop/mobile text, selected-stop popups and labels, exact selection, hidden-but-retained diagnostics, readable timing labels, delayed updates, contextual unavailable states and Scheduled/Estimated/verified Live distinctions. Existing regression tests retain their calculations, timing, map, cancellation, request-count, grouping and layout assertions with updated UI expectations. The full unit suite protects unchanged calculations and API behaviour.
