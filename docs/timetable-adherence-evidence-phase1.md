# Phase 1: timetable adherence evidence reliability

Review date: 8 November 2026 (Asia/Kuala_Lumpur). Baseline: `235f7cb67d631a17df86bfc23f70de93dc0fff5d`.

**Status: implemented locally for review; not committed, deployed or connected to a database.** The owner confirmed that Redis is not configured and requested a configurable implementation. No external resource was created. Repository, Vercel project, domain, deployment configuration and dependencies are unchanged.

## Implementation and preserved behaviour

The existing official GTFS-Realtime → validated observations → exact GTFS run → official shape projection → GPS passage pair → timetable assessment pipeline remains in place. Persistence surrounds background fleet processing; opening a vehicle panel is unnecessary.

The ±120-second classification boundary, exact scheduled reference requirement, passage-pair admission limits, current GPS freshness, stop progression, ETA calculation and railway position engine are unchanged. Frequency-derived and interpolated references remain ineligible for exact adherence classification. LIVE / ESTIMATED / SCHEDULED labels and ordinary passenger wording are unchanged. No animation coordinates or external map-matching services supply evidence.

Every unavailable `PASSED` stop assessment now has one `diagnostic.primary`, optional secondary details and three distinct clocks. These fields are available in `/api/transit` under `busJourneys[].journey.stops[].adherence.diagnostic` and in the existing expandable technical information. They are absent from ordinary passenger-facing text. The API also returns credential-free `busEvidence` health/counters; these are process-local operational counters, not durable fleet totals.

Reasons reuse the audit categories: `NO_GPS_HISTORY`, `GPS_GAP_TOO_LARGE`, `GPS_STALE`, `INVALID_GPS_TIMESTAMP`, `GPS_OUTLIER_REJECTED`, `TRIP_MISMATCH`, `STOP_SEQUENCE_MISMATCH`, `NO_SCHEDULED_TIME`, `PASSAGE_TIME_UNAVAILABLE`, `INSUFFICIENT_EVIDENCE`, `OTHER`. Only the primary is counted in distributions. Actual rejected brackets can explain a gap or inadequate movement. Unobserved causes remain unresolved; a recorded global continuity reset does not prove why an earlier stop lacks history.

Clocks are stored independently:

| Clock | Source and meaning |
| --- | --- |
| Measurement | Original vehicle-position timestamp; exclusively controls movement age and passage timing |
| Feed publication | GTFS-Realtime header timestamp; nullable metadata, never a measurement substitute |
| Server receipt | Original decoded observation's `lastUpdatedAt`; retained with that observation |
| Validation | Additional persistence metadata recording when the accepted fix was checked |

## Architecture and storage choice

The deployed architecture uses Next.js 15 Node route handlers, module-local realtime/static caches and `VehicleProgressHistory`. `/api/transit` retains its existing 60-second maximum duration. No database configuration was found. Module memory cannot be relied on across cold starts or different instances; a runtime local file would not provide shared durable evidence.

The implementation therefore adds an **optional external Redis REST backend**, compatible with the Upstash command protocol, using native `fetch` and existing Zod. It creates no database and adds no package. Vercel documents external Redis integrations through its [Redis guidance](https://vercel.com/docs/redis); the transport follows the provider's [REST API and pipeline protocol](https://upstash.com/docs/redis/features/restapi).

Each scope is keyed by source, original vehicle ID, exact run/service date, trip, route, shape, projection/passage context and a hash of the relevant static timetable and geometry. Direction is part of the existing trip/progress context. Original identifiers remain inside the private stored document; the Redis key uses SHA-256. A changed run or static definition cannot inherit another scope's evidence.

A document contains accepted raw matched fixes with original coordinates/timestamps, and original validated passage pairs plus diagnostic metadata. It does **not** restore raw GPS as current movement, a previous motion origin, speed history, ETA or animation state. After a restart, fresh local observations must independently establish sufficiently reliable current progress. Only then can an original stored passage pair support an already-passed stop on the same exact run. This deliberately avoids creating a new crossing across a known rejected interval.

Writes use revision-based compare-and-set and a monotonic checkpoint in a per-key [Redis Lua script](https://redis.io/docs/latest/commands/eval/), with one bounded conflict/merge retry. Multiple EVAL commands are transported through a pipeline; the pipeline is **not** a transaction across vehicles. Each key update and absolute expiry are atomic in its script. Duplicate fixes do not advance the measurement-based expiry. Conflicting same-time samples cannot overwrite the accepted earlier version. Out-of-order data cannot rewind the checkpoint.

Reads/writes use batches of ten and at most three concurrent requests per backend operation. HTTP requests have a 1.8-second timeout; hydration and write/retry each have a 2.5-second deadline. Freshness is rechecked after reading storage. Errors, corrupt documents and exhausted conflicts are contained and reported as degraded storage; ordinary in-memory processing continues. Writes are awaited rather than left running after a serverless response.

## Configuration and retention

See [`.env.example`](../.env.example). Server-only settings are:

```dotenv
TRANSIT_EVIDENCE_REDIS_REST_URL=
TRANSIT_EVIDENCE_REDIS_REST_TOKEN=
TRANSIT_EVIDENCE_RETENTION_MINUTES=60
```

Leave both credentials empty to retain the existing in-memory behaviour with `DISABLED` storage status. Incomplete/invalid configuration yields `DEGRADED` without exposing credentials. A valid HTTPS REST endpoint and token enable the adapter; retention accepts integer minutes from 1 to 120, default 60. Never prefix credentials with `NEXT_PUBLIC_`. Local secret environment files are ignored by Git.

Retention concerns historical evidence, not current GPS eligibility: the existing 120-second live freshness check remains. Observation rows expire by original measurement time. A passage is retained only while both source timestamps are inside the window. A key expires at its latest accepted measurement plus retention, using absolute `PEXPIREAT`; reads and repeated old fixes do not refresh that deadline. Expired rows are also trimmed during reads/writes. Existing in-memory passage retention was not redesigned by this change.

Invalid coordinates, absent/invalid/stale/future measurement times, rejected jumps, poor shape matches, low-quality accuracy and visually clamped fixes are not persisted. Only uniquely matched runs with validated official geometry can produce a persistence scope. This is deliberately narrower than archiving every raw realtime packet.

## Comparable coverage experiment

The comparison reuses the coverage audit's frozen official static archives and seven direct observation rounds for Rapid KL Bus, MRT Feeder and Rapid Penang: **2,391 rows, 365 source-scoped vehicle identities**, approximately three minutes. All variants use identical input, clocks and processing order. Restart variants reset processing/history before zero-based round 3 while retaining the test external store where enabled. No current upstream data was substituted.

The final comparison fleet has 330 buses, 250 matched runs. As in the audit, E includes GPS-passed stops on the current run with an exact scheduled departure; missing passage evidence does not remove a stop from E. C counts valid EARLY / ON_TIME / DELAYED results. The restart variants have an identical eligible stop-key set, not just equal totals.

| Variant | Eligible E | Classified C | C / E |
| --- | ---: | ---: | ---: |
| Baseline, continuous | 3,483 | 195 | 5.60% |
| Phase 1, storage disabled, continuous | 3,483 | 195 | 5.60% |
| Phase 1, simulated persistence, continuous | 3,483 | 195 | 5.60% |
| Baseline, controlled restart | 3,157 | 49 | 1.55% |
| Phase 1, simulated persistence, same restart | 3,157 | 130 | 4.12% |

The controlled restart recovers **81 additional classifications (+2.57 percentage points)**. All 2,391 compared current-GPS progress results remain identical between the two restart variants, including stop states; persistence does not restore old movement to inflate the denominator. Against the continuous run's fixed set of 3,483 eligible occurrences, restart coverage is 49/3,483 (1.41%) versus 130/3,483 (3.73%); 326 occurrences lack re-established passed progress in both restart variants.

Independent baseline-versus-Phase-1-disabled comparison found **2,391/2,391 identical core results**: trip/run match, progress, delay, scheduled stop data/status, adherence result/history and tracking motion/passage fields. New diagnostic/clock metadata was intentionally excluded from this equivalence comparison.

The earlier audit's **604/3,519 (17.16%)** was a warm production server with history predating this short capture. It is not comparable to a replay starting with empty history. This experiment neither replaces that baseline nor demonstrates a production coverage increase. It does not establish that the audit's 2,710 missing-history cases were lost to restarts or would all be recoverable.

Aggregate results: [`timetable-adherence-evidence-phase1/coverage-comparison.json`](timetable-adherence-evidence-phase1/coverage-comparison.json). The offline runner is saved with the local capture artifacts at `C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-2026-11-08/compare.cjs`; it loads an archived baseline library separately from the draft and makes no network calls.

## Primary reason distributions

Only unavailable stops within E are counted below. Non-exact schedules are tracked separately as `NO_SCHEDULED_TIME` and stay outside E; there are 282 such passed occurrences in each final replay. Baseline reasons are assigned by the audit-compatible offline adapter because baseline code did not emit structured diagnostics.

| Continuous window reason | Baseline | Phase 1 disabled | Phase 1 persistence |
| --- | ---: | ---: | ---: |
| NO_GPS_HISTORY | 3,279 | 3,279 | 3,279 |
| INSUFFICIENT_EVIDENCE | 0 | 3 | 3 |
| GPS_GAP_TOO_LARGE | 0 | 1 | 1 |
| GPS_OUTLIER_REJECTED | 0 | 3 | 3 |
| PASSAGE_TIME_UNAVAILABLE | 9 | 2 | 2 |
| **Unavailable total** | **3,288** | **3,288** | **3,288** |

The seven narrower explanations improve observability, not classification counts.

| Same controlled restart reason | Baseline | Phase 1 persistence |
| --- | ---: | ---: |
| NO_GPS_HISTORY | 3,105 | 3,022 |
| INSUFFICIENT_EVIDENCE | 0 | 2 |
| GPS_GAP_TOO_LARGE | 0 | 1 |
| GPS_OUTLIER_REJECTED | 0 | 1 |
| PASSAGE_TIME_UNAVAILABLE | 3 | 1 |
| **Unavailable total** | **3,108** | **3,027** |

All other eligible-stop primary categories have zero occurrences in these final snapshots. Each column reconciles to E minus C, without secondary-reason double counting. The historical 192 unresolved cases cannot be retrospectively assigned a narrower cause from this new replay.

## Storage volume, cleanup and performance

These are serialized logical payloads from the test backend, not provider memory, billing, Redis request counts or real network latency.

| Final replay measure | Continuous persistence | Restart persistence |
| --- | ---: | ---: |
| Scope documents | 257 | 256 |
| Accepted observation rows | 1,291 | 1,274 |
| Retained passage records | 337 | 260 |
| Stored JSON bytes | 1,202,429 | 1,113,111 |
| Observation-array bytes | 511,628 | 505,090 |
| Largest document bytes | 10,195 | 9,240 |
| Successful document writes | 1,291 | 1,274 |
| Cumulative written document bytes | 4,376,231 | 4,046,328 |
| Keys remaining after advancing past maximum expiry | 0 | 0 |

At 350 active buses and one accepted fix every 30 seconds, 60 minutes provides at most 42,000 observation slots before deduplication. At the sample's roughly 396 bytes per serialized observation, that is approximately **16.6 MB of observation payload**, plus passage/context data, Redis overhead, multiple runs/versions and provider replication. Actual traffic and active fleet vary. Schema bounds are 10,000 observations and 2,000 passages per scope; the instance cache is trimmed around 1,000 scopes and expires old entries. Route/version churn and larger scopes must be measured in live service.

Each accepted new fix currently rewrites its bounded scope document. Wire usage therefore grows with the retained document and exceeds stored footprint; the short sample's 4.38 MB cumulative writes cannot be extrapolated linearly as a mature 60-minute operating cost. Provider command accounting, payload limits, region and plan must be evaluated before enabling. No free-tier or dollar-cost claim is made.

Local mean processing time per operator snapshot was 117.3 ms baseline-continuous, 119.3 ms with storage disabled, 188.4 ms with simulated persistence, and 188.6 ms with restart persistence. These single-machine replay timings include validation/serialization and a zero-network test backend; they are not production latency measurements.

## Tests and engineering review

| Check | Result |
| --- | --- |
| `pnpm test` | **317 passed**, 26 files (283 existing + 34 new cases) |
| Browser suite against production build, Chromium, 2 workers | **99 passed** (97 existing + 2 new cases), 41.4 seconds |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `pnpm build` | Passed, Next.js 15.5.28 |
| Offline core equivalence | 2,391 / 2,391 rows unchanged with persistence disabled |
| Offline restart GPS progress equivalence | 2,391 / 2,391 rows unchanged |

New tests cover restart recovery requiring fresh current progress, retention/expiry, original identifiers and clocks, duplicates/out-of-order fixes, bad coordinates/timestamps, stale data, rejected jumps/shape matches/clamps, outages and recovery, concurrent revision conflicts/merge, corrupt evidence, identity/static-version separation, non-exact references, post-I/O freshness, no replay across rejected intervals, unique primary reasons and credential-free bounded REST transport. Browser cases verify background processing before any panel request, restored classifications, technical-only diagnostics and mobile/desktop layout. Existing full regressions cover timetable adherence boundaries, cross-midnight services, GPS progression, ETA quality/independence, routes, railways and the passenger interface.

**Real authenticated Redis REST calls and Lua execution have not been exercised**, because no database is configured. Transport tests mock HTTP; restart/capacity experiments use an independently implemented test-only revision/expiry backend. This simulator is never a production persistence fallback. Before activating storage, validate the endpoint's EVAL/PEXPIREAT support, access policy, concurrent writes, absolute expiry, latency and provider payload/quota limits against an actual database.

## Modified files

| Files | Purpose |
| --- | --- |
| `lib/bus-evidence.ts` | Validated scope/documents, retention, passage recovery, revision merge and fault containment |
| `lib/redis-evidence-store.ts` | Optional REST configuration, bounded transport and per-key Lua CAS/expiry |
| `lib/adherence-diagnostics.ts` | One-primary reason assignment and rejection explanations |
| `lib/vehicle-progress.ts`, `lib/timetable-adherence.ts` | Observe existing evidence decisions and attach internal diagnostics |
| `lib/processed-bus-journeys.ts`, `lib/official-transit.ts` | Background hydration/processing/persistence and safe storage status |
| `lib/bus-journey.ts`, `lib/transit-data.ts`, `app/api/transit/route.ts` | Separate source clocks and API metadata |
| `.env.example`, `.gitignore` | Optional server-only configuration and local secret exclusion |
| `tests/bus-evidence.test.ts`, `tests/adherence-diagnostics.test.ts`, `tests/redis-evidence-store.test.ts`, `tests/fixtures/evidence-store.ts` | Persistence, diagnostic and transport tests/simulator |
| `e2e/evidence-reliability.spec.ts` | Background recovery and passenger/technical interface regressions |
| This report and its aggregate comparison JSON | Review evidence |

The prior untracked coverage audit/artifacts are preserved. The pre-existing generated `tsconfig.tsbuildinfo` change is not an implementation deliverable. No package/lockfile, railway engine, deployment setting or UI component was modified.

## Remaining limitations and review decision

- With credentials absent, historical persistence is **disabled**; this draft alone cannot improve live restart recovery.
- Request-driven collection remains request-driven. No dashboard traffic means no new collection; a durable store cannot recreate observations never received or lost before a failed write.
- Recovery requires the same validated run/static version and independently fresh current progress. Missing historical crossings, long GPS gaps, stale data and non-exact schedules remain unclassified.
- Invalid/corrupt remote keys are rejected; a schema-corrupt key can remain unusable until its existing TTL expires or an operator removes it. Storage failures preserve in-memory functionality but cannot guarantee durability.
- The comparison is a short, controlled replay rather than a 60-minute live soak, fleet-wide production measurement or arrival-ground-truth validation. No claim of actual arrival/departure or ETA accuracy is made.
- Full-document writes and large batches need provider-specific capacity/cost testing before activation. A future incremental representation could reduce rewrite volume without changing classification rules.

The local implementation is ready for code review. No commit, push, database provisioning or deployment has been performed.
