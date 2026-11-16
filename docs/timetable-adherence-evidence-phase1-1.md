# Phase 1.1 — Redis integration and persistence validation

Date: **8 November 2026, Asia/Kuala_Lumpur**. Review baseline: `235f7cb67d631a17df86bfc23f70de93dc0fff5d` plus the reviewed local Phase 1 draft.

## Decision

**Validation completed; do not enable production persistence yet.** Real managed Redis successfully executes the adapter's Lua writes, stores original GPS evidence, expires keys and restores classifications in a controlled restart fixture. Fleet-scale recovery is not reliable with the existing connection deadlines on the tested connection: the final replay returns **49 / 3,157**, compared with **130 / 3,157** offline. An earlier real run reached 130, but also recorded transport failures. Both observations are retained rather than selecting only the successful count.

The application safely continues without Redis. All **2,391 vehicle-progress results** are unchanged, and there are no extra classifications relative to the offline reference. Missing durable evidence reduces availability instead of loosening classification requirements.

No GTFS matching, ±120-second boundary, GPS quality rule, ETA calculation, railway estimation or passenger terminology was modified. Runtime `lib/` and `app/` hashes match the Phase 1 verification manifest. No commit, push, deployment, Vercel project/domain/configuration change or paid service purchase occurred.

## Redis configuration and architecture

No existing Redis endpoint, token, environment file or Redis connector was available. A dedicated **temporary managed Upstash Redis database** was created through its official free experimentation endpoint. The provider lists expiry as **11 November 2026**. It is an isolated validation resource, not a long-term production database or a database linked to the Vercel project. [Upstash documents this temporary service and its REST protocol](https://upstash.com/docs/redis/features/restapi).

Credentials are held only in Git-ignored local files, `.env.phase1-1.local` and the private provisioning response `.env.phase1-1-provision.local`. Neither is imported automatically by the ordinary Next.js production build. The standalone validation process explicitly loads its environment file. No credential, private console link or metrics URL is in this report, the script or public result JSON.

The adapter consumes:

```dotenv
TRANSIT_EVIDENCE_REDIS_REST_URL=<server-only HTTPS endpoint>
TRANSIT_EVIDENCE_REDIS_REST_TOKEN=<server-only token>
TRANSIT_EVIDENCE_RETENTION_MINUTES=60
```

An additional `TRANSIT_VALIDATION_METRICS_URL` is used only by the validation script. It is not an application requirement. The existing [`.env.example`](../.env.example) remains unchanged.

The actual application path is unchanged: `ProcessedBusJourneys.processWithPersistence` hydrates historical passage evidence, executes the original GTFS/GPS processing and awaits bounded persistence. The backend uses HTTPS POST, batched MGET and pipelines of the existing per-key EVAL script. Actual server-side revision checks, monotonic checkpoints and PEXPIREAT were exercised; the test backend is not used for these Redis operations. Pipeline execution is not globally transactional; each Lua key update is atomic. [Upstash EVAL reference](https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval).

The Next.js Node route architecture is compatible with external HTTPS Redis and does not require a TCP connection pool or local persistent filesystem. Production build and local production-browser regressions passed. Vercel documents [external Redis integration](https://vercel.com/docs/redis) and [supported Node runtimes](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). **An actual Vercel invocation with Redis configured was not tested**, because deployment and production configuration changes are outside this task. Local testing does not establish Vercel-region latency or hosting reliability.

## Reproducible validation

The opt-in runner is [`scripts/validate-redis-evidence.cjs`](../scripts/validate-redis-evidence.cjs). It uses existing TypeScript and fixture dependencies, not a new Redis package. Supply a fresh, dedicated database; it refuses a nonempty initial database and never calls FLUSHDB. Cleanup deletes only the test's recorded evidence keys.

```powershell
node scripts/validate-redis-evidence.cjs --input <frozen-audit-capture-directory> --output <private-artifact-directory>
```

The runner creates an initial OS process for rounds 0–2, waits for it to exit, and starts a new OS process for rounds 3–6. The second process has fresh module memory, progress history, processor, HTTP client and persistence cache. Only the external Redis instance survives. This is stronger than clearing one JavaScript Map.

On a fleet equivalence failure, the script writes the failure report and exits nonzero. Existing saved replay files can also be analyzed with the same command plus `--analyze`; this does not replace observations or rerun the classifier with different rules. Small-fixture assertions, full vehicle results and operational failures are recorded separately.

Aggregate, credential-free evidence: [`integration-results.json`](timetable-adherence-evidence-phase1-1/integration-results.json). Larger replay fingerprints and browser results remain under the private local artifact directory:

`C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-1-2026-11-08/`

## Clock handling for the archived replay

The input is exactly the Phase 1 audit capture: seven rounds from Rapid KL Bus, MRT Feeder and Rapid Penang, 2,391 observations and the same frozen official GTFS archives. No GPS observation, coordinate, vehicle identifier, measurement timestamp, feed publication timestamp, server receipt timestamp or timetable was shifted to today's test execution time.

Redis evaluates absolute expiry against its real server clock, whereas this archived replay evaluates freshness at each original capture time. Sending the original historical absolute expiry unmodified after its retention window would correctly delete a key immediately. Therefore **the replay-only HTTP test wrapper translates only EVAL's expiry argument between those two clock domains**. The production adapter and Lua script remain unchanged; the JSON evidence retains every original timestamp. This is a controlled historical replay, not a claim that old observations are LIVE today.

A separate fresh-coordinate fixture exercises native server expiry **without this translation**, using the actual application retention setting. Stale-observation tests separately confirm that old input does not generate current classifications. No 60-minute wall-clock soak was performed.

## Actual persistence results

| Requirement | Real Redis result |
| --- | --- |
| Successful observation writes | Passed in the controlled fixture; five original fixes stored |
| Retrieval after processing restart | Passed; a new persistence/processor instance loads original pairs |
| Original measurement timestamps | Passed; exact millisecond values and original coordinates verified |
| Separate publication/receipt clocks | Passed; independently verified against fixture measurement +1s / +2s |
| Duplicate and out-of-order fixes | Passed; identical stored document, no append, no TTL extension or checkpoint rewind |
| Native expiry | Passed; one-minute retention with an already 55-second-old valid fix; measured remaining TTL 3,500ms, then GET null and PTTL -2 |
| Invalid data and rejected jumps | Passed; (0,0), invalid ranges, missing/invalid/stale/future clocks and an implausible jump not added |
| Vehicle isolation | Passed; different IDs retain separate coordinates/history |
| Concurrent processing | Passed controlled race; one observation, consistent checkpoint, revision conflict handled without duplicate evidence |
| Unavailable Redis safety | Passed; actual HTTP authentication failure and forced real-request timeout do not crash processing |
| Recovery after failure | Passed controlled fixture; restoring the working transport returns READY and persists a new valid observation |
| Fleet recovery equivalence | **Failed in the final repeat** because the storage operations repeatedly timed out |

The restart fixture first returns APPROXIMATE progress and no classifications, then restores three original valid classifications only after fresh local movement re-establishes reliable current progress. Raw persisted GPS fixes are not replayed to manufacture movement, speed or crossings.

The timeout test intentionally uses a one-millisecond deadline against the real endpoint. Authentication failure is injected using a deliberately invalid token for that request; the managed database is not shut down. These exercise application failure paths, not a provider disaster-recovery or host-crash experiment. Redis may apply a write even if the client times out before acknowledgment; cleanup includes those test keys and classification admission does not depend on assuming a timeout means no server write occurred.

## Classification comparison

E is the identical set of current-run GPS-passed occurrences with exact scheduled departures, including stops without passage evidence. Each final occurrence is counted once. The previous original-baseline result is retained, and rerunning the unchanged local engine without persistence again reproduces 49 / 3,157.

| Scenario | Classified / eligible | Coverage | Interpretation |
| --- | ---: | ---: | --- |
| Original baseline / no-persistence restart reference | 49 / 3,157 | 1.55% | Reproduced |
| Phase 1 offline persistence reference | 130 / 3,157 | 4.12% | Reproduced with test backend |
| First actual Redis trial | 130 / 3,157 | 4.12% | Final count reached; operational timeouts occurred; complete per-row verification was interrupted during diagnostic collection |
| Final actual Redis repeat | **49 / 3,157** | **1.55%** | **81 expected recoveries unavailable** |

The final repeat shows **2,391 / 2,391 identical current vehicle-progress results**, including matching, delay, coordinates, route distance and stop progression. Eligible stop keys match the reference in every round. No duplicate eligible keys or duplicate classified stop keys were found. There are **zero unexpected classifications** in any round; the differences are missing classifications.

| Round | Offline classified | Actual Redis classified | Missing | Unexpected |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 | 0 |
| 2 | 40 | 40 | 0 | 0 |
| 3, first round after OS restart | 0 | 0 | 0 | 0 |
| 4 | 61 | 0 | 61 | 0 |
| 5 | 80 | 16 | 64 | 0 |
| 6 | 130 | 49 | 81 | 0 |

Across rounds 4–6 there are 206 differing snapshot appearances; this is **not** 206 distinct final stops. The final deficit is 81. The ±120-second constant, 120-second GPS age, 60-second maximum passage-pair interval and 40m minimum movement were asserted unchanged. Old, insufficient and non-exact evidence remains ineligible. No ground-truth arrival records were introduced, so this is not an arrival/departure or ETA accuracy claim.

Final eligible-stop unavailable reasons reconcile to E − C:

| Primary reason | Offline persistence | Final actual Redis |
| --- | ---: | ---: |
| NO_GPS_HISTORY | 3,022 | 3,105 |
| INSUFFICIENT_EVIDENCE | 2 | 0 |
| GPS_GAP_TOO_LARGE | 1 | 1 |
| PASSAGE_TIME_UNAVAILABLE | 1 | 1 |
| GPS_OUTLIER_REJECTED | 1 | 1 |
| **Unavailable total** | **3,027** | **3,108** |

No diagnostic category was used to make an unavailable stop eligible or to relax evidence requirements.

## Operational findings

The existing application settings are 1.8 seconds per HTTP request, 2.5 seconds for hydration, 2.5 seconds for write/conflict recovery, ten commands/keys per batch and three concurrent requests. CAS conflicts have one bounded merge retry. There is no general transport retry in the application adapter. These settings were not changed.

| Final repeat transport measure | Before restart | After restart |
| --- | ---: | ---: |
| Started HTTP requests | 99 | 108 |
| Recorded timeouts | 48 | 60 |
| Recorded HTTP 200 responses | 49 | 46 |
| Median recorded request duration | 1,261ms | 1,544ms |
| 95th percentile recorded duration | 1,910ms | 1,964ms |
| Storage-operation failures | 18 | 24 |
| Confirmed loaded documents in processor | 0 | 0 |
| Confirmed successful writes in processor | 0 | 0 |
| Final processor storage state | DEGRADED | DEGRADED |

At least **108 of 207 started requests recorded a timeout**. Started requests need not equal the sum of completed counters: some were still being cancelled when the deliberately terminated worker exited. A failed aggregate batch can also leave individual remote writes applied without an acknowledgment, explaining the stored documents below despite zero confirmed processor writes. The Lua revision/checkpoint checks protect individual documents; they cannot guarantee successful evidence delivery over an unavailable connection.

The first trial had 0 recorded HTTP failures before restart and 14 after restart, with eight storage-operation failures after restart; it still reached the expected final count. The final repeat demonstrates why that first count alone is insufficient as an acceptance criterion.

**Inference:** observed request latency intersects the current HTTP/operation deadlines, and fleet batches require multiple request waves. For example, four waves near 1.2 seconds cannot fit a 2.5-second operation budget. This is a plausible contributor to failed hydration and persistence. Region, network, provider load and per-request timing were not independently controlled, so no specific provider outage, quota violation or sole root cause is asserted. No non-200 provider quota response was recorded in the final replay.

Longer diagnostic read timeouts and one idempotent retry were added **only to the validation script's memory/cleanup probes** after an initial diagnostic timeout. Application transport behaviour is unchanged. Failed trials are preserved in the aggregate evidence.

The application remains safe when Redis is absent or unavailable: it calculates current progress and adherence from existing in-memory valid evidence and returns degraded storage diagnostics. **Safety is not durability**: observations/pairs whose writes fail cannot be guaranteed after another restart. This connection is therefore unsuitable for enabling fleet persistence without further operational work.

## Memory, retention and cleanup

Actual MEMORY USAGE commands are supported by the tested service. Values below are the sum of per-key reported bytes, not total server RAM or a provider billing projection.

| Measurement | Documents | Observation rows | Passage pairs | JSON bytes | Sum of MEMORY USAGE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Controlled fixtures | 7 | 14 | 5 | 14,696 | 14,920 |
| Final repeat before restart | 155 | 155 | 8 | 268,015 | 272,975 |
| Final repeat after restart | 190 | 190 | 10 | 331,723 | 337,803 |

The small final footprint reflects **incomplete persistence**, not a storage optimization. It cannot replace Phase 1's healthy simulated volume estimate of roughly 1.1–1.2 MB for the short capture. Provider aggregate metrics lagged direct reads: one sample still reported ten keys / 12,100 bytes while direct MGET and MEMORY USAGE found 190 documents / 337,803 bytes. Capacity conclusions therefore use direct per-key measurements; provider dashboard counters are not assumed instantaneous.

Absolute expiry and duplicate behaviour were verified on real storage. [PEXPIREAT uses an absolute Unix-millisecond deadline](https://redis.io/docs/latest/commands/pexpireat/). Retention pruning remains based on original measurements; pair retention requires both source timestamps in the window. Default retention is 60 minutes, and the separate native expiry test used the supported one-minute setting rather than waiting an hour. A full 60-minute live soak, steady-state memory/traffic study and long-term restart campaign remain untested.

After verification and owned-key cleanup, **DBSIZE = 0**. No production data was used or deleted. Only public captured official GPS data and explicitly synthetic fixtures entered this temporary database. No additional production data collection was enabled.

## Environment isolation and Vercel readiness

This test is physically isolated in its own temporary database. Production and preview credentials were not read, created or modified. No Vercel environment variable was set.

The application key prefix is currently `transitscope:evidence:v1:` and does **not** include a deployment environment. Source/vehicle/run/static-version isolation exists, but using the same Redis credentials for production and preview would share evidence. Use separate managed databases/credentials for each environment unless a future reviewed change explicitly introduces an environment namespace. Do not attach the temporary validation database to production.

A production-ready decision requires a long-lived managed instance, deliberate region placement near the Vercel runtime, measured fleet-sized batches and a successful repeated restart/60-minute retention test under the chosen configuration. Connection deadlines, batching and failure completion behaviour warrant a separate reviewed change; they were not tuned in this validation-only task. No change to GTFS matching or evidence thresholds is needed to explain the observed availability deficit.

## Full regression results and changed files

| Check | Result |
| --- | --- |
| Real Redis integration groups | **10 passed; 1 failed** — fleet classification equivalence |
| Unit suite: `pnpm test` | **317 passed**, 26 files |
| Browser suite against local production build | **99 passed**, no unexpected/skipped/flaky results; 38.5s |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, including final validation script |
| `pnpm build` | Passed, Next.js 15.5.28 |
| Phase 1 runtime hash comparison | No `lib/` or `app/` changes |
| Git/deployment configuration comparison | HEAD unchanged; no package/lock/deployment configuration changes |
| Secret-file exclusion | Both private environment files are Git-ignored |

Green unit/browser checks do not override the failed real fleet persistence check. They exercise existing regressions and controlled fixtures, not this connection's operational reliability.

Only the standalone validation script, this report and its aggregate JSON are new Phase 1.1 review deliverables. Existing uncommitted Phase 1 files, the prior audit and generated TypeScript build information were preserved. Credentials and large private replay artifacts are excluded from review files.

**Stop state:** validation/report only. Production persistence remains unconfigured. No Phase 2 work, algorithm changes, commit, push or deployment was performed.
