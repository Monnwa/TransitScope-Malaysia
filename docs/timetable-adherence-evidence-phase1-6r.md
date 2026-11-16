# Phase 1.6R — Controlled Neon-bound Vercel Preview opt-in validation

The disabled baseline passed on the protected Neon-bound Preview. Both live requests returned HTTP 200 with all four official feeds healthy, and both Neon tables remained empty. Opt-in is pending because the deployed revision processes an entire source feed before selecting a vehicle and has no hosted replay entry point or per-candidate staging trace. The requested small cohort and its complete lifecycle cannot be isolated on this build.

## Preflight and Production isolation

| Check | Verified result |
| --- | --- |
| Vercel project and Preview | Project `prj_DqTjkYBkW3dmA0hEteczCHOQNVgE`, `loongmw2021-8669/transit-scope-malaysia`, linked to `Monnwa/TransitScope-Malaysia`. Deployment `dpl_EG9o19YJtDJmqLTvTwJERyiw9KCs` was Ready at the expected protected URL. |
| Source | The deployed SHA and remote feature ref both matched `d1f9c3ffa27008a0df7491e024d5679b780fa1a2` on `feature/postgres-outbox-preview`. Phase 1.6Q tested this runtime revision with local fixture and test files. It did not create a new application commit. |
| Environment | The writer URL and activation flag are scoped to `preview` and the exact feature branch. Readback of the flag verified the literal `false`. Deferred Admission is off by default and has no override. |
| Database | Disposable Neon project `divine-lake-98736672`, branch `br-orange-feather-bdfm1xng`, endpoint `ep-cold-base-bd1m7gdy`, database `neondb`, PostgreSQL `17.11`. It was reachable and had more than two days before its scheduled expiry on 13 November 2026 at 23:59:55 MYT. |
| Writer and observer | The isolated writer passed a read-only HTTPS check for the two versioned tables, required write privileges, and delivery function access. The separate observer connected with verified TLS and could read both tables. It lacked outbox mutation privileges and delivery function access. |
| Production readback | GitHub `master` remained at `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. Vercel still reported `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6` and `transit-scope-malaysia.vercel.app`. Before and after the baseline there were zero Production archive variables and zero automation bypass credentials. Protection remained `all_except_custom_domains`. |

[Vercel deployment](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/EG9o19YJtDJmqLTvTwJERyiw9KCs) · [Protected Preview](https://transit-scope-malaysia-foc6l6xk5-loongmw2021-8669.vercel.app) · [Phase 1.6Q parity report](timetable-adherence-evidence-phase1-6q.md) · [Vercel environment scope](https://vercel.com/docs/environment-variables)

## Disabled baseline

The signed-in browser exercised `/api/transit` on the bound Preview. The first browser navigation timed out while waiting, then the response loaded and Vercel confirmed HTTP 200. Both polls reported healthy Rapid Bus KL, MRT Feeder, KTMB and Rapid Bus Penang feeds. All timestamps below are Malaysia Time on 11 November 2026.

| Request and response | HTTP | KL / Feeder / KTMB / Penang | Records | Bus journeys | Classified stops in the response |
| --- | ---: | --- | ---: | ---: | ---: |
| `b7gc9-1794369470090-78db36ccea2f`, response 11:58:12.393 | 200 | 81 / 92 / 7 / 147 | 327 | 320 | 0 |
| `49g2k-1794369512073-694316d21111`, response 11:58:34.454 | 200 | 76 / 101 / 17 / 149 | 343 | 326 | 0 |

The second response contained 89 retained passages. The observer counted zero outbox rows and zero archived evidence rows at 11:56:19.098 before the polls and 11:59:17.611 after them. Vercel returned one runtime log entry in the query window and zero archive-related entries. The disabled initializer returns before creating the database client or archive object, which prevents staging and the post-response worker from running. The logs and row counts corroborate the disabled path. There is no independent hosted staging counter. [Archive activation guard](../lib/classification-evidence-store.ts:473) · [Transit handler](../app/api/transit/route.ts)

## Opt-in and candidate reconciliation

`/api/transit` passes the whole live bus fleet into journey processing. `/api/bus-journey` calls `getBusVehicle()`, which processes a complete source feed and filters the response afterward. The second baseline contained 326 bus journeys, with at least 76 bus records per source. Bounding the number of requests would still leave the contents of the test cohort under live feed control. The deployed code also has no input for the Phase 1.6Q fixture, retained crossing history or a fixed replay clock. [Feed processing and detail lookup](../lib/official-transit.ts:145) · [Captured replay test](../tests/journey-archive-parity.test.ts)

The archive generates evidence IDs during capture and stages records in memory. Its hosted messages report aggregate pending or rejection counts. An independent observer can query committed IDs and join terminal receipts to archived rows, but cannot reconstruct IDs staged or rejected before commit from the database. The current surfaces cannot reconcile the full eligible set or provide an identical-input hosted parity comparison. Preview activation therefore stayed false. [Capture and staging](../lib/classification-evidence-store.ts:289) · [Durable outbox schema](../database/classification-outbox.sql)

| Requested hosted evidence | Synchronous Admission | Deferred Admission |
| --- | --- | --- |
| Eligible candidate capture, committed outbox intents, preserved snapshot and terminal receipts | Unexecuted | Unexecuted |
| Response timing and work after the response | Unexecuted | Unexecuted |
| Repeated or concurrent same-ID submission and receipt deduplication | Unverified | Unverified |
| Lost acknowledgement, delayed admission and retry | Unverified | Unverified |
| Invalid writer grants, invalid schema, database interruption and reconnection | Unverified | Unverified |
| Restart after commit or termination before or after commit | Unverified | Unverified |
| Vercel invocation timeout and instance eviction | Unverified | Unverified |

For the disabled baseline, staging was prevented and the observed counts for committed intents, archived rows and terminal receipts were zero. Enabled eligibility, attempts, rejection, pending, recovery, unreconciled outcomes, acknowledgement loss, database errors and process termination have no observed cohort. The live responses and the Phase 1.6Q local replay cannot supply those measurements. There is no loss rate. An in-memory staged record has no durable guarantee. Committed outbox intent, archived evidence and terminal delivery receipt are distinct states. Vercel documents that retained work shares the invocation timeout, and this phase observed no timeout or eviction recovery. [Vercel function lifecycle](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil)

## Recommendation

Authorize a protected Preview test entry point that feeds the captured Phase 1.6Q runs and a fixed evaluation clock through the existing processor, limits admission to that fixture, and exposes sanitized per-ID lifecycle events to the test observer. Use isolated database state for each mode. A hosted fault control needs precise checkpoints before dispatch, after commit, and before acknowledgement. Claims about Vercel timeout and eviction require provider-observed invocation events correlated with those checkpoints. Preserve the current Production gate.

Phase 1.6R performed configuration and SQL readback plus disabled Preview requests. It made no code or deployment changes. Preview and Production archival remain disabled.
