# Phase 1.6D — End-to-end evidence reliability and upstream durability

## Phase 1.6C findings and root causes

The Phase 1.6C managed PostgreSQL trials confirmed that the outbox preserves committed evidence. They also found two distinct gaps. A burst of 2,400 candidates filled the 4,000,000-byte staging allowance after 1,984 records. The remaining 416 exceeded the byte limit before reaching the separate 2,000-record ceiling. In the process-termination test, 64 candidates existed only in the worker's heap because outbox submission was deferred. Process death erased them. In a concurrent deadline trial, the client acknowledged zero writes while PostgreSQL held 256 committed intents. A missing acknowledgement left the transaction outcome uncertain. [Phase 1.6C validation](timetable-adherence-evidence-phase1-6c.md)

The previous feed path generated candidates and staged them in memory. The route scheduled one worker after the response, with admission and archive delivery sharing a 2.5-second budget. Its in-memory counters recorded aggregate drops. It had no explicit admission outcome, reasoned capacity diagnostic, pending-age metric or receipt lookup for an unconfirmed enqueue.

## Architecture decision

| Option | Decision |
| --- | --- |
| Deferred volatile staging | Retain the bounded buffer for retries. The normal feed path now starts admission before handing back the processed journeys. |
| Direct admission to the existing PostgreSQL outbox | Selected. It brings forward the durable handoff, keeps one durable queue, reuses the existing record ID and allows database failures to remain isolated from passenger results. |
| Block the feed until every candidate commits | A database outage would block otherwise valid realtime results. A bounded admission attempt and explicit internal failure are appropriate for this phase. |
| Local disk spool or another durable queue | Local storage cannot support a serverless instance replacement. A second service would introduce another failure domain to provision and operate. Durable input capture or replay needs a separate design if the product requires recovery before PostgreSQL commit. |

Candidate generation uses the existing GPS and GTFS data in the application process. A PostgreSQL transaction can atomically commit the generated batch. Making the generation itself recoverable would require the original evidence inputs to be durable and replayable, or a new upstream handoff. Moving the write earlier narrows the volatile window. It leaves a window between candidate generation and commit, including during outages.

The healthy bus feed path now invokes admission after computing directly classified evidence and waits for the bounded attempt before returning journeys. Archive delivery still runs after the response. When the Redis evidence adapter is configured, its persistence can proceed while archive admission runs. Admission and delivery have independent single-flight workers and retry throttles. Concurrent source calls share the admission writer. A failed enqueue leaves its original record ID and evidence in the bounded buffer. A request-triggered recovery can still drain older durable intents independently of a failed new admission.

The queue has the same 2,000-record and 4,000,000-byte limits, plus the existing 256,000-byte serialized batch limit. The worker reports invalid evidence, capacity rejection and oversized evidence separately in aggregated internal warnings. It reports expiry before confirmation separately, including whether a previous commit was uncertain. Internal status includes staged records and bytes, age of the oldest pending candidate, maximum observed staging residence, pending unknown outcomes, rejection counts and reconciliation counts. These are process-local diagnostics. The API returns the same passenger data.

## Commit outcomes and reconciliation

| Outcome | Evidence and action |
| --- | --- |
| `COMMITTED` | PostgreSQL acknowledged the insert or the existing stable ID, or a receipt lookup confirmed that the ID is present. The worker can release the original candidate from the retry buffer. |
| `NOT_COMMITTED` | The batch was rejected before SQL dispatch, or PostgreSQL explicitly cancelled the autocommit statement with SQLSTATE `57014`. This describes that attempt. An earlier uncertain attempt for the same ID can still have committed. |
| `COMMIT_OUTCOME_UNKNOWN` | A timeout, connection failure, lost response or invalid acknowledgement supplied no reliable result. The worker retains the original candidate and looks up its stable ID in the outbox while the budget allows. An absent or unavailable receipt leaves the outcome unknown. A later retry uses the same ID and cannot overwrite the committed payload. |

The reconciliation lookup is batched. Positive matches are retained independently even if peers remain uncertain. The insert still uses the existing primary key and `ON CONFLICT DO NOTHING`. Duplicate enqueue leaves receipt state, attempts and settlement timestamp intact. Archive delivery continues to insert the evidence and acknowledge delivery in one transaction under the existing claim token. Neon-wrapped transport timeouts are reported as timeouts while their commit outcome remains unknown. [PostgreSQL INSERT](https://www.postgresql.org/docs/current/sql-insert.html) · [PostgreSQL error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)

## Failure injection and backpressure

Validation used synthetic GPS fixtures and a disposable loopback PostgreSQL 18.6 cluster with `fsync` and `synchronous_commit` enabled. Tests used the existing SQL migrations. Process termination used separate Node processes, with each killed only after reaching its intended transaction boundary.

| Scenario | Result |
| --- | --- |
| Termination before commit | The writer inserted one candidate inside an open transaction and was killed before commit. The observer found no outbox or archive row. The fresh worker could not recover the candidate. |
| Termination immediately after commit | The writer committed, then was killed before its admission call received the result. PostgreSQL retained one pending intent. After a real local database stop and start, a fresh worker archived the original snapshot with every field preserved. |
| Outage during admission and application restart | PostgreSQL refused connections while stopped. A fresh worker after restart recovered the committed pending intent. The uncommitted candidate from the killed worker stayed absent. |
| Commit with lost acknowledgement and receipt lookup available | PostgreSQL committed and the harness suppressed the acknowledgement. A positive receipt reconciled the outcome as `COMMITTED` in 1.48 ms without a second insert. |
| Commit with lost acknowledgement and lookup unavailable | The first attempt returned `COMMIT_OUTCOME_UNKNOWN` in 2.35 ms. The SQL observer found the intent `PENDING`. On the next eligible retry the same ID returned `COMMITTED` and `alreadyQueued`. The retry took 0.46 ms after advancing the harness clock past the 2-second throttle. Four additional concurrent retries left the original snapshot and settled receipt unchanged, with one lifecycle attempt. |
| Known cancellation | A 30 ms PostgreSQL statement timeout cancelled an intentionally blocked enqueue. The worker reported `NOT_COMMITTED` and SQL confirmed the row was absent. |
| Staging capacity and sustained outage | A 12.01-second actual database outage received 2,400 candidates in 12 batches. The worker held 1,984 candidates and 3,999,036 serialized bytes. It rejected 416 at the byte limit and emitted 15 aggregated warnings, including the 12 unconfirmed admissions. The harness advanced the admission clock by 2 seconds per batch to exercise the retry throttle within the outage window. |
| Recovery with backlog and concurrent workers | After access returned, admitting the retained 1,984 took 174.32 ms. Four workers drained the backlog in 149.32 ms. All 1,984 archived snapshots matched the original fixtures. The largest native test also drained 10,000 distinct records with one receipt per input ID. |

During the outage, the longest observed staging residence was **12.82 seconds**. Node RSS went from **117.52 to 120.78 MiB** and used heap from **29.32 to 38.79 MiB** at sampled peaks. The 416 rejected candidates were explicitly reported and were never accepted by the buffer. The 1,984 retained candidates stayed recoverable while the original process remained alive. A fresh worker can recover committed intents using PostgreSQL alone.

## Performance and Phase 1.6C comparison

The production-gated adapter keeps its 1.5-second per-query deadline. The admission and delivery workers each use a separate 2.5-second per-invocation budget, with a 2-second failure throttle. A failed immediate reconciliation may therefore wait for a later request. The native harness limited individual data queries to 1.5 seconds and used 30-second loop guards per workload stage. The benchmark used one producer, up to four delivery sessions and 64-record batches. Each batch used a separate explicit transaction to measure the `COMMIT` round trip apart from candidate generation and total admission. The normal adapter uses an autocommit SQL statement. Native commit measurements include loopback transport. They do not isolate PostgreSQL server execution.

Timings below are P50 / P95 / P99 in milliseconds. Snapshot generation covers the normal capture and staging step per candidate. Fixture journey generation was timed separately and had P50 of 0.073–0.093 ms. Admission, commit and archive delivery timings are per batch.

| Records / delivery workers | Snapshot generation | Admission | PostgreSQL commit round trip | Archive delivery |
| ---: | ---: | ---: | ---: | ---: |
| 1,024 / 1 | 0.028 / 0.050 / 0.067 | 6.516 / 11.163 / 11.163 | 0.668 / 0.862 / 0.862 | 8.161 / 10.998 / 10.998 |
| 1,024 / 4 | 0.031 / 0.046 / 0.065 | 6.651 / 9.781 / 9.781 | 0.653 / 0.792 / 0.792 | 9.077 / 17.146 / 17.146 |
| 5,000 / 4 | 0.028 / 0.041 / 0.055 | 6.391 / 8.189 / 10.717 | 0.656 / 0.755 / 1.359 | 9.265 / 23.590 / 34.807 |
| 10,000 / 4 | 0.027 / 0.037 / 0.053 | 6.255 / 8.179 / 26.831 | 0.638 / 0.827 / 1.495 | 9.024 / 12.204 / 30.348 |

| Records / delivery workers | Backlog drain | Records per second | Node RSS initial → peak MiB | Node heap initial → peak MiB |
| ---: | ---: | ---: | ---: | ---: |
| 1,024 / 1 | 178.71 ms | 5,730 | 122.04 → 122.47 | 34.71 → 51.07 |
| 1,024 / 4 | 97.51 ms | 10,502 | 121.86 → 148.74 | 34.78 → 60.14 |
| 5,000 / 4 | 331.40 ms | 15,087 | 148.88 → 211.45 | 34.72 → 80.45 |
| 10,000 / 4 | 543.13 ms | 18,412 | 209.48 → 221.95 | 32.83 → 87.19 |

All four runs verified the expected archive and terminal receipt counts. Memory was sampled in the shared Node harness across consecutive runs. It includes the fixture loader, producer, delivery sessions and client buffers. PostgreSQL server memory and Vercel process memory were outside this measurement.

Phase 1.6C ran from Malaysia against a managed database in US East. It took 8.85 seconds to drain 1,024 records with one worker at the 1.5-second deadline, and 3.20, 11.65 and 13.09 seconds for the longer-deadline concurrent controls at 1,024, 5,000 and 10,000 records. All three concurrent 1.5-second managed runs hit enqueue timeouts. The local runs in this phase validate the revised execution path and isolate commit time on loopback. They cannot quantify a managed speedup or establish that the 1.5-second production-gated setting is adequate across regions. The comparable staging result is the byte ceiling under the same synthetic 2,400-record input. Both phases admitted 1,984 and rejected 416. Phase 1.6D adds explicit rejection telemetry and advances the normal commit attempt. [Phase 1.6C validation](timetable-adherence-evidence-phase1-6c.md)

## Regression and production readiness

| Check | Result |
| --- | --- |
| Full Vitest suite | 349 passed across 28 files, including 18 archive and outbox tests. |
| TypeScript | Passed with `tsc --noEmit --incremental false`. |
| ESLint | Passed. |
| Next.js production build | Passed on Next.js 15.5.28. |
| Playwright Chromium | 100 passed against the local production build. |

The evidence schema, historical records, GTFS matching, ±120-second tolerance, railway logic and passenger classification semantics were preserved. Changes are limited to admission, recovery diagnostics, feed integration and tests.

**Keep production archival disabled.** Local validation proves recovery after the database commit and reports capacity, expiry and unconfirmed admission while the process is alive. A hard termination before commit can still erase candidates and their in-memory diagnostics. If that gap is unacceptable, require a durable upstream journal or replayable original inputs before activation. The current implementation also requires a future request to resume background delivery. A managed test in the target region should measure the effect of early admission on feed latency, pending-age growth and acknowledgement recovery under the actual request cadence. The local tests do not validate provider failover or resolve the earlier Preview OOM.

[Native PostgreSQL results](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6d/native-results.json>) · [Native validation harness](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6d/validate-native.cjs>)
