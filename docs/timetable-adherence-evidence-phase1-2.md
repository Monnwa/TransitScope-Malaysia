# Phase 1.2 — Redis fleet-processing performance investigation

Date: **8 November 2026, Asia/Kuala_Lumpur**. Application baseline: the unchanged local Phase 1 draft on HEAD `235f7cb67d631a17df86bfc23f70de93dc0fff5d`.

## 1. Conclusion and root cause

**The application failure chain is identified and experimentally reproduced. Production persistence must remain disabled. No optimization has been implemented.**

The failure is not explained simply by “Redis is slow” or by a different classifier. A fixed **2.5-second deadline covers an entire multi-wave read/write operation**, while the adapter handles ten keys/commands per HTTP request and at most three requests per operation. Some batches start late enough that an individually valid request cannot finish before the shared deadline. **One failed batch then rejects the whole aggregate**, discarding other successfully returned documents or write acknowledgments. The cache therefore remains empty/incomplete; subsequent cycles repeat reads and can send revision-zero writes against documents Redis already holds. Conflict recovery shares the write operation's remaining deadline, which can be too short for even its first reread, before the advertised merge retry is reached.

This harms durability before restart and evidence hydration after restart. It does not change current GPS progression. The classifier correctly withholds results when the original valid passage pairs are absent.

The causal control is decisive: using the unchanged adapter, batching, deadlines, dataset and classifier, **300ms response delay yields 130 / 3,157**, whereas **1,500ms response delay yields 49 / 3,157**. Every individual simulated response is below the 1,800ms HTTP limit; all 104 aborted requests in the slow control are cancelled by the **operation** deadline. Its 206 snapshot classification differences and final 81 missing classifications reproduce the Phase 1.1 result exactly.

This proves the application mechanism, not the exact source of a historical network delay. Redis-server CPU latency, front-end queuing, routing, DNS/TLS and the network were not separately observable in Phase 1.1. The provider does not expose the required server-side latency tools on this temporary instance. That infrastructure attribution remains uncertain.

## 2. Method and scope

Five instrumented conditions reuse exactly the seven frozen official GPS rounds and static archives from Phase 1: **2,391 vehicle rows, 365 source-scoped vehicle identities**, Rapid KL Bus / MRT Feeder / Rapid Penang. Vehicle order, operator order, capture clocks, original coordinates, schedules and original measurement/publication/receipt fields are retained. Operators run sequentially, matching Phase 1.1. Each restart condition uses separate OS processes for rounds 0–2 and 3–6. The offline reference resets its processor at the same boundary while retaining its test store.

| Condition | Storage / transport | Final classification |
| --- | --- | ---: |
| Offline | Existing test backend, no HTTP delay | 130 / 3,157 |
| Controlled 300ms | Existing Redis adapter and test command backend; fixed response delay | 130 / 3,157 |
| Controlled 1,500ms | Same, only response delay differs | **49 / 3,157** |
| Actual Redis, native Response | Existing real adapter; response observed without replacing it | 130 / 3,157 |
| Actual Redis, Phase 1.1 Response wrapper | Same consume/rewrap behaviour as the previous validation harness | 130 / 3,157 |

The delay models are **causal experiments, not real Redis measurements**. They preserve command result/revision/expiry semantics in the existing test backend; they are not claimed to reproduce server internals. Test-model state is serialized solely to carry it between diagnostic OS processes. No application local-file persistence is introduced.

Real experiments use only the previously created, isolated temporary Upstash database. Benchmark evidence is written there and removed afterward. Production credentials/configuration are untouched. The archived replay translates only Redis's absolute expiry clock domain, exactly as documented in Phase 1.1; original JSON timestamps and application freshness/reference clocks are unchanged.

Instrumentation wraps existing methods inside a diagnostic process and subscribes to Node/Undici lifecycle events. No `lib/`, `app/`, existing test, adapter or deployment file was edited. Method return values, admission rules and retry policies are preserved. Recorded spans cover preparation, hydration, GPS/classification, persistence, each backend operation, request dispatch/headers/body, socket identity/reuse, JSON work and process CPU. [Undici documents the observational lifecycle channels](https://undici.nodejs.org/api/DiagnosticsChannel).

Aggregate evidence: [`report-evidence.json`](timetable-adherence-evidence-phase1-2/report-evidence.json). Full request traces, scripts, model checkpoints and comparison fingerprints are stored outside the repository under:

`C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-2-2026-11-08/`

The diagnostic entry point is `investigate.cjs`; `analyze.cjs` checks eligible keys, GPS results and complete classification-result fingerprints. Runtime hashes are compared with the Phase 1 manifest. Live network conditions could not be frozen across real trials; the fixed-delay controls isolate deadline behaviour from that variability.

## 3. Request and latency statistics

These counts exclude static archive loading, memory probes, cleanup and the independent clock audit.

| Measure | 300ms control | 1,500ms control | Actual Redis native | Actual Redis Phase 1.1 wrapper |
| --- | ---: | ---: | ---: | ---: |
| Fetch invocations | 216 | 230 | 225 | 228 |
| MGET HTTP invocations | 79 | 118 | 87 | 90 |
| EVAL-pipeline HTTP invocations | 137 | 112 | 138 | 138 |
| EVAL commands attempted | 1,274 | 1,087 | 1,286 | 1,286 |
| Key participations in MGET | 700 | 1,141 | 773 | 806 |
| Standalone GET / SET requests | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Operation-deadline request aborts | 0 | 104 | 5 | 4 |
| HTTP-deadline request aborts | 0 | 0 | 0 | 1 |
| Failed backend operations | 0 | 42 | 3 | 4 |
| Observed maximum concurrent request spans | 3 | 3 | 3 | 5 |

GET, SET and PEXPIREAT occur **inside the Lua CAS script**; zero standalone GET/SET HTTP calls does not mean Redis executes none. Command-attempt counts are not billing counts or confirmed server execution counts. A timed-out call may have executed remotely.

The native run dispatched all 225 requests. The wrapper run dispatched 226 of 228 invocations; two expired while waiting for a socket. Unlike the Phase 1.1 aggregate counters, this investigation distinguishes invoked, sent, header-received and body-completed stages. Models have no physical sockets.

| Actual request span | Count | P50 | P95 | P99 |
| --- | ---: | ---: | ---: | ---: |
| Native, all operations | 225 | 355ms | 1,207ms | 1,590ms |
| Native MGET | 87 | 310ms | 1,259ms | 1,590ms |
| Native EVAL pipeline | 138 | 386ms | 895ms | 1,603ms |
| Phase 1.1 wrapper, all operations | 228 | 339ms | 1,323ms | 1,722ms |

Quantiles use nearest rank. All-operation spans include observed time until cancellation for failures; these are censored spans, not the completion latency those requests would have had. Successful-only distributions are also included in the JSON. Samples are small, local and temporal, not production latency percentiles or confidence bounds.

### Request density and triggers

Native-run density is **0.0941 HTTP invocations per input vehicle row**, **0.6164 per distinct source/vehicle**, and **0.0713 per final eligible stop**. Across the seven rounds there are 13,706 eligible-stop snapshot appearances, giving 0.01642 invocations per appearance. These are alternative denominators, not independent work counts; repeated stop appearances must not be presented as distinct stops.

**No stop-level calculation triggers a Redis request.** Storage operates on source/vehicle/run scopes. Stop count affects document size and CPU work, not one-request-per-stop behaviour. There are no duplicate keys within an observed MGET request. Different vehicles require different histories; there is no evidence that unrelated vehicles are unnecessarily requesting the same shared history.

### Connection establishment and reuse

Native traces show **14 connection attempts**, six socket IDs in the first process and eight in the second. **211 / 225 requests (93.8%) reused a socket**. Combined connection-establishment time—DNS/TCP/TLS, not separately separable here—has P50 940ms, P95/P99 1,100ms. No TLS session resumption was observed. The previous harness wrapper also reused sockets: 209 requests, with 19 observed attempts.

For the native run, time from send to response headers has P50 336ms, P95 685ms, P99 894ms. Dispatch wait has P50 0.49ms but P95 894ms and P99 979ms, showing the cold-connection tail. Headers-to-body completion has P50 0.24ms, P95 6.89ms and P99 306ms. These measurements separate client connection/wait/body stages; **send-to-headers includes network, HTTP gateway/queue and server work and must not be called Redis-server latency**.

Readonly provider probes found SLOWLOG GET and LATENCY LATEST unavailable (HTTP 400); INFO commandstats supplied no usable per-command CPU data. No Server-Timing or equivalent latency header was exposed. INFO's `total_connections_received = 0` is not a usable count of the REST client's TLS connections. True server execution percentiles remain **unmeasured**.

## 4. Exact failure stages and retry behaviour

An actual cold-restart example is Rapid KL, round 3:

1. Hydration requests **43 keys in five MGET batches**, using three workers.
2. The first three requests begin immediately and take approximately 1,572–1,590ms. Two more start at approximately 1,581–1,583ms into the shared operation.
3. Four batches return successfully, carrying **29 documents**. One second-wave request is cancelled at the operation deadline after only **925ms of its own lifetime**—well below its 1,800ms HTTP allowance.
4. Backend.read rejects at approximately **2,506ms**. None of those 29 successful documents is admitted through that aggregate read.
5. The same cycle's first write call receives **36 revision conflicts**, consistent with existing remote keys and an unhydrated local cache. It consumes approximately 2,144ms.
6. Recovery rereads 36 keys in four batches. Three return **30 documents**; the fourth is cancelled after approximately **56ms**. Recovery shares the original persistence deadline and only approximately 360ms remained. The second CAS attempt is never reached.

Another native failure is round 6 Penang persistence: **93 writes in ten pipeline batches**. Seven batches acknowledge **70 successful key updates**, but another batch times out against the shared write deadline. The aggregate rejects, so those 70 acknowledgments do not advance the client's saved/cache counters.

Overall, the native run discards **59 returned documents** from rejected aggregates and **70 acknowledged successful key updates** from rejected write aggregates. Its 1,227 successful per-key responses correspond to 1,157 client-confirmed saves after excluding those 70. This is a loss of usable acknowledgments, not proof those remote writes were rolled back.

All five native failed requests were waiting for headers and were cancelled by the operation deadline. The wrapper run adds one HTTP-deadline failure, including a response-body failure and two requests never sent. Both paths exhibit the same aggregate-loss mechanism; rewrapping a Response is **not necessary** to reproduce it.

There are **no generic HTTP retries** in the application. The native run made one conflict reread (360ms), and the wrapper run one (920ms); neither reached the second CAS backend call. The 1,500ms control fails before aggregate results can initiate conflict recovery, despite 507 conflict responses in otherwise successful chunks. Adding retry count alone would not supply the missing time budget.

Promise.all rejects before every sibling necessarily settles. The wrapper trace reached five overlapping request spans despite a nominal three-worker operation pool: old siblings overlapped later work. No request was observed starting after its own backend operation had ended, but already-started siblings can outlive that operation. This matters for cancellation accounting and serverless response completion; a three-worker method pool is not a global fleet concurrency limiter.

## 5. Fleet bottlenecks and evidence completeness

### Cache and repeated reads

There are 1,814 prepared scope appearances across the replay. The offline/300ms conditions have **1,114 cache hits (61.4%)**; native has 1,077; the slow control has **zero**. In that slow control, 465 document-bearing responses arrive successfully in individual batches, but their failed aggregate reads prevent cache adoption. All 465 returned documents are consequently unavailable to hydration.

Healthy HTTP processing reads 279 distinct scopes with 700 key participations. Some repeated reads are necessary after restart or a scope change. Others are empty remote scopes that never acquire an admissible write: no negative cache is installed after a successful null response. The slow run rereads 115 scopes in all seven rounds and has 1,141 read-key participations despite fetching only 223 distinct scopes before deadlines stop remaining batches. Incomplete read delivery, not a lack of distinct input observations, drives the repetition.

Within a processing cycle, one shared persistence cache already serves its vehicle scopes. Recommending “add a vehicle cache” without acknowledging this existing cache would miss the main defect. Coalescing duplicate in-flight work across sources/handlers and short-lived caching of confirmed misses are separate possible improvements, with correctness constraints below.

### Why exactly 81 final classifications disappear

All conditions receive the same original GPS rows. Comparing each vehicle/run scope at each processing cycle finds **1,814 / 1,814 identical local GPS-buffer counts** in every control and both real runs. Per-vehicle hashed counts are retained in the diagnostic profiles. The latest prepared-scope history view contains **876 local fixes** in both healthy and slow controls; current GPS progress is unchanged in all **2,391 / 2,391** comparisons. At the latest hydration view, however, healthy conditions hold **1,081 archived observations and 187 passage pairs**, versus **zero cached archived observations/pairs** in the slow control. This view is before each scope's latest write, not a final global database count.

Current native processing has 1,056 archived observations in that view—25 fewer than offline—but the same 187 passage pairs and **all 130 classifications**. Thus raw observation count alone is not the classification driver. The engine restores original validated passage pairs; it never replays historical raw coordinates as current motion.

The **81 missing final stop occurrences belong to 66 vehicles**. Every required valid pair is present in the healthy store, and every pair's second measurement predates the processing restart. In the slow control's final remote model, **78 of those pairs were never durably retained in its surviving snapshots; three are present remotely but never reach the process cache**. The two failure modes are therefore both relevant: incomplete pre-restart persistence and failed post-restart hydration. These per-pair counts are from the controlled reproduction, not reconstructed claims about the deleted Phase 1.1 remote documents.

The healthy model ends with 256 documents / 1,274 observations / 260 passage pairs. The slow model has 216 documents / 216 observations / eight pairs; document existence does not imply a complete journey history. This resembles Phase 1.1's observed 190 mostly single-observation documents and ten pairs, but exact historical per-key attribution is unavailable because that test's remote data was cleaned.

| Final eligible-stop primary reason | Offline / current real Redis | Slow control / Phase 1.1 unavailable-count pattern |
| --- | ---: | ---: |
| NO_GPS_HISTORY | 3,022 | 3,105 |
| INSUFFICIENT_EVIDENCE | 2 | 0 |
| GPS_GAP_TOO_LARGE | 1 | 1 |
| PASSAGE_TIME_UNAVAILABLE | 1 | 1 |
| GPS_OUTLIER_REJECTED | 1 | 1 |
| **Classified / eligible** | **130 / 3,157** | **49 / 3,157** |

Eligible stop keys match in every round. Neither real run nor either control introduces an unexpected classification or duplicate classified occurrence. The slow control's missing counts by rounds 4/5/6 are 61/64/81; 206 is their sum of snapshot appearances, not 206 distinct final stops.

### Ordering and clocks

An independent real-Redis clock audit checks **1,112 retained observations across 257 documents**: zero ordering/duplicate-timestamp errors and zero mismatches against original measurement, coordinate, publication and receipt variants. Duplicate GPS measurement timestamps may legitimately appear in later feed snapshots with different publication/receipt clocks. An initial diagnostic checker compared only the last such snapshot and reported false metadata mismatches; it was corrected only in the diagnostic script to accept any exact original captured variant. The corrected audit is the clock-validity evidence; superseded checks are explicitly labelled in the JSON.

### Critical path and CPU

Both hydration and persistence block `processWithPersistence`; the endpoint awaits all feed results. The current production code parallelizes the three bus feeds, unlike the sequential replay used for comparability. Nominally three active backend operations can therefore create up to nine concurrent requests, with additional overlap possible after early aggregate rejection. Actual production/global concurrency was not tested. No quota response, connection-cap error or HTTP 429 was observed; hidden provider limits cannot be excluded merely from that absence.

| 21 sequential operator snapshots | Offline | 300ms control | 1,500ms control | Native Redis |
| --- | ---: | ---: | ---: | ---: |
| Total processing wall time | 4.28s | 32.64s | 110.17s | 46.84s |
| Per-cycle wall P50 / P95 | 190 / 359ms | 1,430 / 3,084ms | 5,205 / 5,632ms | 2,092 / 3,697ms |
| Preparation total | 2.43s | 2.96s | 3.13s | 3.14s |
| GPS/classification total | 1.69s | 1.68s | 1.71s | 1.66s |
| Hydration total | 0.068s | 11.18s | 52.69s | 17.25s |
| Persistence total | 0.086s | 16.82s | 52.62s | 24.78s |

The native total process CPU counter is 8.72s versus 46.84s wall time; CPU counters include TLS, runtime/background work and instrumentation and are not a pure application function sum. GPS/classification CPU wall spans are stable across conditions. JSON.stringify/parse instrumentation totals **226ms** in native processing, including very frequent small key/signature operations; observational response parsing adds approximately **7ms**. JSON work is measurable but far too small to explain the approximately 42-second I/O-path increase.

Preparation calculates a preview journey, and main processing calculates the final journey. That duplicated CPU work is visible, but preparation precedes hydration's timer and does not explain the controlled slow-vs-fast failure. Persistence's timer does include candidate capture, merge and serialization. Event-loop monitors also saw approximately 2.3-second maxima across the whole diagnostic run, which includes static setup; without interval correlation those peaks cannot be assigned to a particular Redis request. They should not be mistaken for measured Redis execution time.

## 6. Optimization options for review — not implemented

| Option | Expected effect / testable estimate | Risks and required safeguards |
| --- | --- | --- |
| Preserve valid per-batch/per-key outcomes | Stop throwing away the observed 59 returned documents and 70 acknowledged updates when another batch fails | Every document must retain existing scope, clock and pair validation. Failed keys remain unavailable; partial transport success must not imply a whole fleet is durable. Preserve CAS and expiry. |
| Revisit batch sizes with byte bounds | Largest read has 113 keys: currently 12 requests / four waves. Hypothetical batches of 40 reduce this to three requests / one wave, **75% fewer HTTP requests for that operation** | Larger requests/responses can increase tail latency, parsing cost and memory. Respect provider limits and the adapter's 4MB response bound. This is arithmetic, not a measured speedup or selected batch size. |
| Size operation budgets for waves and cold connections | For four 1.5s waves, the model needs about 6s before validation overhead, so 2.5s is infeasible. Batch-aware budgets or fewer waves can address the mismatch | Increasing deadlines alone blocks realtime responses longer and leaves aggregate loss unresolved. Fit the full endpoint budget and retain post-I/O freshness checks. Do not accept stale evidence to hide latency. |
| Targeted, budgeted retries with cancellation completion | Retry only unresolved keys; allocate explicit time for conflict reread plus second CAS instead of spending the entire deadline first | More traffic under outage, unacknowledged writes, old checkpoints and competing instances require existing monotonic CAS semantics. Await/cancel sibling work predictably. |
| Retain existing cache; coalesce in-flight reads and carefully cache confirmed misses | Reduce repeated reads within/across concurrent processing without changing evidence quality | Do not cache a timeout as an empty history. Short negative TTLs must allow another instance's successful writes to become visible; invalidate after local writes and run/version changes. The 700→279 key-count difference is not wholly avoidable because restarts require reads. |
| Global request budget / bounded concurrency | Prevent the three feeds and lingering siblings from multiplying the per-method pool limit | Too small a global pool increases queue wait and worsens operation deadlines. More concurrency can overload the service and Vercel connections. Measure three-feed concurrency rather than extrapolating sequential results. |
| Connection reuse / locality | Preserve the already-observed 93.8% reuse; select a suitable long-lived database/runtime region to reduce the approximately 1s cold connection tail and network wait | Reuse cannot span a new OS/serverless instance. Region was not established here. Introducing a TCP client is not justified by these results alone. |
| Reduce repeated serialization / reuse immutable prepared structures | Modest CPU and payload savings; consider avoiding repeated snapshots or duplicate preview work after profiling | Current measured JSON work is only about 0.23s across the replay. Mutation/version errors could mix runs or alter progress. This is not the first lever for the 2.5s deadline failures. |
| Decouple realtime response from historical I/O | Could remove up to the observed approximately 5s storage wait from the critical path | Requires an explicitly durable queue/worker or supported awaited background lifecycle, not fire-and-forget Vercel promises. Initial classifications may remain unavailable until validated history is ready. Extra infrastructure and operational cost make this a separate architecture decision. |

Connection reuse and batching already exist; their presence alone does not solve operation-budget sizing or whole-aggregate failure semantics. The native and old-wrapper trials both reached 130, with nearly identical JSON CPU totals and some timeouts. These unpaired live trials do not establish a wrapper speedup; they rule out needing that wrapper to cause the underlying failure.

## 7. Expected improvement, acceptance criteria and uncertainties

Expected improvements above are hypotheses or arithmetic bounds. No production speedup, new timeout, batch size or revised architecture has been selected. For this dataset, the functional target remains **130 / 3,157**, not a larger count obtained by weakening requirements. The native run's 130 does not override the controlled failure or the historical Phase 1.1 failure.

Before any later optimization is accepted:

1. Reuse these exact frozen inputs and restart boundary. Match all 3,157 eligible keys, all 2,391 GPS/progress results and all classification fingerprints, with zero unexpected/duplicate classifications.
2. Repeat fast, 1.5s-per-batch, cold-connection, partial-batch-failure, timeout-after-server-write and CAS-conflict conditions. Account for every key as validated/confirmed, retryable or unavailable; never infer a successful whole operation from partial success.
3. A healthy repeated real run must recover 130 consistently after OS restarts, with no discarded successful batch outcomes. Deliberate outages may reduce availability conservatively but must not change GPS progression or fabricate adherence.
4. Report P50/P95/P99 for complete operations and individual requests separately, success/failure separately, plus queue/connection/body stages and actual dispatched counts. Establish a latency target using the chosen real Vercel region and complete endpoint budget before release.
5. Measure all three feeds concurrently, repeated polling, instance changes and a full 60-minute retention window. Confirm bounded global concurrency and that no untracked write work survives handler completion.
6. Keep original measurement clocks, ±120s, exact schedule eligibility, evidence quality, retention, vehicle/run isolation, passenger labels and railway logic unchanged; rerun full application regressions after implementation changes.

Remaining uncertainties are true Redis-server CPU/queue latency, DNS-versus-TCP-versus-TLS subdivision, provider region/hidden limits, replica read consistency, sustained traffic/billing and actual Vercel concurrency. Upstash documents eventual replication and connection/session consistency considerations; this investigation did not demonstrate a replica-consistency fault or measure it separately. [Provider consistency documentation](https://upstash.com/docs/redis/features/consistency).

The old Phase 1.1 trace did not capture request-stage signals or per-key original remote documents before cleanup. Its exact 108-timeout stage breakdown cannot be reconstructed retroactively. This report identifies and reproduces the application failure chain rather than claiming unavailable historical server telemetry.

Independent clock-audit cleanup confirms **zero remaining keys**. Credentials remain in ignored validation files. Only this report and aggregate evidence are added to the repository; diagnostic programs/traces stay outside it. No production persistence, application optimization, threshold/progress/railway change, commit, push or deployment was performed. Stop here for review.
