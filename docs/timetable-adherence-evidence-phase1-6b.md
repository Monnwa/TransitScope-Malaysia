# Phase 1.6B — Durable PostgreSQL write recovery

## 1. Existing write lifecycle

Phase 1.6A captures an immutable proof in a bounded process-local map during bus journey processing. A Next.js after-response callback drains that map into PostgreSQL. Failed or unacknowledged batches remain in the map and retry after a fixed delay. Process termination loses the map and its retry state.

Each archive batch is one atomic INSERT statement. The record ID primary key and conflict handling prevent duplicate historical rows across workers and restarts. PostgreSQL can commit even when the application loses the acknowledgement. A retry can recognize the existing key while preserving the original record. The process-local in-flight flag coalesces callbacks only within one worker. Other workers can independently submit the same record. Atomic inserts prevent partial rows inside a batch, but the application has no durable inventory of the batches that still need delivery.

The recovery design adds an outbox in the same PostgreSQL database. A write is safely queued only after the outbox insert commits. If PostgreSQL is unreachable before that point, the application cannot guarantee recovery after process loss. This boundary is explicit in the write results.

## 2. Recovery architecture

The outbox keeps the original Phase 1.6A snapshot under the same immutable record ID. This uses the existing datastore and avoids introducing a separate queue service. The runtime has three distinct steps.

1. **Handoff.** Capture still stages validated snapshots in bounded memory. The worker inserts them into the outbox in an atomic, idempotent batch. A database acknowledgement moves them out of staging. A failed or unknown handoff leaves them explicitly unconfirmed.
2. **Claim.** A worker selects up to 64 due rows using `FOR UPDATE SKIP LOCKED`. The claim commits an attempt count, a unique token and the next eligible retry time before any delivery. The database clock drives that deadline during normal operation. Retries wait at least 2, 4, 8, 16, 32 and 60 seconds after successive claims, with six attempts before a row is marked failed. [PostgreSQL row locking](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
3. **Delivery.** The worker locks rows that still belong to its token. For each row it inserts the existing immutable archive record and acknowledges the outbox in one database transaction. A savepoint rolls back both changes for a deterministic per-record failure. Healthy peers can commit. A cancellation or other transaction-level failure leaves the previously committed claim and its retry deadline available for recovery.

A delivery retry never rewrites a historical row. An existing archive key is checked before acknowledging a no-op insert. If an acknowledgement update affects no row, the delivery rolls back its insertion. Stale tokens cannot deliver reclaimed rows.

The after-response callback checks the durable queue even when a restarted runtime has an empty staging buffer. The next enabled fleet or bus detail request can recover due work. One flush at a time per instance uses a 2.5-second client deadline and a 1.5-second timeout per HTTP query. The local polling throttle does not replace durable retry deadlines. The archive does not feed evidence back into live processing.

## 3. Migration and states

Apply `database/classification-evidence.sql` followed by `database/classification-outbox.sql` in an isolated database. The second migration creates a separate outbox table, due and claim indexes, and the delivery function. The historical table and Phase 1.6A record format require no migration. The runtime role needs SELECT and INSERT on the history table, SELECT, INSERT and UPDATE on the outbox, and permission to execute the delivery function.

| State | Meaning |
| --- | --- |
| Staged | The process holds the original candidate, but PostgreSQL has not acknowledged a durable intent. This is a local counter, not a database queue state. |
| `PENDING` | PostgreSQL committed the original intent and no worker has claimed it. |
| `RETRYING` | A committed claim holds an attempt number and next eligible retry time. Delivery may still be in progress or its outcome may be unconfirmed. |
| `PERSISTED` | The first delivery committed both archive presence and outbox acknowledgement. Disposition separates a new insert from an existing immutable row. |
| `RECOVERED` | A later attempt committed the same two guarantees. |
| `FAILED` | Evidence expired, the retry budget ran out, or a deterministic data error rejected delivery. The intent remains available for investigation. |

Successful delivery clears the outbox copy of the payload and retains a small deduplication receipt. Failed rows keep their original snapshot. This does not change the historical record's valid, expired, superseded, unreproducible or invalid states. The new `outboxStatus` read exposes safe state and retry metadata separately. Runtime logs report failure stages and coarse categories or counts. They omit connection details, credentials and proof payloads.

## 4. Failure-injection validation

Tests used disk-backed PGlite and a disposable native PostgreSQL 18.6 instance bound to loopback. The native test used separate Node worker processes and separate database sessions.

| Scenario | Verified outcome |
| --- | --- |
| A. Normal write | The intent reached `PENDING` before any archive row existed. Delivery committed one archive row and one `PERSISTED` receipt. |
| B. PostgreSQL unavailable | A pre-handoff failure left one staged, zero queued and zero inserted. On availability, the same runtime committed the original snapshot. A separate native worker also received a connection refusal while PostgreSQL was stopped with a previously committed intent. |
| C. Process terminates after enqueue | The native test killed the writer process with SIGKILL after PostgreSQL confirmed the handoff. The outbox was `PENDING` and the archive row was absent. |
| D. Restart with pending writes | A fresh processor with no staged records drained a pending intent after reopening local storage. |
| E. PostgreSQL returns after restart | The native database restarted with the original pending row. A newly launched worker archived it, and the recovered snapshot matched the original in full. |
| F. Duplicate writes | Repeated intent IDs reused the durable receipt. Three native duplicate requests inserted zero new intents. A pre-existing Phase 1.6A record was acknowledged as existing and its fields remained intact. |
| G. Concurrent workers | A second native session skipped a row locked by the first claimant. Delivery waited on a lock for its own leased row and inserted once. An older token could not deliver after the lease was reclaimed. Both benchmark runs archived 1,024 distinct records exactly once. |
| H. Timeout during transaction | A native client timed out while the acknowledgement step was blocked. The server cancelled the transaction. The archive row was absent, the claim remained retryable and the next due attempt reached `RECOVERED`. A separate test discarded a successful commit response. It counted no acknowledged insert in the caller and database read-back found one committed row. |
| I. Partial failure and rollback | An acknowledgement trigger suppressed one update after its archive insert. The savepoint rolled back that insert, the intent became `FAILED`, and the healthy peer committed. |
| J. Permanent database delivery error | An injected SQL permission error rolled back each of six delivery attempts. Backoff remained durable and the next due check marked the retained intent `FAILED` with `RETRIES_EXHAUSTED`. No archive row was written. A completely unreachable database cannot accept a terminal state update until it returns. |

The first concurrent benchmark completed 960 of 1,024 records in its initial pass. Delivery had been using `SKIP LOCKED` on rows it already owned, which could defer a leased batch under contention. The corrected worker skips locks when claiming and waits for locks on its own claimed rows during delivery. The lock-contention test and both workload runs passed after that correction.

## 5. Local performance

The native test ran PostgreSQL 18.6 on Windows with `fsync` and `synchronous_commit` enabled. Each run submitted 1,024 synthetic records in batches of 64. Enqueue, claim and delivery latencies are client-observed. The 16-batch samples are useful for comparing these runs and do not establish a fleet SLA.

| Metric | One consuming worker | Four concurrent consuming workers |
| --- | ---: | ---: |
| Enqueue batch P50 / P95 | 5.91 / 8.01 ms | 6.20 / 36.01 ms |
| Claim batch P50 / P95 | 2.64 / 6.20 ms | 3.26 / 8.27 ms |
| Archive delivery batch P50 / P95 | 8.47 / 12.84 ms | 9.19 / 17.54 ms |
| Drain time for all 1,024 records | 188.32 ms | 62.11 ms |
| Drain throughput | 5,438 records/s | 16,486 records/s |
| Open local client sessions | 5 | 5 |

Both runs kept four worker connections and one observer connection open. The serial run used one of the four workers to consume the queue. The native timeout case observed a client timeout at 52.87 ms and confirmed recovery 2,008.53 ms after the first delivery attempt began, including the initial retry wait.

With delivery paused, the durable outbox occupied 598,016 bytes for 256 pending records, 1,073,152 bytes for 512, 1,556,480 bytes for 768 and 2,056,192 bytes for 1,024. These are PostgreSQL relation sizes including indexes in the local fixture.

The pre-handoff outage experiment attempted 2,400 candidates over 24 cycles and 46 seconds of simulated retry time. Zero reached the durable queue. The staging buffer held 1,996 records and 3,999,312 serialized bytes. Its overflow counter recorded 404 rejected-for-capacity candidates. Process RSS went from 147.12 MB to a sampled peak of 159.22 MB. Heap used was 33.76 MB at baseline, 66.59 MB at its sampled peak and 36.94 MB after explicit garbage collection. These measurements include the fixture generator and local test tooling. They do not represent managed database or Vercel memory usage.

The managed HTTP PostgreSQL path was not load-tested. The loopback throughput, connection count and latency should not be extrapolated to it.

[Native validation results](</C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6b/native-results.json>) · [Native validation harness](</C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6b/validate-native.cjs>)

## 6. Regression results and limitations

| Check | Result |
| --- | --- |
| Full unit suite | 345 passed across 28 files, including 14 archive tests |
| Browser regression | 100 Chromium tests passed against the local production build |
| TypeScript and ESLint | Passed |
| Local production build | Passed on Next.js 15.5.28 |
| Historical compatibility | Phase 1.6A snapshots remained readable, and retries preserved their original values |
| Live behaviour | The processor comparison produced identical journeys with the archive enabled and disabled |

The guarantee starts at the PostgreSQL outbox commit. Before that commit, the bounded staging buffer can drop candidates under pressure or lose them when the process exits. Extending the guarantee to a complete PostgreSQL outage before handoff would require another durable ingress mechanism.

Recovery requires the database to be reachable and an enabled request to wake a worker. The implementation has no independent scheduler. Retain terminal deduplication receipts through the evidence cutoff and arrange bounded operator cleanup of expired outbox rows and failed payloads before activation. Alerting, failed-intent replay procedures, managed connection behaviour and queue growth under a sustained live workload remain to be validated.

## 7. Production readiness

**Keep production PostgreSQL archival disabled.** The Vercel Production environment is gated off in code. Local validation demonstrates durable handoff, recovery across process and database restarts, and deduplication under contention. Production activation requires a separate isolated managed PostgreSQL soak with retry and queue monitoring, a retention cleanup schedule, and review of the existing Preview memory and classification consistency findings.

Phase 1.6B is complete for local review. The changes are in the working tree and no deployment was performed.
