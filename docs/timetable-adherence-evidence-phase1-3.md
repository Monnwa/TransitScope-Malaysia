# Phase 1.3 — Partial-success handling and fleet resilience

Date: **8 November 2026, Asia/Kuala_Lumpur**. Reference: [Phase 1.2 investigation](timetable-adherence-evidence-phase1-2.md).

**Implemented and validated locally. Production Redis persistence remains disabled. No commit, push or deployment was performed.**

## 1. Root cause and minimal changes

Phase 1.2 identified a combination of multi-wave I/O under a shared 2.5-second deadline and whole-aggregate failure handling. One failed request discarded other returned histories or acknowledged writes, so caches stayed empty and subsequent processing repeated reads or encountered unacknowledged-write conflicts.

The fix preserves independent outcomes rather than requiring a completely successful aggregate:

- `EvidenceBackend.read` and `compareAndSet` accept optional per-key result callbacks. Each completed request delivers its known results immediately. `BusEvidencePersistence` validates and caches each history during that callback, while other requests may still be pending. Successful write acknowledgments similarly update the cache immediately.
- Each key/index is handled once. Invalid documents do not contaminate valid peers. Missing data, invalid data/command responses, timeout, connection failure and unavailable service responses are distinct outcomes. Failed writes are not mistaken for CAS conflicts.
- Pool workers contain request errors and await all started siblings. Queued requests are not dispatched after operation cancellation. A failure does not reject other workers or leave their started requests running beyond the backend method's completion, for the supported abort-aware fetch transport.
- Confirmed write conflicts retain the original single bounded reread/merge retry. Only successfully refreshed keys are retried. An unknown/failed reread does not erase an existing valid cache entry; only a confirmed missing key resets the remote revision baseline. Older acknowledgments/readbacks cannot overwrite a newer cached checkpoint.
- Batches now hold **up to 40 keys/commands**, with a **256,000-byte target**. A larger individual write is isolated in its own batch and rejected above the **4,000,000-byte request bound**. The existing response-size guard remains. This lets the captured fleet's maximum 113-key read fit one three-request wave instead of four waves.

**The 1,800ms HTTP timeout, 2,500ms operation deadline and three-request operation concurrency limit are unchanged.** There is no generic HTTP retry or deadline extension. Batch sizing is part of this fix: the results below are not presented as proof that partial callbacks alone would recover every key with the former ten-item batches.

Existing complete-result callers remain compatible. A caller without callbacks still receives an error if transport results are incomplete; it cannot accidentally interpret a timeout as a missing key. The application persistence pipeline always supplies callbacks, preserving valid partial outcomes while recording failures.

No matching/progress/railway calculation was changed. `scopeFor`, `validPassage`, `readEvidence`, `capture` and `mergeEvidence` retain their original admission, ordering, timestamp, deduplication and retention logic. Historical raw GPS is still not replayed as current movement. The ±120-second adherence boundary, exact-schedule requirement, GPS freshness/quality requirements and LIVE / ESTIMATED / SCHEDULED distinctions remain unchanged.

## 2. Before/after replay results

The pre-change local library was copied before implementation and loaded independently for the baseline. Both versions use the same frozen official GTFS archives, seven original GPS rounds, original clocks, operator/vehicle order and restart before round 3. There are **2,391 input vehicle rows**, **365 source-scoped vehicle identities** and **3,157 final eligible passed stops**. Simulated storage survives separate OS processes for rounds 0–2 and 3–6.

| Condition | Before | New implementation |
| --- | ---: | ---: |
| Offline persistence reference | 130 / 3,157 | 130 / 3,157 |
| 300ms per-request response delay | 130 / 3,157 | 130 / 3,157 |
| **1,500ms per-request response delay** | **49 / 3,157** | **130 / 3,157** |
| New real managed Redis replay | Not a paired live baseline | **130 / 3,157** |

The requested 1.5-second acceptance target is met exactly. All new variants match the frozen pre-change offline reference in **2,391 / 2,391 vehicle-progress comparisons** and **2,391 / 2,391 classification-result fingerprint comparisons** across all rounds. This checks complete classification results, not just totals. Eligible stop keys are identical, there are no unexpected classifications and no duplicate eligible/classified stop keys.

| Replay round | Original offline reference | Old 1,500ms implementation | New 1,500ms implementation |
| --- | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 |
| 2 | 40 | 40 | 40 |
| 3, first observation after restart | 0 | 0 | 0 |
| 4 | 61 | 0 | 61 |
| 5 | 80 | 16 | 80 |
| 6 | 130 | 49 | 130 |

After restart, a first fresh observation still cannot manufacture passed-stop progress. Original stored passage pairs support classifications only after fresh local GPS independently re-establishes eligible current progress.

The new slow-control run confirms **1,274 document writes** (590 before restart, 684 afterward), loads **230 histories** after restart, and has zero request timeouts or failed storage operations. Its latest hydration view again contains 1,081 archived observations and 187 passage pairs, compared with zero cached historical observations/pairs in the old slow condition; current local fix counts remain 876 in both views.

Aggregate evidence: [`phase13-results.json`](timetable-adherence-evidence-phase1-3/phase13-results.json). The denominator counts final exact-schedule eligible stop occurrences once, not repeated snapshot appearances. This is classification/evidence equivalence, not ground-truth arrival/departure or ETA accuracy.

## 3. Partial-success and failure-isolation tests

| Test | Result |
| --- | --- |
| One vehicle/request times out, forty peer histories succeed | Forty FOUND callbacks delivered before the timed-out request settles; successful histories remain available |
| Multiple simultaneous timeouts | Forty successes preserved, 121 timeout outcomes reported, no more than three active requests, no request left active after completion |
| Mixed valid, missing and invalid values in one MGET | Each key receives its own outcome; valid entries survive bad peers |
| Truncated MGET result array | Known correctly positioned entries preserved; absent entries marked invalid rather than missing |
| Connection interruption and recovery | TypeError transport failure isolated; backend works on the next healthy call; provider details remain redacted |
| Partial pipeline command error | SAVED peers preserved; CONFLICT distinguished from INVALID/failed outcome |
| One pipeline request times out | Forty acknowledged writes preserved instead of being discarded |
| Payload bounds / oversized vehicle document | Byte-bounded batches; oversized single-key write rejected without preventing the normal peer write |
| Cache during incomplete fleet retrieval | Public loaded counter reaches forty while failed peer request is still pending |
| Processing restart and later recovery | Forty vehicles recover 120 expected classifications while one remains unavailable; after recovery all 41 vehicles have their 123 expected classifications |
| Conflict reread fails | Prior valid cache survives and can serve a newly reset local history without another remote read |
| Repeated conflicts / unknown write outcome | At most two CAS attempts; failed/timeout writes never become conflicts or generate a retry storm |
| Corrupt stored GPS peer | Valid vehicle retains three classifications; corrupt vehicle remains unavailable |
| Browser passenger regression | A corrupt persisted vehicle does not remove another vehicle's background-computed classifications, trigger detail-dependent processing or expose diagnostic terms in ordinary text |

The existing suite additionally verifies invalid coordinates/timestamps, stale/future GPS, rejected jumps, expiry, deduplication, out-of-order observations, cross-midnight services, non-exact schedule withholding and post-storage-I/O freshness checks. Those checks continue to pass. Controlled connection interruption occurs in the fetch layer; no managed-service outage was induced.

## 4. Client-observed latency and instrumentation

Runtime technical status now exposes bounded, credential-free instrumentation:

- Per-request latency count/total/last/max, timeout/connection failure counts and the latest 32 request summaries.
- Separate backend read-batch and write-batch durations.
- Valid/missing/invalid/timed-out/connection-failed/unavailable hydration counts.
- Cache-validation/population duration, retrieval duration and overall completed fleet-processing duration.
- Actual second-CAS attempt count and recovery-read/retry durations.

`metrics.histories` describes hydration outcomes; conflict rereads additionally contribute to cache-population/retry durations. `loaded` is not inflated by those conflict rereads. HTTP-success timing is not a claim that every decoded vehicle document is valid. Per-key validation outcomes are recorded separately.

Generic fetch does not expose connection establishment, so runtime telemetry explicitly labels it `NOT_OBSERVED_BY_FETCH`; it does not report a fictional zero. The diagnostic runner separately uses Node/Undici events to measure combined DNS/TCP/TLS establishment and socket reuse. Actual Redis execution time is explicitly `NOT_MEASURED`. Headers/response timings include the network and gateway and are not server CPU measurements.

### Request counts and whole-fleet time

All figures cover the same 21 sequential operator snapshots. Static archive loading, cleanup and independent memory/clock probes are excluded. Early before/after control runs shared the local machine; final 1,500ms and real runs were repeated against the final code. These are local measurements, not production SLAs or billing estimates.

| Measure | Old 300ms | New 300ms | Old 1,500ms | New 1,500ms | New real Redis |
| --- | ---: | ---: | ---: | ---: | ---: |
| HTTP invocations | 216 | 70 | 230 | 70 | 72 |
| MGET requests | 79 | 31 | 118 | 31 | 32 |
| EVAL-pipeline requests | 137 | 39 | 112 | 39 | 40 |
| Recorded request timeouts | 0 | 0 | 104 | 0 | 1 |
| Failed storage operations | 0 | 0 | 42 | 0 | 1 |
| Total processing wall time | 33.93s | 18.30s | 111.48s | 68.32s | 27.12s |
| Per-cycle wall P50 / P95 | 1,487 / 3,309ms | 851 / 1,325ms | 5,224 / 5,695ms | 3,265 / 3,734ms | 852 / 2,947ms |

At the same 1,500ms response condition, request invocations fall **69.6%** and sequential processing wall time falls **38.7%**, while classifications recover from 49 to 130. The per-request network delay was not reduced: avoiding extra waves and aggregate loss supplies the improvement.

| Observed request span | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| Old 1,500ms control | 1,502ms | 1,515ms | 1,519ms |
| New 1,500ms control | 1,508ms | 1,517ms | 1,521ms |
| New real Redis | 269ms | 1,247ms | 1,811ms |

Request spans include body completion or body-error time. Failed spans are censored at cancellation, not hypothetical successful completion latency. Quantiles use nearest rank; populations and successful-only distributions are provided in the JSON. The former diagnostic calculation's header-return time is not used as the end of a response-body timeout.

### Retrieval, population, connection and retry measurements

For the new 1,500ms run, aggregate hydration duration is P50 **1,514ms**, P95 **1,526ms**, P99 **1,528ms**, versus approximately 2,509 / 2,515 / 2,515ms before. Persistence duration is P50 **1,515ms**, P95 **1,525ms**, P99 **1,527ms**. The unchanged 2.5-second deadline now covers the captured workload's one concurrent wave.

After the controlled restart, 230 successful histories are independently validated/cached; cache population totals **13.66ms**, maximum **1.91ms per history**. Missing keys are counted separately. Successful results discarded due to another aggregate failure drop from **465 returned documents / 123 acknowledged key writes** in the old slow control to **zero** in the new slow control. It needs no conflict reread or second CAS attempt.

The real run has **nine connection attempts**, with combined establishment P50 **484ms** and P95/P99 **965ms**. **63 / 72 requests reused a socket**; no TLS resumption was observed. These are diagnostic client observations, not Redis command execution time.

One real MGET timed out during response-body retrieval at the unchanged HTTP deadline, affecting forty history outcomes. Other successful histories and acknowledgments were preserved. A subsequent 29-key conflict recovery reread completes in approximately **499ms**, followed by a second CAS attempt of approximately **261ms**. This is one bounded retry, approximately **760ms** of combined recovery work; all 130 classifications and their fingerprints match the reference. Final healthy status reflects subsequent recovery, not an assertion that every earlier operation succeeded.

## 5. Real Redis evidence and integrity

Only the existing isolated temporary managed Redis instance was used; no production environment was connected or changed. The same separate-process restart was exercised. As in previous phases, the archived replay translates only the Redis absolute-expiry clock domain while keeping original evidence timestamps and application clocks intact.

Before restart, direct reads find **235 documents, 590 observations and 107 passage pairs**. After replay, they find **251 documents, 1,268 observations and 260 passage pairs**. Raw archived observations can be fewer than the healthy control after a transport failure, but every retained observation is original accepted evidence; historical passage restoration remains exact. Both snapshots have **zero ordering errors and zero mismatches against original GPS coordinates, measurement times, publication times and receipt-time variants**.

The raw-GPS archive is not used to reconstruct new motion or infer crossings across rejected intervals. Only original validated pairs on the same source/vehicle/run/shape/static version are restored. Failed retrievals cannot replace a valid cache with an empty error result, and invalid documents remain excluded.

Owned test keys were deleted after validation; **DBSIZE = 0**. Credentials remain only in Git-ignored validation environment files and are absent from code/report/results.

## 6. Full regressions and modified files

| Check | Result |
| --- | --- |
| Full unit suite | **331 passed**, 27 files; 14 new tests |
| Full browser suite against production build | **100 passed**, no skipped/unexpected/flaky cases; 40.3s |
| TypeScript | Passed |
| ESLint | Passed |
| Production build | Passed, Next.js 15.5.28 |
| 1,500ms replay acceptance | 130 / 3,157; all 2,391 progress/classification fingerprints identical to frozen offline reference |
| Other algorithm/railway modules | Unchanged against the frozen pre-change library |

Modified runtime files:

| File | Change |
| --- | --- |
| `lib/redis-evidence-store.ts` | Independent key outcomes, settled/cancellable bounded pool, count/byte-bounded batches and request metrics |
| `lib/bus-evidence.ts` | Streaming cache adoption/acknowledgments, safe conflict refresh, failure categories and persistence metrics |
| `lib/processed-bus-journeys.ts` | Completed fleet-processing duration recording only; synchronous matching/progress method unchanged |

Tests: `tests/redis-partial-success.test.ts` (new), `tests/bus-evidence.test.ts`, `tests/redis-evidence-store.test.ts`, and `e2e/evidence-reliability.spec.ts`. No dependency, package lock, deployment configuration or UI component changed. Previous audit/Phase 1–1.2 files and unrelated local changes are preserved.

Reproducibility artifacts, the frozen pre-change library, per-request traces and comparison programs are under:

`C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-3-2026-11-08/`

## 7. Limitations and deployment recommendation

- **Do not enable production persistence yet.** This is a local implementation/review deliverable. The existing temporary database is not a long-lived production resource, and no Vercel environment was configured.
- The 40-item limit is an upper bound, not a guarantee of one wave for larger fleets or byte-heavy histories. The byte target may split a batch sooner. Genuine timeouts still make affected keys unavailable; the fix preserves successful peers rather than guaranteeing evidence through a total outage.
- The endpoint still awaits bounded historical I/O; it is not an HTTP-streaming interface or a durable background queue. Successful cache updates occur immediately, but a response may wait for remaining requests to finish/cancel. Per-operation concurrency is three; a process-wide limiter across concurrent feeds was not introduced.
- Unknown write outcomes may already have executed remotely. Existing revision CAS, scope validation and monotonic checkpoints remain essential. Conflict recovery is still limited by the original shared deadline and can defer unsuccessful keys to a later processing cycle.
- Larger 40-key responses need continued payload/memory monitoring during a full 60-minute soak. Full-document snapshot writes remain; no incremental storage format, negative cache or new external API was introduced.
- Local sequential replay is not a three-feed concurrent Vercel-region load test. Real provider latency, replica behaviour and actual server execution time remain outside the controlled-delay proof. No arrival-ground-truth accuracy claim is made.

Before later activation, review this diff, use separate long-lived databases/credentials for production and preview, and validate sustained retention, payload limits, cold starts, concurrent feeds and handler completion in the actual Vercel region. Retain the same evidence/classification tests. No deployment step is authorized by completion of this report: stop for review.
