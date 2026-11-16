# Phase 1.6X — Controlled Neon Provisioning and Preview Bootstrap

**All seven recovery acceptance scenarios passed on 11 November 2026.** Both temporary write-enabled Previews were retired. The pre-migration snapshot below records the original read-only phase.

## Authorized Neon provisioning result

Completed on **11 November 2026 at 17:56:36 MYT** on the existing disposable `neondb`, project `divine-lake-98736672`, branch `br-orange-feather-bdfm1xng`. The saved provider expiry was rechecked as **13 November 2026 at 23:59:55 MYT**. A verified TLS owner connection confirmed PostgreSQL 17.11, the expected owner privileges, and the empty pre-migration state before role creation.

| Check | Hosted result |
| --- | --- |
| Schema and roles | Created `transit_preview_replay`, `transit_replay_writer`, and `transit_replay_observer`. Both roles authenticated independently. Neither inherits another role or has access to the legacy archive or outbox. |
| Migration | Applied the four reviewed SQL files in the documented order in one transaction, using the PostgreSQL client with explicit rollback on errors. The readback found 3 tables, 10 indexes, 23 constraints, and 5 invoker-rights functions with the pinned search path. |
| Effective access | The writer has the scoped replay grants and cannot change immutable ledger fields, delete ledger rows, or truncate tables. The observer has SELECT and lacks write and worker execution privileges. An independent read-only Neon HTTPS transaction using the application driver also authenticated as the writer. |
| Repeat and initial state | Reapplied the same four files once. The catalog, effective grants, and row counts matched. The replay archive, outbox, and ledger each contained 0 rows. The two legacy tables also contained 0 rows, and their captured catalog and grants matched the preflight. |

The first role transaction received `XX000` at commit with client-side password verifiers. A fresh preflight confirmed both roles and the replay schema were still absent. The successful attempt used Neon's documented SQL password setup over verified TLS. The replay connection profiles are encrypted with Windows DPAPI outside Git. [Neon database access documentation](https://neon.com/docs/manage/database-access)

## Authorized replay source commit

The 14-file replay bundle was committed locally on `feature/postgres-outbox-preview` at `3bb0e2a48f3c1047b886c79a9c2497961de78d45`. The parent is the pre-replay commit `d1f9c3ffa27008a0df7491e024d5679b780fa1a2`.

An isolated copy of the proposed commit passed **373 tests in 27 files**, including **47 targeted replay, provisioning, and parity tests**. TypeScript, ESLint, the production build with both write switches off, and the staged diff check passed. The replay route's server trace listed both compressed fixtures. The staged files matched the tested copy and passed the credential scan.

## Authorized push and protected Preview deployment

GitHub accepted a fast-forward of `feature/postgres-outbox-preview` to `3bb0e2a48f3c1047b886c79a9c2497961de78d45`. The existing Vercel Git integration created `dpl_Bkbrkg8JD1ZrNYc6F1cNUEpXRM7z` at **18:17:15 MYT on 11 November 2026**. Vercel reported **Ready**, the exact feature branch and commit, and Node.js 26.x. The Preview recovery path redirected an unauthenticated GET to Vercel sign-in with HTTP 302. [Protected Preview](https://transit-scope-malaysia-gfolf22l9-loongmw2021-8669.vercel.app)

The exact Preview branch's normal archive flag read `false`. The project reported zero replay environment variables, zero automation bypass entries, and `all_except_custom_domains` protection. GitHub `master` and Vercel Production readback both reported `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. Production still served `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6` and returned 404 for the recovery path.

Automatic approval review rejected the credential binding at the push stage because the push authorization did not specifically cover sending the two secrets to Vercel or changing Preview environment variables. The authorized source push and deployment proceeded with the default-disabled replay route. The subsequent binding authorization and deployment are recorded below.

## Authorized Preview binding and redeployment

Vercel accepted `TRANSIT_PREVIEW_REPLAY_DATABASE_URL` and `TRANSIT_PREVIEW_REPLAY_SECRET` as sensitive variables scoped to `feature/postgres-outbox-preview` and the `preview` target. Both `TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED` and `TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED` read `false`. The writer uses the dedicated Neon role and the observer stays operator-side. The application bearer is stored locally in a Windows DPAPI-encrypted profile. [Vercel environment scoping](https://vercel.com/docs/environment-variables)

Vercel created `dpl_5HgW3wjeG6kWV9r8jFp2ajev5gSq` at **18:36:14 MYT on 11 November 2026**. The protected Preview reached **Ready** on Node.js 26.x with exact source `3bb0e2a48f3c1047b886c79a9c2497961de78d45`. Deployment metadata listed all four environment keys. The project reported zero automation bypass entries, and the Production alias still pointed to `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6`. [Bound Preview](https://transit-scope-malaysia-f8togoajc-loongmw2021-8669.vercel.app)

| Read-only check | Observed result |
| --- | --- |
| Unauthenticated Preview GET | HTTP 302 to Vercel sign-in. |
| Vercel-signed-in Preview GET without the application bearer | HTTP 401 with `Unauthorized`, confirmed in Vercel request logs as `dtwxl-1794393518630-e254f5e81d7d` at 18:38:38 MYT. |
| Independent Neon readback | The dedicated observer used a read-only transaction over verified TLS. The dedicated writer used a read-only transaction via the application's Neon HTTPS driver. Both saw 0 archive, outbox and ledger rows. |
| Production GET on the recovery route | HTTP 404. |
| Valid application bearer, discovery and unknown UUID | Passed in the authorized Playwright session below. |

## Playwright authenticated read-only checks

The operator signed in normally to Vercel in an isolated headed Edge session. Playwright used that session's cookies and read the application bearer from the locally encrypted profile into process memory. It sent two GETs to protected Preview `dpl_5HgW3wjeG6kWV9r8jFp2ajev5gSq` at exact source `3bb0e2a48f3c1047b886c79a9c2497961de78d45`. The deployment and the two `false` write switches were verified before opening the session. [Protected Preview](https://transit-scope-malaysia-f8togoajc-loongmw2021-8669.vercel.app) · [Playwright request context](https://playwright.dev/docs/api/class-apirequestcontext)

| Check at 18:46:52 MYT | Response | Vercel request ID |
| --- | --- | --- |
| `GET ?recoverable=1` | HTTP 200, `{"runs":[]}`, `Cache-Control: no-store` | `sin1::iad1::8988r-1794394010926-7626a77177c0` |
| `GET ?replayRunId=93c130ca-5d5c-4b1d-a045-febed902edb2` | HTTP 404, `{"error":"Replay not found"}`, `Cache-Control: no-store` | `sin1::iad1::cmbxw-1794394010926-11ab413f346a` |

Independent Neon observer transactions at 18:46:34 and 18:47:12 MYT each counted 0 rows in the replay archive, outbox and ledger.

## Authorized hosted recovery results

The test window opened at **21:50:14 MYT on 11 November 2026**. The original replay code at `3bb0e2a48f3c1047b886c79a9c2497961de78d45` ran in temporary Preview `dpl_8M9EYqVHxxnSybt7RZ2PZVd1ywaN`. The checkpoint commit `a4f714ee8485537a335306f3c7b4c2993775644b` ran in temporary Preview `dpl_7GXB6VkV2sJwYuCHXEkVSKqdvUuj`. Its three-file overlay passed six focused checkpoint tests, the 47 replay and provisioning regressions, and TypeScript. Vercel reported both exact SHAs on the protected Preview branch. The checkpoint commit was created in an isolated local clone for the temporary deployment.

| Scenario | Observed result |
| --- | --- |
| **A. Post-intent interruption** | Neon observed one pending feeder intent, no archive and no execution checkpoint. After the lease expired, discovery and recovery used original run `bdc45683-c1e4-4978-8e01-36f10f06121b`. Recovery produced one archive and terminal receipt with parity unset. Repeating it preserved the receipt and finalization time. Cleanup returned 204. |
| **B. Interrupted receipt transaction** | A candidate- and run-scoped trigger raised at the successful receipt update. PATCH returned 503. Neon still showed the pending intent, zero delivery attempts and zero committed archives. After removing the trigger and function, PATCH on the same run returned 200 and finalized a single receipt and archive. Cleanup returned 204. |
| **C. Receipt before finalization** | Neon observed a committed archive and receipt with null finalization. Fresh PATCH finalized run `631da4df-8a17-4966-8dff-a02be5be90e9`. The receipt ID, attempt count, settlement time and archive checksum matched the original. Repeat PATCH preserved the finalization time. Cleanup returned 204. |
| **D. Concurrent recovery** | Two overlapping PATCH requests returned 200 with distinct Vercel request IDs and the same finalization time. Neon recorded one recovery, one delivery attempt and one terminal outcome. Cleanup returned 204. |
| **E. Mixed committed and unresolved** | Two PATCH requests returned 200 for original run `dd4fde1b-2e4e-43d6-a66b-239b739f3f1b`. Neon showed one stable archive and receipt and three candidates without archive or outbox rows. Parity and finalization remained null. DELETE and a new reservation both returned 409. The unresolved run was preserved. |
| **F. Recovery timeout and retry** | With the exact run row locked, PATCH returned 503 in 1.79 seconds. The lock was released. GET and Neon readback showed the original pending intent with zero committed recovery attempts. Fresh PATCH returned 200 with one durable terminal outcome. Cleanup returned 204. |
| **G. Production rejection** | Public Production GET returned 404. Two targeted local tests verified Production rejection and no adapter construction. The compiled local route returned 404 with `Cache-Control: no-store` for GET and PATCH with a synthetic bearer, with zero outbound requests. |

For A, C and E, the original Playwright connections ended before the provider response was available to the client. Independent Neon snapshots proved the durable boundaries. Each Vercel checkpoint log matched a provider HTTP 504 for the same original invocation. A resumed on its original run after that evidence was reconciled. F exercised the database client deadline with a row lock. [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)

| Scenario | Vercel checkpoint | Original Vercel invocation | Provider status |
| --- | --- | --- | --- |
| A | `INTENT_COMMITTED` | `bp5tk-1794406082532-2ef05d4020e0` | 504 |
| C | `RECEIPT_COMMITTED` | `hqgnl-1794406331274-6a62ed9d2001` | 504 |
| E | `INTENT_COMMITTED` | `vljqn-1794406416852-8be6861de966` | 504 |

The final Neon observer transaction counted five cleaned ledger entries and one active unresolved entry for E, with one archive row and one outbox receipt. It found zero temporary fault triggers and zero temporary fault functions. Both temporary deployments were retired and returned 404 on management readback. The normal protected Preview `dpl_5HgW3wjeG6kWV9r8jFp2ajev5gSq` was Ready with both branch write switches `false` and zero automation bypass entries. Production still resolved to `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6`.

The first Playwright wait encountered a Neon connection closure before sign-in. The restarted runner opened database sessions after sign-in. It began write cases only after both test Previews passed the authentication and unknown-run checks. [Sanitized scenario evidence](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/hosted-recovery/verified-evidence.json>) · [Chronological observations](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/hosted-recovery/observations.jsonl>)

## Neon preflight snapshot

Readback on **11 November 2026 MYT** used the existing disposable connection profiles and read-only transactions. The saved provider record identifies project `divine-lake-98736672`, branch `br-orange-feather-bdfm1xng`, endpoint `ep-cold-base-bd1m7gdy` in `aws-us-east-2`, and expiry **13 November 2026 at 23:59:55 MYT**. The writer and observer authenticated independently to `neondb` on PostgreSQL **17.11 (9045acd)**. The writer uses the pooled endpoint and the observer uses the direct endpoint.

| Object or principal | Observed before migration |
| --- | --- |
| `public.transit_classification_evidence_v1` | Owned by `neondb_owner`. Primary key on `record_id`. Secondary indexes `transit_classification_expiry_v1` and `transit_classification_run_stop_v1`. Six checks cover the ID formats and correspondence between payload and indexed identity, stop, fix and expiry values. |
| `public.transit_classification_outbox_v1` | Owned by `neondb_owner`. Primary key on `record_id`. Secondary indexes `transit_classification_outbox_claim_v1`, `transit_classification_outbox_due_v1` and `transit_classification_outbox_expiry_v1`. Thirteen checks cover identity, payload, state, leases, attempts, settlement, disposition and error kind. |
| `outbox_preview_writer` | SELECT/INSERT on public archive, SELECT/INSERT/UPDATE on public outbox and EXECUTE on the public delivery function. No DELETE or TRUNCATE on either table, and no CREATE on an application schema. |
| `outbox_preview_observer` | SELECT on both public tables. The catalog reported no INSERT, UPDATE, DELETE, TRUNCATE, delivery EXECUTE or CREATE on an application schema. |
| `neondb_owner` | A separate read-only session confirmed database CREATE and role creation authority. The legacy archive and outbox each contained zero rows. |
| Replay objects | No `transit_preview_replay` namespace, ledger, replay copies, replay functions or replay grants. Neither `transit_replay_writer` nor `transit_replay_observer` exists. |
| Connection and timeouts | Both transactions reported `transaction_read_only=on`, `max_connections=450`, `statement_timeout=0` and `lock_timeout=0`. The replay adapter's 1.5-second HTTP deadline is independent of these server settings. |

The public catalog matches the earlier versioned archive and outbox. The replay migrations can create new objects in their own namespace without altering or copying rows from those public tables. [Phase 1.6W schema inventory](timetable-adherence-evidence-phase1-6w.md#required-schema-and-grants) · [Claimable Neon expiry](https://neon.com/docs/reference/claimable-neon)

## Migration and grants execution plan

1. After authorization, reverify the existing target, expiry, owner identity, current schema and role privileges against the snapshot. Stop if the project is unavailable, the target differs, or unexpected objects or grants exist.
2. Use the two role statements and secure password setup from Phase 1.6W. Create only the dedicated replay writer and observer on the existing disposable database. Use the verified owner service connection with TLS. Keep credentials outside Git and terminal output. The two role creations are separate from the migration transaction.
3. Run the exact Phase 1.6W `psql` command with `ON_ERROR_STOP` and one transaction. Create `transit_preview_replay`, set the local search path to that schema, then run `classification-evidence.sql`, `classification-outbox.sql`, `classification-replay.sql` and `classification-replay-grants.sql` in that order. DDL and grant changes are confined to the replay namespace. The grant script revokes default or prior access in that namespace before applying the tested grants. The files contain no evidence deletion, table drop, data backfill or activation flag change.
4. Read back the three tables, their named and constraint indexes, key/check definitions, manifest and lifecycle columns, five invoker-rights functions, and effective grants. Check that both data tables and the active ledger are empty. Verify the writer lacks access to legacy archive objects, ledger DELETE, immutable ledger column UPDATE and TRUNCATE. Verify the observer has SELECT and lacks mutation and worker EXECUTE. Confirm that neither login inherits the owner role or broader privileges.
5. With approval for migration retries and before any hosted replay, repeat the same transactional file sequence and compare the catalog and empty-row counts. The local repeat and rollback tests already passed. Conditional DDL assumes the clean or known-compatible schema and cannot repair unexpected drift. An error rolls back the migration transaction. Reinspect the separately created logins before reusing them. Confirm the Preview and Production activation settings after the readback.

These steps do not require a hosted replay POST, PATCH or DELETE. The DDL and grants are independent of application activation. A migration check does not establish managed recovery behavior. [Exact migration commands](timetable-adherence-evidence-phase1-6w.md#exact-migration-procedure-for-a-separately-authorized-change) · [Replay grants](../database/classification-replay-grants.sql) · [Local provisioning tests](../tests/preview-evidence-replay-provisioning.test.ts)

## Preview bootstrap plan

At the original preflight, GitHub reported `feature/postgres-outbox-preview` at `d1f9c3ffa27008a0df7491e024d5679b780fa1a2` and `master` at `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. Vercel project `prj_DqTjkYBkW3dmA0hEteczCHOQNVgE` reported the same branch provenance. Preview `dpl_EG9o19YJtDJmqLTvTwJERyiw9KCs` was Ready. Production alias `transit-scope-malaysia.vercel.app` pointed to `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6`. The normal archive writer URL and archive enable flag were scoped to the exact Preview branch. The flag read `false`. Protection was `all_except_custom_domains` with zero automation bypass entries.

1. Use the reviewed local SHA recorded above. It includes the Phase 1.6W file inventory, both compressed fixtures, and the server trace configuration. The earlier baseline SHA identifies the original deployed source.
2. The exact feature branch's Preview variables and both disabled switches were verified in the authorized redeployment above.
3. The authenticated discovery and unknown-UUID GETs passed through ordinary signed-in Preview access. Independent read-only Neon snapshots before and after the requests matched.
4. The authorized hosted validation used the separately recorded checkpoint SHA, the exact disposable Neon scope and the named temporary deployments. Both write-enabled test deployments were retired after evidence collection.

[Preview deployment sequence and file inventory](timetable-adherence-evidence-phase1-6w.md#preview-deployment-sequence) · [Vercel Git deployment behavior](https://vercel.com/docs/git) · [Vercel environment scoping](https://vercel.com/docs/environment-variables)

## Deterministic interruption checkpoints

Use a separately reviewed, Preview-only harness for one authorized request UUID, one allowlisted fixture and one checkpoint per trial. Correlate the original and recovery invocation IDs, UTC timestamps, run UUID and a read-only Neon snapshot. A marker records the boundary. The independent database snapshot establishes which writes committed. A local runner can hard-stop only its dedicated test process after observing the marker. For a hosted termination claim, keep the dedicated invocation at the checkpoint until the configured Vercel duration expires and correlate the provider's termination event with that invocation. Client abort, loss of an acknowledgement, and an injected exception each get their own result classification. None alone proves Vercel terminated or evicted an instance. [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)

| Checkpoint and scenario mapping | Injection, durable boundary and fresh-request assertions |
| --- | --- |
| **1. Intent committed, delivery pending** · scenarios **A and E** | In the original admission path, pause immediately after PostgreSQL acknowledges the first committed intent transaction and before the wrapper returns to the original processor or writes an execution checkpoint. The manifest, registration and that single `PENDING` intent must already be visible to the observer. No archive, terminal receipt or finalization should exist. Stop the local worker process or establish the hosted invocation termination described above. After the 90-second lease, a fresh request discovers the same run and candidate. Scenario A expects one archive, one successful terminal receipt and finalization with parity still unset. Scenario E uses the full four-candidate manifest, expects one archive and receipt, and preserves three unresolved candidates and an unfinished run. Retry the same UUID to check deduplication. Only A is eligible for cleanup after finalization. |
| **2. Archive insert executed, receipt write interrupted** · scenario **B** | Use the authorized, disposable test database to pause or raise at the candidate-scoped receipt transition, inside the same transaction and after the archive INSERT statement. The original intent is committed. The archive insert, claim and success receipt are still uncommitted. For a rollback test, raise the controlled database exception at that boundary and label it simulated. For a termination trial, observe the worker or transaction paused at the scoped checkpoint, then stop the dedicated worker or observe provider termination. Independently confirm the database transaction ended and rolled back. An HTTP timeout alone can leave PostgreSQL running. Before retry, the observer must still see the original pending intent and zero committed archive and success receipts. Remove the checkpoint and recover using the same UUID. Exactly one archive and receipt may commit, then the run may finalize and be cleaned. A committed archive without its matching receipt fails this test. |
| **3. Receipt durable, run finalization pending** · scenario **C** | Pause the original path after the archive and terminal receipt transaction commits, preferably after the execution journal checkpoint, immediately before the separate run finalization transaction. Verify the receipt, archive and null `finalized_at` using the observer. Stop the dedicated test process or confirm the hosted invocation terminated at this boundary. A fresh request can discover the execution-complete run immediately, or after lease expiry if its checkpoint is missing. It finalizes the original run while preserving the receipt ID, attempt count, settlement time and archive checksum. Repeat PATCH and compare the unchanged finalization timestamp. Cleanup is eligible only after the verified terminal summary. |

The existing `after-commit` fault returns a usable pending intent for D and F. A and E require the original invocation interruption checkpoint. Case B tests the atomic delivery/receipt transaction, so an externally visible intermediate committed archive is a failure. The existing 1.5-second database client deadline can end case B before any provider deadline. A hosted termination variant therefore needs its own reviewed harness or provider evidence. Case C tests the separate finalization transaction. Checkpoint design, implementation and provider-observed termination are distinct milestones.

## Seven-scenario acceptance matrix

For every write case start with an empty replay outbox/archive and no uncleaned ledger. Generate a fresh request UUID and record the **actual** run UUID from POST or authenticated request-ID lookup. Each case has its own run UUID. Recovery reuses it. Observe candidate IDs and checksums before and after using the Phase 1.6W observer query. Use the normal audited Preview SHA for B, D and F, and the separately recorded checkpoint SHA for A, C and E. Run E last if the cases share one namespace. G uses current Production and a local build of the audited source. No run IDs or deployment SHAs were generated by this planning phase.

| Candidate | Expected ID | Expected evidence checksum |
| --- | --- | --- |
| Feeder | `3f6f31df67248acd565cb2ac8fb90bbf70fcc238e72bf15cc8ba68a653b5e097` | `e073b6ba2e971a413d40c81792baa3a8f621a18c70fd78fcd68b4ae318271f90` |
| Penang early, first | `9419d15c9549cb68b65faa8ef7fac9e60b8b913a59eaab11c59a8e5a5a0e61c5` | `19f6da569e31c1c76282d12f2ce5ca61b221c54c291085983fc3f305b39db6c3` |
| Penang early, second | `902f87cd2238994827f2f156d1cecd0a662807696f12853b60c4719c63ff4815` | `7555cdd1f345fc3fa4c894d0b6e103248dec1b83b3ef5642035bac22a9aef978` |
| Penang delayed | `99cd216f0d1c509177fa033cfa5993921433594cf9b826620684eee40825cb06` | `e3e478e100f8af2f920d6edab95d72759c1fc3623a6c44aae2654c7c09002de8` |

| Scenario | Required state, operation and API response | Pass/fail and cleanup |
| --- | --- | --- |
| **A. Post-intent interruption** | Feeder only. Observe checkpoint 1 with one pending intent and no execution checkpoint. After lease expiry, GET discovery returns the run and fresh PATCH returns 200. | One matching archive and terminal receipt, one finalization, and unset parity. Missing commit or missing proof of termination leaves that claim unverified. DELETE refuses before completion and succeeds after evidence export and finalization. |
| **B. Interrupted receipt transaction** | Feeder only. POST with the existing `after-commit` fault returns 202. First PATCH under checkpoint 2 returns 503 for the controlled exception. Snapshot still shows pending intent and no committed archive or success receipt. Remove the fault and PATCH the same UUID for 200. | One matching archive and receipt and finalized run after retry. A partial committed archive or success receipt fails atomicity. Cleanup follows finalization. |
| **C. Receipt before finalization** | Feeder only. Checkpoint 3 leaves a matching committed archive and terminal receipt and null finalization. GET discovers the eligible run and PATCH returns 200. | One finalization and unchanged archive, receipt, attempts and settlement time. Duplicate delivery fails. Cleanup after evidence export. |
| **D. Concurrent recovery** | Feeder only. Start two independent PATCH invocations against one eligible pending intent. Expect 200 from both, or 503 for a contending request followed by 200 on retry. | One archive, one success receipt, one delivery attempt and one finalization. Confirm both invocations and identical final state through PostgreSQL. Cleanup after reconciliation. |
| **E. Mixed committed and unresolved** | Full four-ID manifest. Checkpoint 1 allows only the feeder intent to commit. After lease expiry, repeat PATCH on the original UUID and expect 200 with one archive and receipt and three unresolved. | No fabricated rows or parity. No finalization. DELETE and a new reservation on the same schema return 409. Preserve the original run. A new experiment needs separate isolated storage and new UUIDs. |
| **F. Recovery timeout and retry** | Feeder only. Hold the exact run row lock in the authorized disposable DB past the HTTP deadline. First PATCH returns 503 in the client-deadline trial. Release the lock, GET durable state, then issue fresh PATCH for the same UUID. | Retry must return 200 and one durable terminal outcome, whether the first transaction rolled back or eventually committed. Provider invocation timeout needs its own correlated evidence. Cleanup only after finalization. |
| **G. Production rejection** | Ordinary GET on current Production and a local Production-mode GET and PATCH with a valid synthetic bearer and unknown UUID. There is no expected manifest, candidate or run. | 404 and no adapter construction in the local guard test. No real Preview bearer is sent to Production. Any access to recovery fails the gate. No cleanup applies. |

[Phase 1.6W observer query and execution details](timetable-adherence-evidence-phase1-6w.md#hosted-execution-plan) · [Phase 1.6V acceptance plan](timetable-adherence-evidence-phase1-6v.md#hosted-validation-plan)

## Security and authorization gates

The local handler requires both Vercel environment values to be `preview` before authentication and adapter construction. It checks an independent bearer, accepts a bounded allowlisted fixture input, and gates PATCH behind the separate replay write flag. The handler keeps credentials server-side and returns generic failures. The earlier local Production build and canary scan verified safe rejection and that synthetic credentials were absent from client assets. This phase's ordinary GET received 302 from the protected Preview and 404 from Production. After bootstrap, test the actual Preview route's application authentication through ordinary signed-in Vercel access.

Recovery locks one exact run UUID and matches registered candidate IDs and checksums. Terminal receipts and finalization commit under that lock. Cleanup checks finalization, scope and the durable summary, and refuses pending, unresolved and unrelated records. The local replay, provisioning and deterministic parity suites passed **47 tests across three files**. Local concurrency exercises overlapping requests through embedded PostgreSQL. Separate Vercel invocations and database sessions remain hosted checks.

| Separate authorization | Exact scope to approve |
| --- | --- |
| Neon provisioning | Existing project `divine-lake-98736672`, branch `br-orange-feather-bdfm1xng`, database `neondb`. Approve the two dedicated roles, four tested SQL files, one verified retry, and read-only verification. Keep legacy objects and any Production database outside scope. |
| Source commit | Approve only the reviewed replay file list on `feature/postgres-outbox-preview`. This phase leaves it uncommitted. |
| Preview binding, push and bootstrap | Approve binding only the dedicated writer and replay bearer to the exact Preview branch, with both archival switches off, and pushing the reviewed full SHA so the existing Vercel project builds it as Preview. |
| Hosted recovery validation | Approve the exact Preview deployment IDs and SHAs, one test window, scoped disposable database fault operations, hosted replay writes and eligible cleanup. A checkpoint harness change or rollout must be reviewed as part of that scope. Production archival stays disabled. |

**Decision at close of the read-only preflight.** Provisioning awaited the named authorization and an expiry recheck. Preview bootstrap requires the reviewed commit, verified grants and separate push/deployment authorization. The original preflight made no Neon, GitHub or Vercel changes. The authorized provisioning result is recorded above.
