# Phase 1.6G — Final reliability and production readiness audit

## Decision

**Keep production archival disabled.** Deferred Admission removes the database wait from the journey response in the tested code path. It preserves the existing PostgreSQL outbox and stable evidence IDs. The request process still owns uncommitted candidates, and its lifetime is finite. This audit measured managed PostgreSQL and reviewed the hosted execution contract. It did not run the archive prototype on Vercel.

## 1. Architecture from Phase 1.6A to 1.6F

| Phase | Contribution to the current design |
| --- | --- |
| 1.6A | Immutable evidence snapshots preserve the original accepted GPS crossing, trip and stop, timetable reference, calculated result and versioned proof. Historical readback validates the snapshot independently of current tracking. |
| 1.6B | PostgreSQL outbox adds a durable intent and a leased delivery worker. Archive insertion and terminal receipt settle in the same transaction. The stable record ID prevents overwrite and duplicate archive records. |
| 1.6C | Isolated managed tests verified transaction durability and observed acknowledgements missed at the client. The staging limit rejected 416 of 2,400 synthetic candidates, and termination before commit lost staged candidates. |
| 1.6D | Admission moved into the live feed path. The bounded retry buffer reports rejection and expiry. Uncertain writes check durable receipts or retry the same ID. |
| 1.6E | Awaiting admission added about 840 ms in a successful managed 24-vehicle trial and about 2.51 s in deadline trials. The 30-second dashboard poll and 55-second client abort made that delay operationally relevant. |
| 1.6F | A local feature flag starts admission at the same point and registers the in-flight promise with Next.js. The journey response can return while evidence is pending. The local matched slow trial fell from 2.51 s to 10.44 ms response-ready. |

The boundaries are candidate generation, volatile staging, committed outbox intent, then committed historical archive and receipt. A current passenger classification is independent of these archive states. The code uses the existing ±120-second threshold, GTFS matching and GPS validation throughout. This audit did not change source, schema, settings or deployment.

## 2. Next.js execution and hosted runtime

The working-tree routes `/api/transit` and `/api/bus-journey` run in Node.js, are dynamic, and each declare `maxDuration = 60`. They pass Next.js `after` into the feed pipeline. When `TRANSIT_CLASSIFICATION_DEFER_ADMISSION=1` and the request retainer is available, the same process starts `archive.admit()` and registers its promise before returning the journey. Installed Next.js 15.5.28 implements the promise form by passing it to the request's `waitUntil`. Both handlers also register a separate `after(() => archive.flush())` callback for follow-up and delivery. If early registration is unavailable, the feed waits for admission. [Next.js after](https://nextjs.org/docs/15/app/api-reference/functions/after)

| Boundary or event | Local Node.js evidence | Vercel implications |
| --- | --- | --- |
| Response finishes while admission is active | The installed Next.js `AfterContext` retained a managed-write promise in the local harness. The Phase 1.6F Chromium fixture also showed local progress and commit after browser disconnect. | `waitUntil` keeps a registered promise eligible to execute after the response within the function's remaining execution budget. It is tied to the invocation, without a durable queue or a promise of successful completion. |
| Browser abort at 55 seconds | The browser stops waiting. Neither route forwards its request signal into the journey processor or PostgreSQL adapter. | Client abort and invocation termination are distinct. Hosted disconnect handling was not fault-injected. A late commit can still occur and require reconciliation. |
| Function deadline | Managed controls used local timeouts and did not impose a Vercel invocation kill. | Vercel documents that `waitUntil` and `after` tasks are subject to the function timeout and are terminated if the function times out. The 1.5-second query and 2.5-second admission budgets cannot reserve time beyond the host limit. |
| Process dies, recycles or scales down | A killed child lost its heap and retained promise. An open database transaction rolled back. The committed intent remained queryable. | A fresh instance cannot recover another instance's staged map, diagnostics or promise. The PostgreSQL commit boundary still applies if the old instance dies before receiving the acknowledgement. |
| Concurrent requests or scaled instances | There is one admission flight per archive instance. Independent stores can submit the same ID, as tested against PostgreSQL. | Fluid compute can share a process across invocations and can also scale across instances. Local maps, throttle and deduplication are never cross-instance coordination. PostgreSQL is the durable arbiter by record ID and worker token. |
| No subsequent eligible request | There is no autonomous retry scheduler. The request-retained promise ends at settlement, failure or budget exhaustion. Unresolved in-memory candidates remain available only to that process. | Pre-commit work can wait without a next request and vanish on eviction. Durable intents can remain pending past lease or evidence expiry until another worker runs, with terminal cleanup depending on later processing. A successful browser response does not prove admission or delivery. |

The code review distinguishes the 2-second retry throttle, 5-second idle poll threshold and database leases from an independent scheduling mechanism. None of them wakes an idle instance on its own. Per-instance counters are diagnostic and can reset. Archive receipts are the durable confirmation. [Vercel function lifecycle](https://vercel.com/kb/guide/troubleshooting-inconsistent-logs-in-vercel-functions) · [Vercel Fluid compute](https://vercel.com/docs/fluid-compute) · [Vercel concurrency scaling](https://vercel.com/docs/functions/concurrency-scaling)

### Actual deployment evidence

The public production alias and its demo route returned HTTP 200 through Vercel. The demo route exposed `sin1` and `iad1` as Vercel header tokens. These describe the observed request path and do not establish all configured function regions or plan settings. The prior Phase 1.4 managed Preview validation recorded Node 26.x in `iad1` and one confirmed out-of-memory termination. The latest local Git commit `235f7cb` predates the archive files. The current archive changes are local. Authenticated read-only inspection of current production and the historical Preview was unavailable, leaving their private timeout overrides, Fluid compute settings and deployment revisions unverified. [Public production alias](https://transit-scope-malaysia.vercel.app/) · [Phase 1.4 Preview validation](timetable-adherence-evidence-phase1-4.md)

## 3. Managed PostgreSQL and validation method

A fresh isolated Neon Claimable project in `aws-us-east-2` ran PostgreSQL 17.11. It held only synthetic fixtures. Application timings used the existing pooled Neon HTTPS adapter, the Phase 1.6F workloads and delay values, and the actual gzip transit response builder. A local AfterContext collector tracked the promise in each deferred run. Separate direct TLS controls used the same database to isolate database behaviour from the HTTPS path. These are Windows-client measurements from Malaysia. They exclude live feed downloads, Redis, Vercel cold start and browser transfer. The hosted plan and exact deployed function limits were not inferred from the database region. [Neon Claimable](https://neon.com/claimable-neon) · [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver)

### Matched request path

Each pair used the same synthetic workload, proof rules, deadlines and delay condition. The response-ready timing includes the fixture equality check and gzip body preparation. All **54 journey outputs** matched the archive-disabled reference. The 1.5-second HTTPS query deadline and 2.5-second admission budget stayed in force. Deferred registration let the response proceed while the admission attempt was active.

| Workload and condition | Pairs | Response-ready awaited P50 / P95 | Response-ready deferred P50 / P95 | Admission awaited / deferred P50 | Confirmed intents per mode |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 vehicle, 260 ms injected pre-dispatch delay | 8 | 2,505.18 / 2,516.85 ms | 1.47 / 5.93 ms | 2,502.80 / 2,502.64 ms | 0 of 24 |
| 24 vehicles, 840 ms injected delay | 1 | 2,521.00 ms | 20.13 ms | 2,506.17 / 2,507.35 ms | 0 of 72 |
| 24 vehicles, 60-second injected stall before dispatch | 12 | 2,517.54 / 2,525.58 ms | 10.72 / 15.77 ms | 2,509.84 / 2,503.38 ms | 0 of 864 |
| 72 vehicles, same injected stall | 1 | 2,526.49 ms | 24.12 ms | 2,505.52 / 2,499.98 ms | 0 of 216 |
| 24 vehicles, immediate transport failure | 1 | 17.42 ms | 10.66 ms | 10.58 / 4.54 ms | 0 of 72 |
| 24 vehicles, attempted lost-acknowledgement injection | 1 | 2,515.73 ms | 18.99 ms | 2,506.72 / 2,499.47 ms | 0 of 72 |
| 24 vehicles, no injected delay | 3 | 2,521.28 / 2,522.11 ms | 10.10 / 11.79 ms | 2,514.39 / 2,509.15 ms | 0 of 216 |

Single trials show the observed time. The two loss-injection HTTPS lanes timed out before they reached the condition for discarding a successful response. A separate direct SQL control below exercised real commit with lost acknowledgement. SQL independently found zero intents after this HTTPS series. All unconfirmed snapshots in the table stayed pending in their test instance until those instances were discarded. An isolated timeout remains an unknown commit outcome until SQL evidence resolves it.

Uninstrumented HTTPS `SELECT 1` probes reproduced the issue. All three probes with 1.5-second deadlines expired. Three 8-second controls completed in **2.49–3.48 s**. A fresh TLS session plus its first direct SQL probe completed in **3.35 s**. These observations establish a client-observed deadline problem on this path during this run. They do not identify network transit, connection establishment, compute, proxy routing or server execution as its cause.

The 24-vehicle slow condition used the same fixture and deliberate pre-dispatch stall as Phase 1.6F, so it provides a check on the control flow. The local phase measured 2,514.49 ms awaited and 10.44 ms deferred at P50. This phase measured 2,517.54 ms awaited and 10.72 ms deferred. Both timed out before dispatch. Successful local SQL round trips cannot be compared directly with managed HTTPS timeouts. Neither timing is a production latency claim. [Phase 1.6F validation](timetable-adherence-evidence-phase1-6f.md)

### Direct managed controls

The same 24-vehicle fixture ran with the 840 ms healthy delay and with the 260 ms enqueue plus 263 ms receipt delays for acknowledgement loss. Both modes used direct TLS to the same PostgreSQL database. The harness retained the 2.5-second application loop budget and used a separate 12-second native SQL guard, so the direct results are a correctness and latency control with a different transport and deadline implementation.

| Direct condition | Response-ready awaited / deferred | Admission awaited / deferred | Confirmed intents per mode |
| --- | ---: | ---: | ---: |
| Healthy | 2,094.82 / 16.44 ms | 2,080.33 / 2,071.95 ms | 72 |
| Real commit with injected acknowledgement loss | 1,796.57 / 10.45 ms | 1,788.06 / 2,087.26 ms | 72, verified by receipt |

Each deferred response had **72 pending and zero confirmed** at return. Both modes confirmed the 72 afterwards. The lost-response receipt operations took 595.95 and 612.32 ms including the deliberate delay, or **317.92 and 340.00 ms** on direct SQL after dispatch. All four journey outputs matched the archive-disabled reference.

A separate four-producer direct control committed **1,024** distinct intents in **4.99 s**, about **205 intents/s**. The 16 batch acknowledgements had 702.3 ms P50 and 3,803.8 ms P95. Four workers then archived the backlog in **2.79 s**. The final combined SQL counts had 11,312 distinct archive rows and matching intents, with zero failed or pending. The independent 1,024-record single-producer baseline below uses its own test window, so these are controlled throughput observations.

### Managed backlog and commit measurements

The backlog trials used the same sizes and delivery-worker counts as Phase 1.6F, with one direct TLS producer, 64-record batches and delivery paused until enqueue finished. Each producer row below includes fixture generation and acknowledgement of the managed writes. The worker timings begin at the start of the committed-backlog drain and include claim and delivery. The direct controls used a 15-second SQL query guard and continuous workers. Their timings describe the database-backed queue and cannot establish the production HTTPS or per-request drain capacity.

| Records / delivery workers | Full enqueue time | Enqueue batch P50 / P95 | Backlog drain | Archived per second | Sampled PostgreSQL backends total / active | Sampled Node RSS initial → peak | Sampled Node heap initial → peak |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,024 / 1 | 18.80 s | 1,092.4 / 2,085.2 ms | 10.30 s | 99 | 10 / 1 | 108.18 → 117.84 MiB | 37.27 → 45.70 MiB |
| 1,024 / 4 | 8.00 s | 490.6 / 705.2 ms | 2.93 s | 350 | 10 / 2 | 117.86 → 126.23 MiB | 37.43 → 44.77 MiB |
| 5,000 / 4 | 37.41 s | 396.5 / 737.3 ms | 12.30 s | 407 | 10 / 2 | 126.32 → 164.79 MiB | 37.33 → 64.11 MiB |
| 10,000 / 4 | 78.21 s | 405.3 / 703.5 ms | 24.49 s | 408 | 10 / 4 | 164.69 → 219.91 MiB | 37.53 → 90.91 MiB |

The first trial used explicit `BEGIN`, batch insert and `COMMIT` to isolate commit acknowledgement. Across its 16 transactions, the **client-observed COMMIT round trip was 298.9 ms P50 and 888.9 ms P95**. The other enqueue trials used one autocommit insert per batch, so their enqueue latencies include commit and transport. The managed HTTPS path supplied no confirmed commits in the primary series and therefore no successful HTTPS commit latency samples. The direct `COMMIT` timing includes WAN transport and client scheduling. PostgreSQL server execution time was outside the measurement.

Every backlog run ended with the requested distinct archive and intent count, zero pending, and zero failed. The PostgreSQL `max_connections` setting was 450. The sampled backend counts include the observer and worker connections. They do not establish the provider's HTTPS or pooled frontend connection ceiling. Node memory is sampled on the Windows test process and includes fixture generation, counters and driver state.

## 4. Failure, pending state and recovery

| Scenario | Observed result |
| --- | --- |
| Normal Deferred Admission | The direct 24-vehicle comparison returned while all 72 candidates were pending, then confirmed all 72. Four independent archive instances with four direct managed sessions submitted one fresh ID. One writer committed the intent and three received existing-intent acknowledgements. The shared ID archived once, with one terminal receipt and one delivery attempt. The managed HTTPS timing path had no successful admissions in this run. |
| Slow PostgreSQL response | In the 24-vehicle timed stall, the deferred response was ready while all 72 candidates per trial were still pending. At the end of each lane, all 864 candidates remained pending and zero were counted as committed. |
| Termination before dispatch with registered work | The child returned from the feed handoff with one retained promise and `pending=1, committed=0`. The test killed the child before sending SQL. The observer found no outbox row before or after the kill. |
| Termination before PostgreSQL commit | The child executed the insert in an open transaction and then died. The observer found no durable intent or archive row. The fresh application worker recovered neither of the two pre-commit candidates. |
| Termination immediately after commit | The child committed and was killed before the application received the acknowledgement. The response-time status still reported pending. The observer found a durable `PENDING` intent. A fresh worker recovered and exactly verified the original snapshot. |
| Lost acknowledgement and unavailable receipt | After a real managed commit, the harness discarded the acknowledgement and blocked the receipt read. The archive reported `COMMIT_OUTCOME_UNKNOWN` with zero confirmed candidates. SQL showed the intent as `PENDING`. The same-ID retry took **294.57 ms** after advancing the test clock past the two-second throttle. The immutable row and terminal receipt stayed intact, with one delivery transition. |
| Sustained outage and repeated requests | A **60.01 s** application-side transport block held back all writes, with the independent database reachable. Four bursts of 600 offered candidates filled the buffer at **1,984 records and 3,999,036 bytes**, rejecting **416** explicitly. Eight feed invocations caused four admission attempts and four receipt attempts. Each repeat within the throttle interval issued no extra operation. The worker reported zero confirmed intents during the outage. |
| Recovery from pending work | The same live worker took **32.81 s** to durably admit the 1,984 retained candidates, including waits between seven invocations. Some direct control calls exceeded the worker's loop deadline because the native query guard is separate from the application signal. Four managed delivery workers drained the committed backlog in **5.20 s**. Full readback matched all 1,984 payloads. SQL found no outbox rows for the 416 rejected IDs. |
| Hosted instance termination and managed compute restart | Local process termination used real managed transactions. A Vercel eviction, hosted invocation timeout, provider-wide outage and controlled managed PostgreSQL restart remain unverified. |

The sustained-outage runner's sampled Node RSS rose from **93.27 to 108.27 MiB**, and used heap rose from **32.66 to 44.70 MiB**. This includes the fixture generator, application archive and test code. The oldest observed staging residence reached **71.29 s** during recovery. These samples cannot size a Vercel instance. The byte cap is a per-instance bound on serialized candidate data. Each instance also retains objects, caches and client state.

### Persistence accounting

The tested pending states never incremented the committed or persisted counters before acknowledgement or receipt confirmation. A snapshot that was already committed but whose response was lost remained unknown until verified. An acknowledged outbox insert confirms the intent only. Historical persistence requires a terminal receipt and a valid archive row. With the current migrations, same-ID retries confirm a conflict without changing the stored payload. Rejected and expired work, and pending intents after a timeout, belong in separate counts.

**Pre-commit crash accountability remains incomplete.** Capacity and transport rejections are observable while the process lives. A hard kill can erase the candidates and local counters together. A pending warning signals exposure and supplies no durable per-ID recovery record. A committed receipt is recoverable without the original process.

## 5. Durable pre-commit architecture options

| Option | Reliability and recovery | Latency, complexity and cost |
| --- | --- | --- |
| In-process Deferred Admission | The first durable boundary is PostgreSQL commit. Lifetime extension improves opportunity to complete. A hard kill before commit can lose evidence and the local accounting. Retry requires a suitable live process or a new candidate, and delivery of committed intents requires a worker. | Lowest incremental infrastructure and response wait. Buffer caps protect each instance from unbounded serialized staging. Fleet-wide visibility and liveness still need work. |
| Direct synchronous PostgreSQL admission | An acknowledged insert or receipt confirms durable handoff before replying. A database outage or pre-commit kill can still prevent admission. Returning a valid live result after timeout keeps the same underlying loss window. | Simplest confirmed-admission protocol. It spends response budget on writes and receipt reads. Waiting indefinitely or failing live requests to enforce admission would change availability semantics. |
| Durable upstream staging | A durable handoff outside the PostgreSQL failure domain can survive an application restart and a PostgreSQL outage. Exact snapshots can then replay using the same IDs. Protection starts at that upstream acknowledgement. | Adds storage, retention, access control, replay, monitoring and operating cost. Its own acknowledgement may add response time unless collection is decoupled at the input boundary. A second table in the same PostgreSQL service shares the outage domain. |
| Managed background worker | A request-independent worker can drain an existing committed outbox and recover expired leases even when the dashboard is idle. It cannot recover candidates that exist only in the killed web process. | Moderate operational burden and compute cost. Reuses PostgreSQL and the current worker contract. Provides independent liveness after commit without requiring a separate queue. |
| Reconstruction from retained GPS | Can reconstruct a valid assessment only when original accepted fixes, exact schedule, run/projection context, confirmation and evaluation time are available. Phase 1.6E recovered fixture IDs with the original inputs and recovered none when the fixes were removed. Existing optional GPS history has finite retention and best-effort writes. | Avoids an additional candidate queue if there is already a reliable replay source. Deterministic replay and data retention must be validated. Reconstruction of a current assessment cannot replace the original immutable snapshot. |

The simplest path for **best-effort historical archival** is the existing PostgreSQL outbox with Deferred Admission, durable receipt monitoring, and a request-independent worker if idle backlog recovery is required. That path needs a measured loss and latency budget before activation. If the requirement is to preserve **every accepted candidate across a hard pre-commit crash or PostgreSQL outage**, this audit justifies a durable upstream boundary or an equivalent verified replay source. It does not select or justify provisioning a new external service until the retention, outage and loss requirements are agreed. Live journey availability should retain its own budget and failure policy.

## 6. Readiness by environment

| Environment | Assessment |
| --- | --- |
| Local development | Suitable for opt-in implementation and fault testing with isolated data. The local collector demonstrates control flow and request-lifetime registration. |
| Isolated managed PostgreSQL | Suitable for validating committed-intent durability and throughput. The HTTPS deadline results block activation on the measured client route. These data do not establish hosted application reliability. |
| Preview deployment | Archived Phase 1.4 operational evidence supplies context, including a confirmed OOM. The Phase 1.6F prototype was not deployed for this audit. A future, separately authorized Preview must verify actual request-lifetime execution, colocated latency, post-response budget, cross-instance observability and recovery. |
| Production deployment | Keep archival disabled. The production gate returned no archive when supplied a valid test URL and opt-in flag. Complete pre-commit accountability, verified hosted execution, and reliable admission under the target budget remain prerequisites. |

The existing code checks `VERCEL_ENV=production` and separately requires a database URL to activate. Vercel documents project-controlled exposure of its system environment variables. A deployment with a missing marker and an accidentally configured URL could bypass that specific code guard. Verify the environment marker and absence of Production credentials in any future release review. A positive allowlist for an isolated environment would make a future activation gate easier to audit. The current private settings were unavailable for inspection. [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)

### Regression

| Check | Result |
| --- | --- |
| Vitest | 353 passed across 28 files, including 22 archive and outbox tests. |
| TypeScript | Passed with `tsc --noEmit --incremental false`. |
| ESLint | Passed. |
| Next.js production build | Passed on Next.js 15.5.28. |
| Playwright Chromium | 100 passed against the local production build. |

[Managed timings and faults](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6g/validation-results.json>) · [Direct admission and throughput controls](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6g/managed-controls.json>) · [HTTPS transport probes](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6g/transport-probes.json>) · [Hosted read-only observations](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6g/deployment-observation.json>)
