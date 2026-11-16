# Phase 1.6S — Protected Preview replay API and candidate lifecycle tracing

The local implementation adds `/api/internal/preview/evidence-replay` for the fixed Phase 1.6Q cohort. It uses fresh journey history and archive instances for each run. The replay database holds a reservation and candidate trace. Reconciliation reads the existing outbox and archive rows in one database snapshot. [HTTP handler](../lib/preview-evidence-replay-http.ts) · [Replay processor](../lib/preview-evidence-replay.ts) · [Database adapter](../lib/preview-evidence-replay-db.ts)

## Processing and fixture

The Phase 1.6Q inputs and disabled baseline are the original gzip JSON files under `tests/fixtures/journey-parity/`. The replay checks their decoded SHA-256 hashes, caps decompression, and freezes the parsed values. The build includes both files in the internal route's file trace. A replay rebuilds the timetable from the captured GTFS rows, ingests the original timestamped GPS observations through `VehicleProgressHistory`, and invokes `ProcessedBusJourneys.processWithPersistence()` at the captured evaluation times. The selected journey digest covers the complete outputs and is compared with the Phase 1.6Q baseline. Responses carry the digest and comparison result without returning GPS observations or the full journeys. The registered fixtures are `phase-1-6q` for all 21 outputs and `feeder`, `penang-early`, and `penang-delayed` for seven outputs from one vehicle run. [Fixture provenance](timetable-adherence-evidence-phase1-6q.md) · [Captured input](../tests/fixtures/journey-parity/official-2026-11-08.json.gz) · [Disabled baseline](../tests/fixtures/journey-parity/disabled-baseline.json.gz)

The archive still captures evidence with `captureClassificationEvidence()`, stages eligible records in its bounded map, and dispatches through `finishFeed()` and the existing outbox store. The optional capture observer records eligible IDs, staging and capacity or size rejection. The replay-only store records admission attempts before dispatch. PostgreSQL still owns commit, archive and receipt state. Normal feed and vehicle-detail routes use their existing archive initialization and omit the replay observer. [Shared feed processor](../lib/processed-bus-journeys.ts) · [Capture and admission](../lib/classification-evidence-store.ts) · [Delivery migration](../database/classification-outbox.sql)

## Security and configuration

- The handler requires exact `VERCEL_ENV=preview`. An absent or different environment fails closed. It also refuses access when the normal archive switch is `true`.
- `TRANSIT_PREVIEW_REPLAY_SECRET` is a separate server-only bearer secret. Use a random URL-safe value of 32–128 characters. The handler checks it with a constant-time comparison before opening storage or reading a request body. Existing Vercel deployment protection still applies.
- `TRANSIT_PREVIEW_REPLAY_DATABASE_URL` is a server-only credential for a restricted role on the isolated Preview database. `TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED=true` independently permits synchronous and deferred replay writes. The default supports disabled replay only. Per-run mode uses the same awaited or retained archive behavior without editing environment variables or process configuration.
- POST accepts strict JSON with a UUID request ID, one fixture ID, one mode and an optional enumerated fault. It caps the body at 1 KiB, gives the body 1.5 seconds, and bounds a replay to 35 seconds inside the 60-second route limit. Neon transactions have a 1.5-second client timeout. Paths, SQL, URLs and unsupported keys are rejected. Responses are marked `no-store`.
- A database index reserves one uncleaned run at a time. The caller-supplied request ID remains unique after cleanup. A duplicate request or a second outstanding run receives HTTP 409. The database checks the run reservation before each archive transaction. A stale run can be cleaned after the 90-second lease expires.

[Route](../app/api/internal/preview/evidence-replay/route.ts) · [Environment template](../.env.example) · [Next.js `after()`](https://nextjs.org/docs/15/app/api-reference/functions/after)

## Request and reconciliation

```http
POST /api/internal/preview/evidence-replay
Authorization: Bearer <preview-replay-secret>
Content-Type: application/json

{"requestId":"6a3b2344-66e1-4d29-80b6-39e2ed10a10e","fixtureId":"feeder","mode":"disabled"}
```

The accepted response is HTTP 202 with this shape. The digest shown is abbreviated.

```json
{"replayRunId":"c8356c87-3080-48d8-aeea-5ecf5f825208","journeysProcessed":7,"journeyDigest":"<sha256>","matchesBaseline":true,"error":null}
```

Use authenticated `GET /api/internal/preview/evidence-replay?replayRunId=<id>` for the report. It contains the execution mode and candidate-level records with the run ID, stable candidate ID, fixture journey ID, generation time, lifecycle state, admission attempt count and any verified database identifiers. The receipt uses the outbox row's record ID. A returned HTTP 202 describes replay execution. The GET report provides durability evidence. Use authenticated `DELETE` at the same URL to clean a finished or expired run. Export the report first because a cleaned run is unavailable from GET. Authenticated `PATCH` at the same URL starts a new scoped delivery worker for a finished `after-commit` run. It requires replay writes to be enabled.

| Lifecycle state | Evidence |
| --- | --- |
| `GENERATED` | The existing classifier produced a registered evidence ID. Expected fixture IDs alone do not count as generated. |
| `STAGED` | The capture observer saw the record enter the in-memory archive buffer. |
| `ADMISSION_PENDING` | An active run recorded an admission attempt before dispatch and has no verified commit for that ID. |
| `COMMITTED` | A matching persisted outbox payload exists, or a delivery receipt matches the archived evidence checksum. Pending delivery can still be present. |
| `ARCHIVED` | A matching persisted archive row exists. |
| `TERMINAL` | A matching `PERSISTED` or `RECOVERED` receipt accompanies the archived row. |
| `REJECTED` | The capture observer recorded capacity or size rejection, or the explicit rejection hook fired, and there is no verified commit. |
| `FAILED` | A matching outbox row has a terminal `FAILED` receipt. |
| `UNRESOLVED` | Available evidence is insufficient to verify the candidate's outcome. This includes a reservation that outlives its volatile observations. |

Counts for generated, staged, attempts, committed, archived, terminal, rejected, failed, unresolved and pending are derived from the returned candidate records. These measures can overlap. A failed terminal receipt is included in the terminal receipt count. Admission attempts are journaled before submission, so the attempt count can include an interruption before a database request is sent. Outbox delivery attempts are read separately. [Reconciliation](../lib/preview-evidence-replay.ts) · [Durable state query](../lib/preview-evidence-replay-db.ts)

## Fault controls

| `fault` | Local behavior |
| --- | --- |
| `rejection` | Explicit simulated admission rejection with its own reason, separate from the archive's capacity and size reasons. |
| `outage-once` | Interrupts the first submission and permits the same-ID retry after the existing cooldown. |
| `before-commit` | Interrupts dispatch before the outbox insert. The report has no commit or terminal receipt for the candidate. |
| `lost-ack` | Completes a real outbox transaction in the selected database, then throws before returning its acknowledgement. The original admission path reconciles the same ID. |
| `after-commit` | Injects the interruption after commit and skips delivery in the original run. A separate PATCH can claim and deliver the verified pending intent. |
| `duplicate` and `concurrent-duplicate` | Submit the same evidence twice, sequentially or with overlapping requests. The reservation lock serializes the database mutations. |

These hooks belong to an authenticated replay instance and use the existing store and migrations. The tests use embedded PostgreSQL. Hosted process termination, provider eviction, invocation timeout and timing in the Vercel region remain unverified. Retained work can end with the invocation, and a report may show unresolved candidates when volatile work is lost. [Fault adapter](../lib/preview-evidence-replay.ts) · [Neon HTTP transactions](https://neon.com/docs/serverless/serverless-driver#issue-multiple-queries-with-the-transaction-function)

## Database setup and cleanup

Use a verified isolated Preview database and a role restricted to schema `transit_preview_replay`. Create the schema and remove public access. In an owner session, set the search path to `transit_preview_replay, pg_catalog` and apply `classification-evidence.sql`, `classification-outbox.sql`, and `classification-replay.sql` in that order. The archive migrations create copies of the existing tables and delivery function in the replay schema. The replay migration adds the run ledger, uniqueness constraint and reservation guard. Grant the replay role schema usage, ledger SELECT/INSERT/UPDATE, archive SELECT/INSERT/DELETE, outbox SELECT/INSERT/UPDATE/DELETE, and execution on the two replay-schema functions. Keep normal archive schemas outside those grants. The application pins the replay schema inside each Neon HTTP transaction. No formal evidence snapshot field changed. [Evidence migration](../database/classification-evidence.sql) · [Outbox migration](../database/classification-outbox.sql) · [Replay migration](../database/classification-replay.sql)

Reservation requires empty replay outbox and archive tables. Cleanup locks the finished or expired run and deletes only IDs in its fixture ledger with matching evidence checksums. The request ID stays reserved to prevent accidental reuse. Unexpected rows are preserved and block the next reservation until inspected. Record the database identity and verify its grants before any future hosted replay. No cloud configuration, migration or deployment was performed during implementation.

## Local verification and hosted limits

| Check | Result |
| --- | --- |
| Unit suite | **393 tests passed across 30 files**, including 15 new replay tests and the existing normal transit route and deterministic parity tests. |
| TypeScript and ESLint | Passed with `pnpm exec tsc --noEmit --incremental false` and `pnpm run lint`. |
| Production build | Passed on Next.js 15.5.28. Both original fixture files were present in the internal route's deployment file trace. |

Both enabled modes returned the baseline digest for all 21 journeys and reconciled four stable candidates to four committed intents, four archived rows and four terminal receipts. The held-insert test returned the deferred replay while admission was pending and verified zero durable rows until the insert was released. Fault tests covered lost acknowledgement, retries, repeated and overlapping same-ID writes, before-commit interruption, and post-commit recovery through a fresh store. Cleanup tests preserved rows in the normal archive schema. [Replay tests](../tests/preview-evidence-replay.test.ts) · [Full journey parity tests](../tests/journey-archive-parity.test.ts)

Hosted deployment, Neon grants, and the per-transaction deadline still need a Preview validation run. The admission fault controls simulate adapter failures. They do not terminate a Vercel instance or produce a provider-level network outage. The implementation and fixtures are local and uncommitted. Preview and Production archival remain disabled.
