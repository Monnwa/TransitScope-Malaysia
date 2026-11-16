# Phase 1.6A — Immutable classification evidence records

The local implementation preserves the accepted crossing proof for a timetable adherence result in a separate PostgreSQL archive. An archived classification can be reproduced after the live tracking buffer is gone. The archive is opt-in and its records stay out of passenger responses.

Reference: [Phase 1.5 evidence consistency audit](timetable-adherence-evidence-phase1-5.md).

## 1. Evidence record schema

The migration creates `transit_classification_evidence_v1`. Each row contains a complete JSONB snapshot and indexed record identity, run-stop identity, evaluated GPS measurement time and expiry.

| Field group | Preserved values |
| --- | --- |
| Run-stop identity | Source, vehicle ID, trip ID, service date, run key, route, direction, shape, stop ID and stop sequence. `runStopId` hashes source, vehicle, run key, stop and sequence. |
| Crossing proof | The exact accepted pair, including both original measurement timestamps, projected and raw route distances, offsets, accuracy, confidence and context. The stop projection, confirmation time and projection fingerprint accompany the pair. |
| Classification | Exact scheduled departure, inferred passage time, signed deviation in seconds, `EARLY`, `ON_TIME` or `DELAYED`, and the 120-second tolerance. |
| Clocks | `generatedAtMs` records the original journey assessment clock. `evaluatedFixMs` identifies its latest GPS measurement. The pair endpoints and confirmation keep their original clocks. |
| Versions and validity | Schema version 1 and algorithm `gtfs-gps-adherence-v1`. The record ID identifies the evidence version, and a checksum covers the whole snapshot. Admission requires a replayable accepted proof. The read result reports its current historical lifecycle state. |
| Retention | `expiresAtMs` is fixed when the snapshot is created. Neither re-reading nor reconfirming it changes that value. |

The stored endpoint observations are the projected GPS observations used by the existing classifier. Their schema does not contain original raw latitude and longitude. The archive preserves the available values exactly and can reproduce the passage and timetable comparison from them without rematching a route.

## 2. Architecture and storage decision

| Option | Assessment |
| --- | --- |
| Extend the GPS Redis store | A separate namespace with create-if-absent writes could deduplicate records. Retained versions, run-stop queries, expiry and archival recovery would still need additional indexes or scripts. The Phase 1.4 evidence disruption makes this an unsuitable dependency for the historical archive. |
| Separate PostgreSQL archive | A primary key enforces record identity and a single insert statement writes each batch atomically. Run-stop and expiry indexes support audit reads and maintenance. The archive can recover committed proofs independently of live GPS storage. |

The implementation uses PostgreSQL and the Neon HTTP driver for the opt-in server adapter. Local validation executes the same SQL against PGlite with disk-backed storage. The runtime does not use PGlite or a local database file. [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) · [PGlite filesystem storage](https://pglite.dev/docs/filesystems)

For a separately approved test environment, apply [the migration](../database/classification-evidence.sql) to an isolated database, then set the server-only `TRANSIT_CLASSIFICATION_DATABASE_URL`. The runtime writer needs SELECT and INSERT privileges. Keep migration and retention deletion privileges with separate credentials. `TRANSIT_CLASSIFICATION_RETENTION_DAYS` accepts 1–30 days and defaults to seven. The blank example URL leaves the feature disabled.

## 3. Lifecycle states

| State | Meaning |
| --- | --- |
| `VALID_HISTORICAL` | The stored proof and checksum reproduce the recorded calculation, and the record is within archive retention. This says nothing about the vehicle’s current position or freshness. |
| `SUPERSEDED` | A newer recorded version exists for the same run-stop. The older valid snapshot remains independently reproducible. |
| `EXPIRED_EVIDENCE` | A valid snapshot has reached its archive cutoff. Its read result includes the recorded summary and omits the pair. |
| `UNREPRODUCIBLE` | A row lacks its proof or uses an unsupported version. The store preserves the original row and does not create substitute evidence. |
| `INVALID_EVIDENCE` | The row fails shape, identity, checksum or evidence verification. A new rejected candidate stays out of the archive. |
| `NOT_FOUND` / `UNAVAILABLE` | An absent row and a failed database read are distinct outcomes. A physically purged row is absent. |

Lifecycle is derived at read time. Integrity and version checks precede expiry. Expiry takes precedence over supersession. Supersession uses the greatest evaluated GPS measurement time and a stable record-ID tie break for equal measurements. It does not use arrival order or change the live assessment.

## 4. Implementation

`ProcessedBusJourneys` captures a snapshot only when the returned result comes directly from the existing assessment and passes the archive’s reproduction checks. Cached, out-of-order and retained results do not generate a new snapshot. A missing crossing pair, stale generation-time GPS or inexact schedule cannot enter the archive. The archive preserves the original assessment clock even when a retry commits later.

The fleet and bus detail routes schedule the flush with Next.js `after`. This lets the response finish without waiting for the archive write. The archive never feeds its proof back into live progress or passenger classifications. [Next.js after documentation](https://nextjs.org/docs/app/api-reference/functions/after)

| File | Role |
| --- | --- |
| `lib/classification-evidence.ts` | Captures, identifies, validates and reproduces immutable records. |
| `lib/classification-evidence-store.ts` | Provides PostgreSQL append, read and run-stop lookup, plus bounded retry handling. |
| `database/classification-evidence.sql` | Creates the table, key constraints and indexes. |
| `lib/processed-bus-journeys.ts`, `lib/official-transit.ts`, bus API routes | Connect existing server-side processing to the opt-in archive. |
| `lib/bus-evidence.ts` | Exports the existing crossing-pair schema so both stores use the same evidence shape. |
| `tests/classification-evidence.test.ts` | Exercises the real migration, lifecycle, failures and existing processor integration locally. |

Internal reads use `read(recordId)` or `list(runStopId)`. The latter returns up to 100 newest versions. Older known versions can be read directly by ID. There is no public historical API. The expiry index supports maintenance scans. Fleet-wide reporting would need its own query design.

## 5. Idempotency, writes and recovery

- The record ID binds the run-stop, evidence pair, projection, schedule, outcome and algorithm version. A new retrieval time, later confirmation of the same pair, or a repeated assessment of identical evidence keeps the same ID. The stored snapshot still contains the original confirmation and generation clocks.
- PostgreSQL inserts with `ON CONFLICT (record_id) DO NOTHING`. The first committed version wins for that ID. Duplicate candidates in a single batch prefer the earliest captured generation. The write path never overwrites an existing snapshot. A new valid proof version receives a new ID. [PostgreSQL INSERT documentation](https://www.postgresql.org/docs/current/sql-insert.html)
- Only IDs returned by the database count as newly inserted. Duplicate acknowledgements are separate. A lost acknowledgement leaves the outcome unconfirmed. Retrying the same ID can resolve it as an existing record without a second insert.
- The in-process retry buffer retains the original candidate across transient failures. It holds at most 2,000 records and 4 MB of serialized candidate data. Batches are capped at 256 KB. One flush at a time drains batches under a 2.5-second client deadline, with a 1.5-second HTTP request timeout and a 30-second delay after failure. Pending, expired, rejected, dropped and failed counts remain separate from confirmed writes.
- A later request in the same runtime can retry pending records. Committed rows and database-enforced deduplication survive restarts. The buffer is volatile, so an instance exit can lose unconfirmed candidates. A database statement might finish after a client timeout. Idempotent retry or read-back is needed to establish its outcome.

## 6. Local validation

| Check | Result |
| --- | --- |
| New archive tests | 9 passed against disk-backed local PostgreSQL |
| Full unit suite | 340 passed across 28 files |
| Full Chromium regression | 100 passed against the local production build |
| TypeScript and ESLint | Passed |
| Production build | Passed on Next.js 15.5.28 |

The new tests cover exact proof capture, retrieval after the live pair is removed, reopening the database, repeated and out-of-order GPS, duplicate and overlapping inserts, valid supersession, expiry, missing or corrupt evidence, write failure and lost commit acknowledgement. The fleet integration test compares the complete returned journey with the existing processor for the same observations. The browser suite used the default disabled archive configuration.

## 7. Storage and retention implications

The proposed seven-day archive window supports review across several operating days. It starts at the end of the Malaysia Time GTFS service day, independently of the live GPS store’s 60-minute window. The fixed service-date cutoff prevents repeated observations from extending a proof’s lifetime. Revisit the window after measuring real audit demand.

In a read-only sizing pass, 162 directly reproducible results across 13 Phase 1.4 archives averaged 2,192 bytes as serialized records, with P95 of 2,201 bytes. These are record sizes, not measured PostgreSQL storage or a measured write rate. For planning, 60,000 new versions per day would generate about 132 MB of raw records daily. Seven to eight retained service-day cohorts would occupy about 0.92–1.05 GB before database overhead. Budget 1.4–2.1 GB initially for data and index headroom, then measure actual relation size, compression, write amplification and unique-version rate.

At the published Neon storage rate of USD 0.35 per GB-month, that planning budget corresponds to roughly USD 0.49–0.74 per month for base storage. Compute, restore history and transfer are separate. This is a sizing scenario and no cloud resource was provisioned. [Neon pricing](https://neon.com/pricing)

The local implementation enforces logical expiry. Physical retention needs an operator-managed cleanup job before activation. Delete expired run-stop groups in bounded batches once all versions in the group have expired. Keeping each group intact until then avoids revealing an older version as the newest after a partial purge. Coordinate retention policy changes with cleanup and review backup retention separately.

## 8. Known limitations and review

The migration, persistence and recovery were tested with local PostgreSQL. The managed HTTP database path, cold connection behaviour and fleet-scale cost remain unmeasured. The volatile buffer prioritizes the passenger response during outages. A durable ingestion queue would be required for a guarantee that every accepted generation survives process loss before commit.

The archive applies prospectively. Phase 1.5’s live response freshness and tracking retention discrepancies remain separate work. A future algorithm version needs a compatible verifier for older archived records. Production Redis remains disabled, and Phase 1.6A is ready for local review.
