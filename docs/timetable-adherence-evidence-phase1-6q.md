# Phase 1.6Q — Deterministic journey parity validation

## Processing flow at `d1f9c3f`

`official-transit.ts` decodes the vehicle feed and passes timestamped records to `VehicleProgressHistory.ingest()`. History is scoped by source and vehicle. The store holds recent accepted fixes and the previous evaluated progress, including inferred stop crossings. `ProcessedBusJourneys.processWithPersistence()` can also use validated GPS evidence from the optional Redis persistence path. The live Preview comparison did not give the two instances identical histories. [Official feed processing](../lib/official-transit.ts) · [Progress history](../lib/vehicle-progress-history.ts) · [Phase 1.6P results](timetable-adherence-evidence-phase1-6p.md)

`ProcessedBusJourneys.process()` calls `calculateBusJourney()` with the vehicle, normalized GTFS timetable, trip and progress geometry, shape distances, the selected history and an evaluation clock. The timetable comes from official GTFS Static trip, route, stop, stop-time, service calendar and frequency data. Matching and scheduled times depend on the trip identity and Kuala Lumpur service date. The measurement timestamp, receipt time, evaluation time, static snapshot timestamp and retained fixes or crossings all affect returned fields. [Journey calculation](../lib/bus-journey.ts) · [Timetable normalization](../lib/scheduled-departures.ts)

When the archive is enabled and ready, processing saves the set of directly evaluated adherence results before applying history retention and diagnostics. `archive.capture()` then reads the completed journey for eligible evidence. It rechecks the classification and builds a separate record with a stable ID and checksum. The staged archive holds that record in its own map. `finishFeed()` starts admission after the journey has been calculated. Awaited mode waits for PostgreSQL admission, and deferred mode retains that work through the request scheduler when available. Delivery and terminal receipts are handled separately. Archive work has no designed path to update the returned journey or remove fixes or crossings from the journey history. The regression checks below exercise that boundary. [Feed and archive boundary](../lib/processed-bus-journeys.ts) · [Evidence capture](../lib/classification-evidence.ts) · [Archive store](../lib/classification-evidence-store.ts)

## Captured fixture and baseline

The fixture uses seven archived direct GTFS-Realtime polls from the 8 November 2026 coverage audit and the GTFS Static ZIPs collected with them. It contains 21 vehicle records from three runs selected for their reproducible, archive-eligible crossings. GPS measurements span 16:30:06–16:33:08 MYT and capture receipts span 16:30:49.985–16:33:56.024 MYT. Vehicle and trip identifiers, reported GPS measurements, feed publication times, capture receipts, trip stop sequences, schedule rows, service calendars, frequencies and route geometry are retained. The recorded public fleet labels matched the vehicle identifiers. No API credentials, personal fields or unrelated vehicles were carried into the fixture. [Original capture methodology](timetable-adherence-coverage-audit.md)

| Official source | Vehicle | GTFS trip | Stops | Crossings retained before final poll | Distinct archive IDs across replay |
| --- | --- | --- | ---: | ---: | ---: |
| Rapid Bus MRT Feeder | `VAC5751` | `261030030212S15` | 11 | 1 | 1 |
| Rapid Bus Penang | `PLP9016` | `261027035004S7` | 9 | 2 | 2 |
| Rapid Bus Penang | `RAPID695` | `261027030215S9` | 31 | 1 | 1 |

Extraction checked the selected records against the archived original protobuf messages. The fixture contains their SHA-256 hashes and the hashes of the two original static ZIPs. The reduced timetable keeps every candidate trip on each selected route, including original stop-time rows and the associated service definitions. Replay of the reduced timetable matched replay of the full captured timetables on all 21 complete journey results for the selected vehicles and the retained crossings before the final poll. The fixture uses the actual capture receipt as the deterministic evaluation time for each round and the static capture receipt as `staticUpdatedAt`. These are fixed replay clocks. Original GPS measurement and publication times are preserved separately. Kuala Lumpur service-date rules remain in use.

The gzip files decode to JSON. SHA-256 of the decoded input is `1880a8b03c3d021366ab85042df0d196417e93f8da83245204647adc3b1fad2b`. SHA-256 of the decoded disabled baseline is `10906d28bcfe3bd5cc227061ff7c3348d635f98a18bae59afd5cc00ad330bf01`. The baseline contains the entire disabled API-equivalent journey objects, including 357 stop appearances and ten classified appearances across the seven rounds. Three were `ON_TIME`, six `EARLY` and one `DELAYED`. These appearances are separate from the four distinct archive IDs. Test runs load the fixed inputs and expected outputs without rewriting either file. [Compressed input](../tests/fixtures/journey-parity/official-2026-11-08.json.gz) · [Compressed baseline](../tests/fixtures/journey-parity/disabled-baseline.json.gz)

## Paired replay results

All runs start with a fresh `VehicleProgressHistory` and `ProcessedBusJourneys` for each captured vehicle and replay all seven observations in order. Each case checks the retained crossing list against the frozen history before the last poll. Redis persistence is absent in every mode. The tests reject outbound fetches and each enabled run uses its own embedded PostgreSQL database with the actual migrations and query implementation.

| Mode | Effective configuration | Complete journey comparison | Database and scheduler observations |
| --- | --- | --- | --- |
| A. Disabled | Explicit `false`, Deferred Admission `0`, valid-format fixture writer URL. The initializer returns no archive instance. | 21 of 21 matched the persisted disabled baseline. A second fresh replay matched the first field by field. | Zero retained admissions and no database client or transport call. |
| B. Awaited | Local archive constructed with seven-day retention and Deferred Admission off. | 21 of 21 matched A by strict in-memory comparison. | Four `PENDING` intents before flush. All four delivered with the expected snapshot checksums and `PERSISTED` receipts. Zero retained admission callbacks. |
| C. Deferred | Local archive constructed with seven-day retention, Deferred Admission on, and a request continuation callback. | 21 of 21 matched A by strict in-memory comparison. | The scheduler retained admission work. The same four intents, checksums and terminal receipts were verified after retained work and flush. |
| B and C with admission failure | Same modes and migrations. The query adapter rejects the outbox insert with SQLSTATE `57014`. | 21 of 21 matched A in each mode. | The tests observed attempted admission and volatile staging, zero committed intents, and no changes to returned journeys. |

The three normal modes ran concurrently using the same deeply frozen input and independent runtime state. The complete output objects matched, with no field exclusions. This includes trip matching, stop states, scheduled and inferred crossing timestamps, classification, unavailable reasons, diagnostics, delay and ETA. The test also checks returned objects after retained admission and delivery have settled, and verifies the shared fixture serializes identically after every case. No output differences were observed. [Regression cases](../tests/journey-archive-parity.test.ts)

## Regression results and Phase 1.6R decision

| Local check | Result |
| --- | --- |
| Unit suite | **378 tests passed across 29 files**, including all four new parity cases. |
| TypeScript | `pnpm exec tsc --noEmit --incremental false` passed. |
| ESLint | `pnpm run lint` passed. |
| Production build | `pnpm run build` passed on Next.js 15.5.28. |

The deterministic journey parity gate is satisfied for these captured inputs. A separately authorized, controlled Phase 1.6R Preview opt-in is justified after the isolated database and Preview scope are verified. The sample covers three runs from two sources with real crossings. It is independent of live feed availability and does not measure hosted network behaviour, eviction, invocation timeout, or process termination. The rejected insert is injected at the local query adapter. The concurrency result covers independent processing instances sharing immutable input. It does not establish hosted concurrent request behaviour or delivery guarantees.

Phase 1.6Q adds local regression tests, fixture data and this report. The runtime implementation at `d1f9c3f` was sufficient. Preview and Production archival remain disabled, and the test artifacts are uncommitted.
