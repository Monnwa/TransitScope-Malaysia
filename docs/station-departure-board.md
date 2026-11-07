# Station departure board UI

## Scope

The board stays in the existing selected transport panel. Vehicle details remain as before. Station technical fields are preserved under a "Station information" disclosure. The timetable parser, calendar calculations, geometry, coordinates, classification, map events, bus monitoring, alerts and layer controls are unchanged. No dependencies or deployment settings were changed. Existing uncommitted generated tsconfig.tsbuildinfo is preserved and excluded from the feature commit.

## Presentation and behavior

- Immediate station header: name, mode(s), operator for buses, interchange status, all existing line affiliations and canonical GTFS stop codes. Palette comes from the existing railway metadata, including KTM and bus colours. Codes are never inferred from station names.
- Precise SCHEDULED rows emphasize 24-hour MYT time, route and destination. Direction and platform/stop are shown where provided. Five rows appear by default and up to ten can be expanded without another API request. Interchanges have line groups ordered by their upcoming services; each line retains its heading even when its next rows fall beyond the initial five. Single-line boards omit redundant group headings.
- Frequency information is separate, with published headway and dated operating windows. No exact timestamps or countdowns are generated from headways. Two windows per line are initially visible; additional periods have their own disclosure. Weekdays and service dates are displayed in Malaysia time; midnight crossings show the end date.
- A neutral blue status distinguishes scheduled service, frequency information, no upcoming service and unavailable timetable. A green LIVE ETA indicator requires available verified prediction rows, an approved source URL and future estimate timestamps; an available boolean alone cannot trigger it. The current API has no such predictions and shows LIVE ETA: UNAVAILABLE.
- Source URLs, retrieval and last successful source refresh are retained under a compact disclosure. Scheduled information is explicitly described as distinct from live arrival information.
- Refresh preserves existing rows, disables the button during retrieval and guards rapid duplicate actions. Failure retains previous data and last retrieval time, explains the failure and offers Retry. Switching station keys clears the previous board synchronously and aborts/ignores stale requests. Presentation removes timestamps that have passed; it does not calculate or change any service timetable.
- CSS is scoped to the departure board and its existing panel, with fixed-width time columns, wrapping destinations, semantic headings, keyboard buttons, aria-expanded controls and polite status announcements. Desktop and 390px mobile viewport checks include long destinations and data-source links.

## Additive response correction

The existing departures endpoint conflated empty causes in its message/status. It now adds `emptyReason` without changing its original fields or calculation:

- TIMETABLE_UNAVAILABLE: no records or no applicable published calendar coverage.
- NO_SERVICE_TODAY: a relevant calendar covers today, but the existing calculation reports no service today and no remaining departures today.
- NO_MORE_TODAY: the existing calculation reports that today's departures ended.

This reuses the existing result and relevant calendar coverage. Tomorrow's returned departures remain intact and are displayed with their date. Missing or expired calendars are not presented as confirmed closures. Tests exercise these distinctions against the real endpoint function.

## Files

- `components/upcoming-departures.tsx`: targeted board rendering and request-state behavior, reusing /api/departures.
- `components/dashboard.tsx`: station-only panel wiring; technical disclosure, unchanged vehicle details.
- `app/departure-board.css`: scoped UI styling.
- `lib/departure-board.ts`: display formatting, safe source links, chronological row presentation and empty messages.
- `app/api/departures/route.ts`: additive empty-state metadata only.
- `e2e/departure-board.spec.ts`: grouping, 5/10 expansion, failed refresh retention, station switching, empty states, frequencies, midnight and mobile behavior.
- `e2e/departures-alerts.spec.ts`: existing assertions retained; the previously dated synthetic fixtures now use a deterministic fixture clock, and frequency text assertion is case-insensitive.
- `tests/departure-board.test.ts`, `tests/departure-empty-states.test.ts`: presentation and metadata tests.

## Validation

Baseline: TypeScript, ESLint and 28 unit tests passed. Updated suite: 35 unit tests and 22 Playwright tests. Existing timetable, official alerts, MRT geometry, station persistence, rail toggles, bus search and dashboard fixtures remain covered. Synthetic test schedules never enter production sources. Production screenshots and deployed mode-by-mode results are delivered in the final report after Vercel deployment.
