# Phase 1.6H — Deferred Admission HTTPS verification and Vercel readiness

## Executive summary

**Keep production archival disabled.** Phase 1.6G generated eligible evidence and invoked Deferred Admission. The configured HTTPS deadlines expired in that test window. In Phase 1.6H the same configured deadlines allowed normal HTTPS admission, a real lost-acknowledgement recovery, and same-ID retries against managed PostgreSQL. The focused matrix finished with 15 distinct archive rows and matching intents, zero pending or failed. A separate test of the actual local transit route archived three more snapshots and returned the same journeys as the archive-disabled control.

This verifies the managed HTTPS path from the test environment. It does not establish execution under Vercel eviction or timeout, dependable hosted admission latency, or pre-commit durability. No application code or migrations changed. An isolated temporary Neon test project was necessary because the Phase 1.6G database credentials had been removed and no reusable PostgreSQL connection was available. It used the same provider and schemas, held only synthetic records, and was separate from the application and Vercel. [Neon Claimable](https://neon.com/claimable-neon)

## 1. Why Phase 1.6G recorded zero intents

Recounting the raw Phase 1.6G request records found **3,072 eligible candidates in 54 runs**, 54 attempted enqueues and 54 attempted receipt reads. The harness reached `ProcessedBusJourneys.processWithPersistence`, captured the eligible records and invoked the configured archive. Its fixture supplied a seeded GPS history to that processor. It skipped the upstream protobuf and ZIP decoder by design, while exercising the real classification, eligibility, admission and receipt path.

| Question | Finding |
| --- | --- |
| Were there eligible candidates or a filtering problem? | All 3,072 were captured and remained pending when their tests ended. Eligibility and capture worked. The independent Phase 1.6H route fixture also reaches eligibility from encoded feed data. |
| Did the experiment measure response timing alone? | It waited for the retained admission promise and recorded its enqueue and reconciliation outcomes. It had no confirmed outbox intents to deliver in that series. |
| Did config disable the archive or prevent Deferred Admission? | The archive was configured against isolated PostgreSQL with the local Preview marker. Awaited and deferred modes both attempted admission. Deferred runs registered their promise. |
| Did operations reach the HTTPS transport? | Each operation type had 54 attempts. In each, 26 were handed to real fetch, 26 were blocked by the deliberate pre-dispatch delay until cancellation, and two were rejected by the injected outage. A handoff to fetch does not establish that PostgreSQL received it. |
| What happened to attempts without an injected delay? | The actual HTTPS requests also expired. The 1.5-second per-query deadline used most of the 2.5-second admission budget, leaving about one second for the receipt check. Separate Phase 1.6G uninstrumented `SELECT 1` calls expired at 1.5 seconds and succeeded at 2.49–3.48 seconds with an 8-second guard. |
| Was failure silent? | The harness captured unconfirmed or timeout outcomes. Independent SQL found zero intents and archive rows after the series. The request could still return valid journeys. A client timeout alone remains an unknown commit outcome. |

The immediate cause was **HTTPS completion outside the configured budget in that test window**, plus deliberate pre-dispatch faults in the corresponding controls. The evidence does not isolate the underlying network, TLS, proxy or compute delay in the earlier project. In this phase, four pooled URL probes took 239–783 ms, four direct-host URL probes took 237–255 ms, and the independent direct SQL probe took 249 ms after connection. The installed driver resolved both URL variants to the same HTTPS endpoint, so these probes do not isolate the pooler. They establish that the timeout condition was intermittent across validation windows. The current deployment deadlines were left in place. [Phase 1.6G audit](timetable-adherence-evidence-phase1-6g.md) · [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver)

## 2. Route trace from ingestion to history

The local harness called the existing `/api/transit` handler. It replaced only government feed network responses with encoded GTFS-Realtime protobuf and GTFS Static ZIP fixtures, used a fixed GPS clock, and supplied a local collector for the request's `after` hooks. The promise registrations used the installed Next.js `AfterContext`. The SQL calls used the real configured HTTPS adapter and independent PostgreSQL readback. This tested the route and application path with synthetic feed data, in a local host fixture.

| Stage | Evidence |
| --- | --- |
| Official feed ingestion | The handler loaded one static ZIP and fetched 20 realtime fixture responses across five polls and four feeds. The official decoder retained the vehicle's actual measurement timestamp separately from the feed header. |
| Candidate generation and eligibility | A series of five valid points produced 0, 0, 1, 2 and 3 eligible current stop classifications. The first two polls were no-ops for admission. Already captured IDs were suppressed on later polls, leaving three distinct immutable snapshots. |
| Deferred admission | Each of the final three polls registered one in-flight admission promise. The returned journey had one newly staged candidate and zero new durable confirmations in that response. |
| Handoff and worker | Each registered HTTPS write confirmed the next intent. The existing follow-up callback then claimed and delivered it through the configured worker. There were 11 managed HTTP calls across all five polls, including worker polls with no due work. |
| Durable receipt and historical status | PostgreSQL returned three unique archive rows, three `PERSISTED` receipts and zero pending payloads for the fixture vehicle. All five journey hashes matched the archive-disabled run. The last journey retained the expected delayed, on-time and early assessments under the existing ±120-second threshold. |

## 3. Managed HTTPS matrix

The focused matrix used fresh synthetic vehicle IDs and the same fixture history as the archive-disabled journey control. Each eligible vehicle produced three exact accepted stop snapshots. All 12 request-level journey results were checked for exact equality with their archive-disabled reference. The application used the configured **1.5-second query deadline** and **2.5-second admission budget**. A separate HTTPS worker control with a 12-second query guard drained the fault cases after admission. The normal case first used the actual configured post-response `flush()`, which archived all three in **1,067.75 ms**. No admission required the longer control replay in this run.

The matrix reports enqueue attempts separately from durable intent commits. A new-intent commit is a successful SQL write with new rows, independently verified in PostgreSQL. A same-ID statement can succeed without inserting rows. Recovered acknowledgements count records confirmed by the receipt lookup after deliberate loss. The SQL `RECOVERED` delivery state is separate.

| Trial | Eligible candidates | Enqueue attempts | New write commits / intent rows | Durable intents final | Recovered acknowledgements | Archived final / new | Rejected | Pending at response → after initial admission → final |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| No history, explicit no-op | 0 | 0 | 0 / 0 | 0 | 0 | 0 / 0 | 0 | 0 → 0 → 0 |
| Normal | 3 | 1 | 1 / 3 | 3 | 0 | 3 / 3 | 0 | 3 → 0 → 0 |
| PostgreSQL statement delay | 3 | 2 | 1 / 3 | 3 | 0 | 3 / 3 | 0 | 3 → 3 → 0 |
| Injected transport outage | 3 | 2 | 1 / 3 | 3 | 0 | 3 / 3 | 0 | 3 → 3 → 0 |
| Lost acknowledgement | 3 | 1 | 1 / 3 | 3 | 3 | 3 / 3 | 0 | 3 → 0 → 0 |
| Three same-ID replays | 9 evaluations, 3 IDs | 3 | 0 / 0 | 3 existing | 0 | 3 / 0 | 0 | 9 → 0 → 0 |
| Four concurrent same-ID requests | 12 evaluations, 3 IDs | 4 | 1 / 3 | 3 | 0 | 3 / 3 | 0 | 12 → 0 → 0 |

In the replay trials, each request confirmed its three existing IDs. The concurrent trials each attempted one write. One inserted the three IDs and the other three confirmed existing intents. All successful archive receipts were `PERSISTED` on attempt 1. Repeating the normal ID preserved its original terminal state, attempt count and settlement timestamp. The independent observer compared each archived payload with the original fixture. The matrix completed with **15 archive rows, 15 distinct archive IDs, 15 intents, zero pending and zero failed**.

### Latency and fault recovery

Response-ready time includes journey processing, equality assertion and gzip preparation. Admission time measures the promise through its first result, including a receipt lookup where attempted. Commit acknowledgement time is the full client-observed HTTPS round trip for an autocommit write that returned new IDs. It includes network and proxy time. PostgreSQL server-only commit execution was outside this measurement.

| Trial | Response ready | Initial admission | Successful new-write acknowledgement | Recovery or conflict timing |
| --- | ---: | ---: | ---: | --- |
| No-op | 4.03 ms | 0.05 ms, no SQL | — | No background admission registered. |
| Normal | 2.80 ms | 316.39 ms | 315.06 ms | Configured follow-up archived all three. |
| Statement delay | 2.67 ms | 2,504.49 ms | 749.75 ms on retry | First enqueue timed out at 1,502.18 ms and receipt read timed out at 1,000.99 ms. After verification, retry admission took 750.43 ms. |
| Transport outage | 2.13 ms | 0.84 ms | 248.09 ms on retry | The harness blocked before dispatch. Once restored, admission took 248.74 ms. |
| Lost acknowledgement | 1.84 ms | 546.07 ms | 253.61 ms, deliberately discarded before the application saw it | HTTPS receipt lookup took 291.53 ms and confirmed all three. |
| Same-ID replay, in order | 1.89 / 2.09 / 1.38 ms | 265.81 / 270.16 / 252.44 ms | — | Successful conflict acknowledgements took 265.16 / 269.57 / 251.92 ms. |
| Concurrent, lane order | 6.22 / 5.54 / 4.78 / 4.07 ms | 282.65 / 280.49 / 1,044.64 / 1,287.07 ms | 279.37 ms for the inserting lane | Three conflict acknowledgements took 277.99 / 1,042.69 / 1,285.78 ms. |

The delay case added a temporary PostgreSQL statement trigger that slept for 2.2 seconds before the outbox insert. The observer found no intent after the timed-out attempt. The trigger was removed before the same-ID retry. The outage case left the database available to the independent observer and blocked the application's transport before dispatch. Neither injection models a provider-wide outage. The successful follow-up kept the original candidate snapshots and confirmed each ID once. The lost-acknowledgement injection waited for a real successful managed HTTP write before discarding its response.

## 4. Process recovery and Vercel runtime

Two local child processes used the configured archive against managed HTTPS. Each returned from the feed handoff with one retained promise, one pending candidate and zero committed candidates in its own counters. One was killed before dispatch. Its intent remained absent. The other was killed after a real successful HTTPS write and before the application received the acknowledgement. Its SQL intent remained `PENDING`. A fresh worker used the configured HTTPS adapter to archive the exact original snapshot and verify a `PERSISTED` receipt in **2.28 s**, including independent readback. This establishes the actual HTTPS commit boundary under local process termination. Vercel host termination and compute recycling were outside this control.

| Evidence scope | Verified and remaining limits |
| --- | --- |
| Local Next.js and Node.js | The actual route fixture started the existing writer, registered the promise and ran its follow-up with the installed hook semantics. Prior Chromium coverage observed a 55-second browser abort and queued refresh. The browser timer does not supply a cancellation signal to the archive path. Local process controls do not exercise Vercel's host deadline. |
| Managed PostgreSQL via HTTPS | The matrix verified connection use, real writes, durable readback, receipt reconciliation and same-ID coordination across independent archive instances. The repeated 60-second outage control in Phase 1.6G exercised retry throttling and capacity pressure through a managed database with injected application unavailability. Managed provider failover and a controlled compute restart with pending intents remain unverified. |
| Existing Preview | Prior Phase 1.4 validated an older Preview and recorded one runtime OOM. It did not run this archive. Read-only CLI inspection lacked credentials in this phase, and no controlled Preview running this code was available. This phase made no deployment. |
| Production | The existing public alias responded through Vercel. Current private configuration, instance topology, cancellation and effective limits were unavailable to inspect. Archive admission and termination behaviour in Production remain unverified. |

Both local routes declare `maxDuration = 60`. The installed Next.js implementation passes a registered promise into the request's `waitUntil`. Vercel documents that retained work may continue after the response within the invocation budget, and that function timeout terminates it. That lifetime extension does not persist the pending promise or retry buffer. With recycling, eviction or scaling, other instances can submit or process the same ID, and PostgreSQL coordinates those committed intents. No other instance can load the original process's uncommitted candidates. Connection setup or reuse is also subject to the host and provider. The successful managed connection timings do not measure those hosted behaviours. [Next.js after](https://nextjs.org/docs/15/app/api-reference/functions/after) · [Vercel Functions API](https://vercel.com/docs/functions/functions-api-reference) · [Vercel timeout and background tasks](https://vercel.com/kb/guide/troubleshooting-inconsistent-logs-in-vercel-functions) · [Vercel Fluid compute](https://vercel.com/docs/fluid-compute)

A host kill or cancelled network response can occur before or after database commit. Before commit, only the current process can hold the candidate and any retry state. After commit, a fresh request can use the stable ID and existing receipt to recover it. The current system relies on request-triggered retries and delivery. Repeated outages can fill the per-instance buffer, and an idle or replaced instance can leave work pending indefinitely until another eligible worker runs. No result in this phase proves Vercel can complete every post-response write.

## 5. Minimum safe architecture

| Option | Data-loss window and recovery | Operational complexity and Vercel suitability | Every accepted candidate survives a pre-commit crash |
| --- | --- | --- | --- |
| A. Existing outbox with best-effort admission | Memory is vulnerable until PostgreSQL commits. After commit, stable IDs and the existing worker recover original evidence. Outages can lead to explicit rejection, expiry or lost pending work if the process dies. | Lowest burden and no additional application infrastructure. Works within the serverless invocation budget if measured latency fits. Request-triggered processing alone provides limited liveness. | **No** for candidates accepted into the local buffer. The guarantee starts at confirmed PostgreSQL admission. |
| B. Durable upstream handoff before accepting | Protects a candidate after the upstream durable receipt. A later worker can replay the exact snapshot through PostgreSQL using the same key. The interval before that receipt still needs an explicit failure policy. | Requires a verified durable boundary, retention, replay, monitoring and backpressure. Surviving a PostgreSQL outage requires an independent failure domain or a durable input already available. Waiting for upstream acknowledgement can affect live latency. | **Yes, conditionally.** Accept only after the independently durable handoff has committed and can be verified. |
| C. Verified replay from retained original GPS observations | The exact original measured fixes, schedule, run/projection identity, confirmation and evaluation context must be durably retained. Missing or expired inputs, weaker proof and changed context can prevent exact reconstruction. | May reuse an existing proven input journal. Adds validation, replay, versioning and retention obligations. Existing best-effort GPS retention supplies no such guarantee today. | **Unproven.** Requires independent durable retention and tested replay of every accepted candidate across the targeted failure. |

The existing outbox is the minimum infrastructure for **best-effort** archival once hosted performance and receipt monitoring are validated. If every accepted candidate must survive pre-commit termination, option B meets that contract only after a verified durable acknowledgement. Option C is viable only after proving equivalent replay coverage and retention. This phase selected and implemented no new architecture.

## 6. Regression and production readiness

**Keep Production archival disabled.** The application-level acceptance tests establish that candidate generation, configured HTTPS, idempotency and reconciliation work in the measured conditions. The earlier HTTPS deadline failures remain relevant under different transport conditions. Current private deployment settings and hosted execution with this prototype remain unverified. Before activation, require a separately authorized, isolated Preview test in the intended region that measures deadline misses, retained work completion, eviction recovery, rejected counts and verified receipts. Decide whether pre-commit loss is acceptable before choosing between best effort and a durable acceptance boundary. The production gate returned no archive with a test URL and opt-in flag when the runtime marker was `production`. No Production configuration was changed.

| Check | Result |
| --- | --- |
| Unit tests | 353 passed across 28 files, including 22 archive and outbox tests. |
| TypeScript | Passed with `tsc --noEmit --incremental false`. |
| ESLint | Passed. |
| Local production build | Passed on Next.js 15.5.28. |
| Chromium | 100 passed against the local production build after installing the matching Playwright headless binary in the isolated test directory. The initial attempt stopped at browser launch because the required executable was missing. |

[HTTPS matrix and raw timings](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6h/https-results.json>) · [Transport probes](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6h/transport-probes.json>) · [Local route with archive](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6h/route-on.json>) · [Archive-disabled route control](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6h/route-off.json>) · [HTTPS process recovery](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6h/https-process-results.json>) · [Hosted inspection](<C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-6h/deployment-observation.json>)
