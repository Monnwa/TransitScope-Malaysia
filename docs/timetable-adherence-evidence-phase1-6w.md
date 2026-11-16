# Phase 1.6W — Schema Provisioning and Preview Deployment Readiness

**BLOCKED for hosted validation.** The migrations and grants passed local PostgreSQL checks. The existing Neon database still needs the replay schema and dedicated roles, and the protected Vercel Preview still runs the pre-replay commit. Several of the hosted scenarios also need controlled interruption checkpoints. This phase performed read-only hosted inspection and local tests. Preview and Production archival remain disabled.

## Phase 1.6V blockers and current readback

| Item | Verified on 11 November 2026 |
| --- | --- |
| Disposable Neon | Project `divine-lake-98736672`, branch `br-orange-feather-bdfm1xng`, database `neondb`, PostgreSQL 17.11. The existing writer and observer both connected in read-only transactions. Recorded expiry is **13 November 2026 at 23:59:55 MYT**. Recheck expiry and access before provisioning. |
| Existing Neon objects | The earlier `public` archive and outbox are present. The old writer can insert into the public outbox and lacks DELETE. The old observer lacks both operations. The replay schema and both proposed dedicated replay roles are absent. |
| Vercel Preview | `dpl_EG9o19YJtDJmqLTvTwJERyiw9KCs` is Ready on `feature/postgres-outbox-preview` at `d1f9c3ffa27008a0df7491e024d5679b780fa1a2`. The project has no replay binding. The normal archive flag is literally `false` on that Preview branch. |
| Vercel Production | Project `prj_DqTjkYBkW3dmA0hEteczCHOQNVgE` still serves `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6` at `235f7cb67d631a17df86bfc23f70de93dc0fff5d` from `master`. Protection is `all_except_custom_domains` with zero automation bypass entries. The archive-related configuration readback was Preview-only. |

[Phase 1.6V audit](timetable-adherence-evidence-phase1-6v.md) · [Neon project expiry](https://neon.com/docs/reference/claimable-neon)

## Required schema and grants

Every object below is missing from the existing Neon **replay** schema. The earlier public objects are separate.

| Migration or object | Required definition |
| --- | --- |
| Namespace `transit_preview_replay` | Owned by the provisioning principal. PUBLIC receives no privileges on the schema, tables or functions. The app uses a transaction-local search path. The schema contains only replay objects. |
| `classification-evidence.sql` | `transit_classification_evidence_v1` with a 64-hex `record_id` primary key, 64-hex `run_stop_id`, fix and expiry times, and required JSON payload. Checks bind the ID, stop and times to the payload. Indexes `transit_classification_run_stop_v1` and `transit_classification_expiry_v1` support lookup and expiry. |
| `classification-outbox.sql` | `transit_classification_outbox_v1` with a 64-hex `record_id` primary key, payload, enqueue/expiry times, state, attempts, next-attempt time, claim token, settlement time, disposition and error kind. Checks bind ID and expiry to the payload and constrain states, leases, attempt count and terminal receipt fields. Indexes `transit_classification_outbox_due_v1`, `transit_classification_outbox_claim_v1` and `transit_classification_outbox_expiry_v1` support due work, leases and expiry. The schema-local `transit_deliver_classification_outbox_v1(uuid,bigint)` writes the archive and terminal receipt together. |
| `classification-replay.sql` | `replay_runs` with UUID primary key, unique request UUID, creation/execution/cleanup timestamps and required JSON journal. Adds the immutable manifest, journal revision, finalization timestamp, terminal summary and recovery timestamp/count. The partial unique index `replay_one_uncleaned_run` admits one uncleaned run. Installs `lock_replay(uuid,boolean)`, `replay_terminal_summary(uuid)`, `finish_replay(uuid)` and `recover_replay(uuid,uuid)`, and pins the delivery function's search path. The five functions use invoker rights. There are no sequences or cross-schema foreign keys. |
| `classification-replay-grants.sql` | Dedicated writer and observer each get schema USAGE and SELECT on the three tables. The writer gets ledger INSERT on `id, request_id, manifest, report` and UPDATE only on journal and lifecycle columns. The writer gets archive INSERT/DELETE, outbox INSERT/UPDATE/DELETE and EXECUTE on the five replay functions. The observer receives SELECT only and no function EXECUTE. |

The archive and outbox table-level INSERT/UPDATE grants match the existing admission readiness check. Column-only grants on those tables would leave that check false. DELETE on the two disposable tables supports the existing shared role's explicit cleanup route. Neither login should own any replay object, inherit an owner role, hold legacy archive privileges, or have schema CREATE or TRUNCATE. The writer cannot overwrite a manifest, IDs or creation time or delete ledger rows. The observer can run discovery and inspect journals, intents, archive rows and receipts through SELECT. It cannot execute the recovery worker, which locks and updates rows. The HTTP endpoint uses a server-side writer binding for all its methods.

[Evidence migration](../database/classification-evidence.sql) · [Outbox migration](../database/classification-outbox.sql) · [Replay migration](../database/classification-replay.sql) · [Exact grants](../database/classification-replay-grants.sql) · [PostgreSQL GRANT](https://www.postgresql.org/docs/17/sql-grant.html)

## Exact migration procedure for a separately authorized change

1. Confirm the intended disposable Neon project, branch, database, expiry and owner session before running DDL. Verify the replay namespace is absent or a known compatible draft. Inventory existing objects, grants and uncleaned ledger rows. Keep the public archive and outbox out of the migration search path. If a legacy uncleaned run is present, preserve it and stop. The unique index can block a new reservation even when the old run has no manifest.
2. As the database role administrator, create the two dedicated roles using the SQL below after confirming their names are unused. If they already exist from an earlier attempt, inspect their ownership, memberships and effective grants before reusing them. Set distinct passwords through the operator's secure credential flow. In an interactive `psql` session use `\password transit_replay_writer` and `\password transit_replay_observer`. Keep both credentials out of command arguments and reports. Confirm each role can connect to the disposable database, and grant only CONNECT on that database if it is missing.

```sql
CREATE ROLE transit_replay_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE transit_replay_observer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
```

3. From the repository root, use `psql` with the verified disposable owner connection in the operator's local `transitscope_replay_owner` service entry. Use the provider's verified TLS configuration. Run all four files in the same transaction, in this order. This is a prepared command for the authorized provisioning window.

```powershell
$migrationArgs = @(
  '-X', '--dbname=service=transitscope_replay_owner',
  '--single-transaction', '--set=ON_ERROR_STOP=1',
  '--command', 'CREATE SCHEMA IF NOT EXISTS transit_preview_replay; SET LOCAL search_path TO transit_preview_replay, pg_catalog, pg_temp;',
  '--file=database/classification-evidence.sql',
  '--file=database/classification-outbox.sql',
  '--file=database/classification-replay.sql',
  '--file=database/classification-replay-grants.sql'
)
& psql @migrationArgs
if ($LASTEXITCODE -ne 0) { throw 'Replay migration failed' }
```

4. Before binding the credentials, read back schema, function signatures, invoker rights, indexes, constraints and effective table and column privileges with both logins. Confirm that the two data tables are empty and there is no uncleaned run. Verify that the observer lacks worker EXECUTE and that neither login can write to the legacy archive. Use catalog privilege queries for hosted negative checks during provisioning. Repeat the inspection after any retry or ambiguous migration response.

On a clean schema or compatible draft, the migration is repeatable. Table, index and added-column statements are conditional, function definitions are replaced, and grants are reapplied. A transaction error rolls back schema and grants applied by that transaction. Login roles created in step 2 are outside that boundary and remain available for a verified retry. Conditional DDL does not repair arbitrary drift or remove inherited or pre-existing column grants. Stop on unexpected definitions or access. The upgrade adds manifest and finalization fields without backfilling legacy ownership. Old runs with no manifest remain ineligible. These migrations create storage and grant access. Application archival still requires the explicit activation switches.

## Local verification and recovery compatibility

Four new isolated PGlite tests used the exact migrations and grants. They covered fresh installation, a retry with an existing pending intent, upgrade of an earlier replay ledger alongside the legacy public schema, role-denied mutations, and transaction rollback followed by a clean retry. A writer session used the real route and admission readiness check to create a pending intent, recover it, repeat recovery and clean the finalized run. The observer discovered and read the run and received SQLSTATE `42501` for recovery and cleanup. The writer was denied ledger manifest and creation-time updates, ledger deletion and outbox truncation.

Recovery uses the exact run UUID and requires candidate ID and checksum matches between manifest, durable staging registration and intent. It skips conflicting archive evidence. A fresh worker can discover a committed intent even when the original execution checkpoint and parity result are missing. The worker locks the run and writes its claim, archive, receipt and finalization in one transaction. Existing local tests cover repeat requests, overlapping requests, checksum conflicts, receipt and finalization rollback, and unrelated data. The mixed run test recovered one committed candidate, left three unresolved and blocked both finalization and cleanup. Separate database sessions on Neon and Vercel invocation boundaries remain unverified.

The single uncleaned-run index prevents a fresh replay from overwriting an incomplete run. A new experiment needs fresh request and run UUIDs. If an unresolved run remains, schedule a new experiment only with separately authorized isolated storage. Uncommitted payloads and unrecorded parity remain unavailable. An explicit durable rejection can be terminal when no conflicting intent or archive exists.

There is no application schema change needed for ordinary pending-intent recovery. Cases A, C and E below require a controlled interruption after a durable checkpoint. The existing `after-commit` fixture fault leaves the original execution checkpoint recorded and therefore cannot substitute for them. Prepare an authorized, narrowly scoped Preview test harness before claiming those boundaries. For case B, a database transaction fault at receipt creation suffices. For case F, the 1.5-second Neon HTTP deadline can be tested with a controlled lock wait. It does not establish Vercel function timeout or eviction.

[Provisioning tests](../tests/preview-evidence-replay-provisioning.test.ts) · [Recovery tests](../tests/preview-evidence-replay.test.ts) · [Recovery API](../lib/preview-evidence-replay-http.ts) · [Recovery SQL](../database/classification-replay.sql)

## Preview deployment sequence

1. After separate approval, review and stage the minimal replay bundle on the existing `feature/postgres-outbox-preview` branch. Include the route, the three replay libraries, the scoped-claim support in the archive store, the SQL and tests, the server-only environment template, `next.config.ts`, and both pinned files under `tests/fixtures/journey-parity/`. Exclude local credentials, build cache and unrelated drafts. Include any separately reviewed fault harness in the recorded test SHA. Verify the branch differs from Production `master`, run the build and verify both fixture files in the server trace before creating a commit.
2. Keep the normal archive flag `TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED=false`. For the initial disabled Preview, scope `TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED=false` to this exact branch. After the Neon grants pass readback, scope `TRANSIT_PREVIEW_REPLAY_DATABASE_URL` and `TRANSIT_PREVIEW_REPLAY_SECRET` as server-only secrets on that branch. The URL uses the dedicated replay writer. Keep the observer off Vercel. Confirm both platform environment indicators will be exposed. Check the staged branch configuration before push because Git integration can create a deployment immediately. Environment changes apply to new deployments.
3. After the separately approved push, confirm the Vercel Preview deployment ID, target, branch, exact commit SHA and build status in the existing project. Confirm the existing Production ID, alias, environment and protection readback. Use ordinary signed-in Vercel access to Preview. For read-only smoke checks use authenticated GET discovery and an unknown-run GET. Disabled replay POST still creates a reservation and journal, and DELETE is a mutation, so both are outside the read-only smoke check.
4. Hosted writes require a separately approved validation Preview from the audited SHA. Only that test deployment may carry `TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED=true`. Keep the normal archive switch false throughout. Retain the operator-only bearer, use the existing protection, and capture invocation and database evidence before cleanup. End the approved test window by disabling the switch for subsequent deployments and retiring the write-enabled deployment or revoking its dedicated database credential. A later environment change does not change an older deployment's binding.

[Vercel Git branch deployments](https://vercel.com/docs/git) · [Environment variable scoping](https://vercel.com/docs/environment-variables)

## Hosted execution plan

Use the exact recorded Phase 1.6U Preview SHA, or the separately reviewed checkpoint-instrumented SHA for A, C and E. The deployment metadata must identify the version for every trial. For write cases use a fresh request UUID and a clean replay schema. Call the route through ordinary signed-in Vercel access and the branch bearer. Write tests use the body `{"requestId":"<uuid>","fixtureId":"feeder","mode":"synchronous","fault":"after-commit"}` unless the scenario specifies otherwise. Obtain the run UUID from POST or from `GET ?requestId=<uuid>` after an interrupted response. Read before and after with `GET ?replayRunId=<uuid>` and the independent observer. Use `PATCH ?replayRunId=<uuid>` for recovery. Record manifest/candidate checksums, receipt state and attempt count, archive existence, finalization time, HTTP status and invocation ID. Export the terminal report before `DELETE ?replayRunId=<uuid>`.

Set `run_id` to the observed UUID in the observer's `psql` session. Capture this read-only snapshot before cleanup. It exposes timestamps and checksums without returning the evidence payload.

```sql
BEGIN READ ONLY;
SELECT r.id, r.created_at, r.finished_at, r.finalized_at, r.recovery_attempts,
       r.manifest->>'fixtureChecksum' AS fixture_checksum,
       m."candidateId", m.checksum AS expected_checksum,
       q.state, q.attempts, q.settled_at_ms,
       q.payload->>'checksum' AS intent_checksum, a.payload->>'checksum' AS archive_checksum
FROM transit_preview_replay.replay_runs r
LEFT JOIN LATERAL jsonb_to_recordset(r.manifest->'candidates')
    AS m("candidateId" text, checksum text) ON true
LEFT JOIN transit_preview_replay.transit_classification_outbox_v1 q
    ON q.record_id = m."candidateId"
LEFT JOIN transit_preview_replay.transit_classification_evidence_v1 a
    ON a.record_id = m."candidateId"
WHERE r.id = :'run_id'::uuid
ORDER BY m."candidateId";
COMMIT;
```

| Case and version | Initial state and exact operation | Expected API and durable evidence | Failure, recovery and cleanup |
| --- | --- | --- | --- |
| **A. Intent committed before original interruption** · checkpoint SHA | Empty schema. POST the single-candidate fixture with a checkpoint that stops original processing immediately after the first intent commits, before its acknowledgement/checkpoint is recorded. Independently see the manifest, registration and pending intent with no execution checkpoint. After the 90-second execution lease, discover and PATCH the original UUID. | Discovery returns 200 with that UUID. PATCH returns 200, one archive and successful terminal receipt, one finalization, and unset parity with interrupted execution. | An archive or finalization before the checkpoint, absent committed intent, replacement UUID or fabricated parity fails the case. Retry the same UUID after GET if acknowledgement is ambiguous. DELETE returns 409 before recovery and 204 after verified finalization. A checkpoint simulation alone cannot prove actual invocation termination. |
| **B. Rollback between archive insert and terminal receipt** · base SHA plus scoped DB checkpoint | POST the standard body. Verify one pending intent. In the approved disposable DB, install a temporary trigger scoped to that candidate which raises an exception on the transition to a successful terminal receipt. PATCH once and remove the trigger before retry. | First PATCH returns 503. Observer sees the original pending intent, zero committed archive and success receipt, and no finalization. Fresh PATCH returns 200 with one archive, one receipt and finalization. | A partial committed archive or receipt fails atomicity. Preserve observer snapshots, remove the fault and recover the same UUID. DELETE is refused until finalization. The local receipt-rollback test contains the tested trigger pattern. |
| **C. Receipt committed before finalization** · checkpoint SHA | Empty schema. POST the normal single-candidate replay with `fault=none` and interrupt after the delivery transaction commits, before run finalization. Read the archive/receipt and unset finalization, then PATCH after execution checkpoint or lease expiry. | PATCH returns 200 with one finalization. The archive ID, receipt state, attempt count and settlement time match the pre-PATCH snapshot. | Receipt changes, duplicate delivery or failure to finalize after a confirmed terminal state fails the case. Repeat PATCH after GET if needed. Cleanup is eligible only after finalization. |
| **D. Concurrent recovery** · base SHA | POST the standard body. Once one pending intent is visible, start two separate authenticated PATCH requests for the same UUID. | Both requests return 200, or a contending request returns 503 and succeeds on retry. Observer sees one archive, one receipt, one delivery attempt and one finalization. | Duplicate rows, repeated delivery or different finalization timestamps fail the case. Read and retry only the original UUID. Clean up after reconciliation. |
| **E. Committed plus unresolved** · checkpoint SHA | Run last in the shared schema. POST `phase-1-6q` in synchronous mode with the checkpoint after exactly one durable intent commit. Verify four expected IDs and only one intent, wait for lease expiry, then PATCH twice. | Each PATCH returns 200 with one archived and terminal, three unresolved and no finalization. Parity remains unset if execution never recorded it. DELETE and a second reservation return 409. | Any invented receipt, archive or parity for the missing candidates fails the case. Preserve the original ledger and evidence. A new experiment requires new UUIDs and separately isolated storage. No cleanup. |
| **F. Timeout and fresh request** · base SHA | POST the standard body. From an approved disposable DB session start a transaction and take a row lock on the exact ledger UUID with `SELECT id FROM transit_preview_replay.replay_runs WHERE id = :'run_id'::uuid FOR UPDATE`. Hold it past the client deadline while issuing PATCH. Release the lock with ROLLBACK, then issue GET and a fresh PATCH. | First PATCH returns 503 in the client-deadline test. After release the observer may see pending or already committed delivery depending on server cancellation. The fresh request must produce or confirm one archive, one receipt and one finalization. | An unresolved final state, duplicates or contradictory receipts fail the case. Retry only after reading actual durable state. Record provider timeout evidence separately if available. Clean up only after finalization. |
| **G. Production rejection** · current Production and local build of audited SHA | Check the existing Production deployment with ordinary GET to the replay discovery path. Run the audited build under Production runtime settings with a valid synthetic test bearer and issue discovery and PATCH using an unknown UUID. | 404 in both checks. The local guarded handler creates no database adapter. The real Preview token stays confined to Preview. | Any Production request reaching recovery or returning a success response fails the gate. Stop hosted testing and inspect deployment or environment provenance. No database mutation or cleanup applies. |

## Go/no-go

**Go** after approval, with the exact Preview SHA and configuration verified, the existing disposable database still within its validation window, the schema and effective writer/observer grants confirmed, the initial protected Preview smoke checks passing, and the relevant interruption checkpoints available. Observe actual durable records for every claimed result. Start with A–D and F only when their required evidence is available, and run the unresolved case last in any shared schema.

**No-go** if the database is unavailable or expires before the planned window, Production or protection configuration differs, a replay credential has access to legacy archive tables, the schema or grants drift, the Preview SHA is wrong, or a required interruption boundary cannot be established. The recorded expiry, missing hosted schema/grants, pre-replay deployment and checkpoint gaps keep Phase 1.6W at **BLOCKED**.

The full local suite passed **421 tests across 31 files**, including the four provisioning tests and all four deterministic parity tests. TypeScript, ESLint and the production build passed. The build ran with both archive switches disabled, and both pinned fixture files appeared in the server route trace. No hosted migration, grants, replay, push or deployment took place.
