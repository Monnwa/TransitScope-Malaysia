# Phase 1.6K — Preview execution and evidence accounting validation

## Execution outcome

**Preview readiness could not be established. Zero of the ten hosted lifecycle scenarios were executed.** The only Preview deployment identified in the available records ran the Phase 1.3 Redis implementation during Phase 1.4. The PostgreSQL archive implementation is present in the local working draft and absent from the checked-in revision. No existing Preview could be verified as running that draft with an isolated PostgreSQL database. This report records the preflight findings and marks the hosted outcomes **UNVERIFIED**. [Phase 1.4 Preview report](timetable-adherence-evidence-phase1-4.md) · [Phase 1.6J validation plan](timetable-adherence-evidence-phase1-6j.md)

Keep Production archival disabled. No deployment, database connection, fixture traffic, fault injection, configuration change, commit or push occurred during this phase. The private Production flag and credential scope could not be independently reverified.

## Preview readiness and deployment details

| Check | Observation | Readiness |
| --- | --- | --- |
| Local source revision | Git HEAD was `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. `git ls-tree` showed no classification archive modules or database migrations at that revision, and the checked-in transit route does not wire the archive. The draft archive modules and migrations are in the working tree. A matching Git SHA alone would be insufficient to prove what a local-source deployment contains. | A deployed draft and its source manifest remain unverified. |
| Known hosted Preview | Retained Phase 1.4 deployment metadata identifies `dpl_BLUnMJPf2janeWvsDFiXnx48HURy` with target `preview`. Phase 1.4 records Node 26.x in `iad1` and deployment-only access to isolated Upstash Redis. Its implementation was a Phase 1.3 snapshot. The historical run recorded the same workspace HEAD, which does not identify that deployment's complete uploaded source tree. | Historical Preview evidence only. |
| Phase 1.6K Preview ID, deployed SHA and runtime | No compatible deployment ID, SHA or source manifest was available. The local draft declares `nodejs` and `maxDuration=60` for both routes. Effective hosted Node version, memory, region, invocation duration and concurrency settings were unavailable. | UNVERIFIED. |
| Vercel access | No project linkage, Vercel CLI session or Vercel credentials were found in the checked workspace and session locations. Computer Use stopped before the private dashboard could be inspected because it could not determine the active Windows browser URL with enough confidence. | Private deployment details, environment settings and runtime logs remain unverified. |
| Managed PostgreSQL and isolation | The prior Phase 1.6H managed HTTPS test used an isolated Neon database from the local harness. No current Preview database binding, test schema or independently scoped readback credential was available for verification. The named historical workspace environment files covered Redis and Phase 1.4 Preview access. | Unable to prove that hosted fixture data would stay outside Production. |
| Production archival gate | The draft returns no archive when `VERCEL_ENV=production` and requires a nonblank `TRANSIT_CLASSIFICATION_DATABASE_URL` in other environments. `TRANSIT_CLASSIFICATION_DEFER_ADMISSION` selects admission mode and is separate from the database URL gate. Prior local verification exercised the explicit Production marker. Current hosted flag scope, database URL absence and marker exposure were not inspected. | Local guard verified by prior tests. Hosted configuration UNVERIFIED. |
| Cleanup | Phase 1.6J defines cleanup by fixture IDs after writes and leases settle. A Preview datastore, authorized cleanup path and scoped fixture cohort were not verified. | Plan available. Operational readiness UNVERIFIED. |

The readiness gate failed before any archive-capable HTTPS request. The existing Production endpoint was excluded from test traffic. [Phase 1.4 report](timetable-adherence-evidence-phase1-4.md) · [Phase 1.6H managed verification](timetable-adherence-evidence-phase1-6h.md) · [Transit route](../app/api/transit/route.ts) · [Bus journey route](../app/api/bus-journey/route.ts) · [Archive configuration guard](../lib/classification-evidence-store.ts) · [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)

## Hosted failure and recovery matrix

All rows below are **UNVERIFIED in Vercel Preview**. The prior controls explain what is already known about the application and managed database. They add no hosted passes to this phase.

| Phase 1.6J scenario | Phase 1.6K execution and hosted result | Prior evidence and remaining hosted gap |
| --- | --- | --- |
| Normal response completion | Unexecuted. UNVERIFIED. | Phase 1.6H exercised the local route and verified three distinct managed archive rows and matching journey outputs. Hosted response and continuation timing remain unobserved. |
| Slow PostgreSQL response | Unexecuted. UNVERIFIED. | A 2.2-second managed SQL trigger forced a timeout in the local HTTPS harness. Independent SQL found no intent after that attempt and a same-ID retry succeeded. Target-region latency and post-response completion remain unobserved. |
| Lost acknowledgement | Unexecuted. UNVERIFIED. | The prior harness discarded a real successful managed HTTPS response and reconciled by receipt. Preview needs independent commit readback and a correlated missing acknowledgement for the same ID. |
| PostgreSQL outage and recovery | Unexecuted. UNVERIFIED. | The prior HTTPS harness blocked application transport while the database remained available to its observer. Hosted path interruption, bounded retry and recovery under Preview load remain unobserved. A provider-wide outage was outside the prior test. |
| Invocation timeout | Unexecuted. UNVERIFIED. | Requires a provider-observed timeout for a known invocation and staged or committed cohort. Browser abort and the application's database timeouts cannot establish this event. |
| Instance eviction | Unexecuted. UNVERIFIED. | Requires provider evidence tied to the interrupted instance and a fresh worker. Local process termination and the Phase 1.4 Redis restart or OOM observations do not establish this scenario. |
| Process termination before dispatch | Unexecuted. UNVERIFIED. | A prior local child was killed with staged evidence before managed HTTPS dispatch. The intent remained absent. Preview lacks an observed acceptance barrier and hosted termination evidence. |
| Process termination after commit | Unexecuted. UNVERIFIED. | The prior managed HTTPS test retained a `PENDING` intent when its local child exited before acknowledgement. The hosted commit and termination boundaries remain unobserved. |
| Fresh worker recovery | Unexecuted. UNVERIFIED. | A prior fresh local worker recovered the committed managed intent and verified its `PERSISTED` receipt. No fresh Preview process, lease handoff or hosted recovery time was observed. |
| Concurrent same-ID requests | Unexecuted. UNVERIFIED. | The prior managed tests verified stable IDs and idempotent delivery. No overlapping requests across distinct Preview instances were observed. |

Prior control sources and platform evidence requirements. [Phase 1.6H results](timetable-adherence-evidence-phase1-6h.md) · [Phase 1.6I verification matrix](timetable-adherence-evidence-phase1-6i.md#consolidated-verification-matrix) · [Vercel invocation timeout](https://vercel.com/docs/errors/function_invocation_timeout) · [Vercel runtime logs](https://vercel.com/docs/logs/runtime)

### Actual lifecycle evidence captured

The only deployment identifier recorded above belongs to the historical Redis Preview. Phase 1.6K captured no archive scenario request, deployment or invocation ID, no candidate ID, and no generation, staging, dispatch, commit, acknowledgement or recovery timestamp. No final receipt state was observed. No latency, coverage, archive-disabled journey parity or recovery duration was measured in Preview.

## Candidate accounting and observability

| Phase 1.6K metric | Hosted count | What the current implementation can establish |
| --- | --- | --- |
| Generated | N/A | `generatedAtMs` is in the original snapshot and uses the journey evaluation clock. The system has no independent inventory of every valid snapshot generated. Invalid attempts can have no candidate ID. |
| Accepted | N/A | `captured` increments after insertion into the process-local staging map. The same ID can enter staging on multiple instances. A process exit can erase this evidence. |
| Durably committed | N/A | Read-only PostgreSQL can prove a distinct intent exists for a known ID. Process-local `candidateOutcomes.committed` counts confirmation events, including existing IDs and reconciliations. |
| Explicitly rejected | N/A | Invalid, oversized and capacity failures have separate counters or warnings. A rejected attempt can later be accepted under the same ID. Aggregate events do not establish the final set of unique rejected candidates. |
| Pending | N/A | Staged and unknown-admission counters are local. SQL `PENDING` and `RETRYING` denote committed intents awaiting delivery and are counted separately from volatile pending. |
| Unreconciled | N/A | Unknown acknowledgements and expiry can be observed while the process is alive. Without an independent acceptance witness, an absent SQL row cannot resolve a candidate's fate. |

N/A means no eligible cohort was observed. The zero executed scenarios supply no candidate denominator. No unobserved ID was counted as committed and no unresolved ID was declared permanently lost. Neither a measured loss rate nor a bound against the Phase 1.6J policy scenarios can be calculated.

Even with a reachable Preview, the current instrumentation is insufficient for full lifecycle reconciliation. Vercel request and invocation IDs can anchor a trace when available. The existing aggregate logs do not tie each candidate to a staging, dispatch, acknowledgement or recovery event across instances. SQL provides durable state for a known ID. `enqueued_at_ms` comes from the application's enqueue call, and `settled_at_ms` comes from processing within the delivery transaction. Neither establishes the database commit instant. An independent readback can establish that commit occurred by the observation time. Use that bound unless provider telemetry can establish a more precise timestamp. A successful terminal receipt must also be joined to the archive row and matched to the original checksum. [Evidence snapshot](../lib/classification-evidence.ts) · [Archive store and counters](../lib/classification-evidence-store.ts) · [Outbox SQL](../database/classification-outbox.sql)

To reconcile a future cohort, the Phase 1.6J external manifest needs observed generation and staging events for each stable ID, correlated dispatch and acknowledgement events, independent SQL readback, and a declared settlement cutoff. Record gaps in the acceptance witness separately. The dashboard and Outbox were unchanged.

## Production readiness decisions

| Decision | Assessment |
| --- | --- |
| **A. Best-effort archival** | **Conditional architecture, review gate open.** Prior managed tests support post-commit recovery and idempotency. This phase supplied no Preview evidence for latency, loss budget or recovery under the target runtime. |
| **B. Strict durability** | **Does not meet the contract.** Acceptance occurs in volatile staging. The verified pre-dispatch loss in the earlier local control is a counterexample to survival of every accepted candidate. |
| **C. Vercel runtime recovery** | **UNVERIFIED.** No hosted archive continuation, timeout, eviction, or fresh-worker recovery was observed. |
| **D. Candidate loss accounting** | **UNVERIFIED and incomplete with current signals.** Durable rows can be reconciled for known IDs. The system does not supply a complete independent accepted-ID denominator or final state for every accepted candidate. |

**Recommendation: keep Production archival disabled.** Resume hosted validation only when an existing approved Preview can be identified with a matching source manifest, verified Preview-only PostgreSQL binding, read-only runtime logs and database evidence, and approved fixture cleanup. The Production environment marker and absent Production archive binding must be independently confirmed. A provider-observable timeout and eviction capability is needed to close those gates. Complete the candidate reconciliation and evaluate the agreed policy limits before a separate activation review. [Production activation prerequisites](timetable-adherence-evidence-phase1-6j.md#production-activation-prerequisites)
