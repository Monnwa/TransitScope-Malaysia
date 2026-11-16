# Phase 1.6U — Durable Replay Run Recovery

The original HTTP invocation is no longer required to reconcile an interrupted replay run. A later authenticated Preview request can discover the run, deliver its committed intents, reconcile terminal receipts and finalize the same run. Candidates with no committed intent or recorded rejection remain unresolved. No archival flags or cloud configuration changed, and no deployment, push or commit was made.

## Persistence model

Phase 1.6S/T persisted the run reservation and a mutable journal in `replay_runs`. The journal started with the fixture's expected IDs and checksums, then recorded generation, staging, attempts and result fields. The original process kept the archive staging map, pending promises and any journal updates not yet sent to PostgreSQL. The outbox carried a payload until delivery; a successful terminal receipt stayed in that same outbox row after its payload was cleared. The archive kept the immutable evidence snapshot. The outbox had no replay run ID or authoritative expected candidate set. The only recovery entry point required a finished `after-commit` fault run, and cleanup could not safely remove an expired run that still had pending intents.

Phase 1.6U stores a versioned **manifest** at reservation commit, separately from the execution journal. It includes the fixture and canonical baseline checksums, fixture ID, execution mode, fault selection, captured final time, expected candidate count and the exact candidate ID/checksum pairs. Counts are fixed by the validated fixture: four for the full enabled replay, fewer for its subsets, and zero with archival disabled. No fixture GPS or schedule payload is copied into the manifest. The journal records actual generation and staging, and registers candidate state in PostgreSQL before admission can issue the intent write. A monotonic journal revision prevents an older write from replacing newer evidence. Registration and intent commit are separate transactions.

The run row records creation, completion of the original execution checkpoint, last committed recovery attempt, committed recovery attempt count, finalization time and a terminal summary. The execution checkpoint is separate from archival finalization. A recovered run can have terminal archival evidence while its interrupted execution has no recorded parity result; the worker does not reconstruct or invent that result. Legacy ledger rows without a manifest are ineligible and are never backfilled from their mutable journals. Use a clean isolated replay schema when provisioning this draft.

[Replay migration](../database/classification-replay.sql) · [Database adapter](../lib/preview-evidence-replay-db.ts) · [Replay execution and reconciliation](../lib/preview-evidence-replay.ts)

## Crash windows

| Interruption point | Durable state and fresh-worker outcome |
| --- | --- |
| Before reservation commit | No run or candidate is visible. Lookup by original request ID returns 404; retrying the same request ID can safely reserve a run. A committed reservation whose acknowledgement was lost is found by request ID instead of rerunning it. |
| After manifest commit, before candidate generation or registration | The expected IDs survive, but neither generation nor the original staged evidence is proven. After the execution lease expires the worker discovers the run and leaves those candidates unresolved. It does not rerun GPS processing or substitute expected IDs for actual candidates. |
| After registration, before outbox commit | Actual generation and staging may be recorded, but that metadata does not include the original pending payload and cannot be used to dispatch it. An absent intent with no recorded rejection stays unresolved. Cleanup and finalization are refused. |
| After outbox commit, before acknowledgement or execution checkpoint | The matching intent and registered candidate are visible. Recovery discovers the run after the 90-second execution lease, verifies ownership and checksum, and uses the durable payload. The outbox primary key prevents duplicate identity; the replay run lock serializes state changes. |
| After normal claim, before delivery | The claim and retry time may be committed. Recovery waits until it is due, then claims it again. The worker clock advances from the captured final time using elapsed database time, so a historical fixture does not immediately expire and an interrupted claim does not freeze forever. |
| After archive insertion, before terminal receipt | The archive insert and receipt update share a PostgreSQL transaction through the existing delivery function. An error before receipt creation rolls back the archive insertion. The recovery transaction also rolls back its claim and finalization. A fresh invocation can retry the existing intent. |
| After receipt commit, before finalization | The matching archive and receipt survive. The worker recomputes the terminal summary and finalizes without a second archive or receipt. Once recovery commits, a lost response is handled by repeat PATCH or GET. |
| During recovery finalization | Recovery claims, delivers and finalizes in a single transaction. A rollback leaves the prior committed state; a later request safely retries. The original execution's finalization is a separate transaction and can be retried from the committed receipt. |

## Independent recovery and cleanup

An authorized operator can call the existing endpoint with `GET ?recoverable=1` to discover the one eligible unfinished run, `GET ?requestId=<uuid>` to recover a lost reservation acknowledgement, and `PATCH ?replayRunId=<uuid>` to recover a specific run. Discovery is read-only. PATCH requires the separate replay write switch and awaits its database transaction before returning. The ordinary replay also attempts finalization after recording its execution checkpoint. No recovery depends on the original request, process, browser, or Next.js continuation.

The recovery transaction locks the requested run and refuses missing, legacy, cleaned or still-active runs. It selects only due intents with the manifest's ID and checksum and a matching durable staging registration. Conflicting archive checksums block recovery. PostgreSQL's existing delivery function writes the archive and updates the receipt together. Two recovery requests target the same row lock; once finalized, a repeat call returns the same result without claiming work or incrementing the recovery counter. The recovery SQL keeps the existing replay worker batch bound and retry cap; an expired or exhausted intent becomes a terminal failure, not a successful archive. Reported recovery attempts count committed transactions that entered recovery; failed transactions and no-op calls on finalized runs do not increment that count.

Finalization requires every expected candidate to have one of three outcomes: a matching archive and successful terminal receipt, a matching terminal failure receipt without an archive, or a recorded rejection without conflicting durable evidence. Rejection is terminal and allows finalization, but is not counted as committed or archived. A zero-candidate run requires the original execution checkpoint; an empty manifest by itself is not evidence of completed execution. Pending, missing or conflicting evidence blocks finalization. Finalization stores candidate IDs, checksums and terminal receipt metadata. This is local idempotency, not global exactly-once delivery.

DELETE requires a finalized run, a terminal summary that still agrees with PostgreSQL, no pending intents, and no mismatching or unrelated rows in the isolated replay schema. It then removes only that run's disposable payload and outbox rows. The immutable manifest, execution journal and terminal receipt summary remain readable with state `CLEANED`; reports use that stored snapshot and do not join later runs that reuse fixture candidate IDs. Capture any full evidence payload needed for a separate audit before explicit cleanup. Runs with genuinely missing pre-commit evidence cannot be removed through this API. With one active reservation, an unresolved run blocks new replays; preserve its records and investigate before any separately authorized owner-led reset of the disposable test schema.

## Vercel and security

The supported design for this project is a **separately invoked, authenticated Preview route**, once the route and isolated database are deployed and authorized. The current repository does not configure a recovery scheduler. Vercel's standard Cron configuration targets Production and cannot be used for this Preview-only endpoint. No external worker, queue or new service is required for controlled operator-driven validation. Automatic recovery with no operator invocation is outside this implementation. [Vercel Cron configuration](https://vercel.com/docs/project-configuration/vercel-json#crons)

The original response can use Next.js `after()` to retain deferred work within the platform's duration limit. That callback has no crash durability. The new worker uses its own invocation and waits for PostgreSQL; if the invocation stops, a later request checks the durable result. An HTTP timeout does not prove the transaction was cancelled. Vercel eviction and timeout behavior, cross-instance contention, Neon transaction timing and recovery, and hosted logs remain unverified. [Next.js 15 `after()`](https://nextjs.org/docs/15/app/api-reference/functions/after)

Both Vercel runtime environment values must be exactly `preview`; the independent bearer and existing replay writer switch still apply. Discovery does not accept SQL or database URLs, and recovery accepts only one UUID. Queries are bound and confined to the replay schema. The new SQL functions are invoker-rights, use the pinned search path and revoke public execute. Provision the replay role with only the required schema and function grants, table reads and allowed insert/update columns. In particular, grant journal and lifecycle updates but no update permission on `manifest`, `id`, `request_id` or `created_at`. Verify disposable database identity and lack of access to normal archive schemas separately. The stored checksums establish correspondence to the pinned fixture and receipts under this trusted database boundary; they are not a cryptographic audit of arbitrary mutations by a privileged database operator. The API retains generic errors, no-store responses and server-only credentials.

## Local validation

Tests used isolated embedded PostgreSQL (PGlite) and the existing deterministic Phase 1.6Q captures. Boundary tests stopped the original adapter before a write or dropped the acknowledgement after a real local commit, then constructed a fresh adapter. Receipt/finalization tests used transaction rollback after the relevant SQL boundary. These tests do not simulate Vercel eviction or establish performance under separate PostgreSQL sessions.

| Scenario | Result |
| --- | --- |
| Before and after reservation commit; after candidate registration | No fabricated intent or completion. The committed reservation remained discoverable. Unresolved runs refused cleanup. |
| Committed intent with lost admission acknowledgement | A fresh adapter recovered and finalized the original unfinished run; no parity outcome was fabricated. |
| Archive insertion interrupted before receipt | No partial archive or receipt survived. Retrying delivered the prior committed intent. |
| Receipt durable before finalization; interruption during recovery finalization | Existing receipt was reconciled without redelivery. A rolled-back recovery did not report a committed attempt; fresh retry succeeded. |
| Mixed terminal and pending candidates, expired claim, overlapping/repeated recovery, lost recovery acknowledgement | Pending candidate blocked completion. When due, it was recovered once. Repeated requests returned the same terminal summary and finalization timestamp. |
| Rejection, checksum mismatch, unrelated data and cleanup | Durable rejection permitted finalization. Mismatched or unrelated records blocked unsafe work or cleanup. A cleaned run retained its own terminal audit report. |
| Security | Production discovery rejected even with the configured bearer. Unauthenticated discovery and write-disabled PATCH did not access storage. |

| Regression check | Result |
| --- | --- |
| `pnpm exec vitest run` | 416 passed across 30 files, including 38 replay tests and all four Phase 1.6Q deterministic parity tests. |
| `pnpm exec tsc --noEmit --incremental false` | Passed. |
| `pnpm run lint` | Passed. |
| `pnpm run build` | Passed on Next.js 15.5.28. Synthetic replay token and writer credential were absent from the browser bundle. |
| Built route over loopback HTTP | Discovery, request-ID lookup and recovery returned 404 with `Cache-Control: no-store` under Production runtime settings even with the correct test token. No hosted request was made. |

**Readiness:** The Phase 1.6T post-commit recovery blocker is resolved locally for the supported fixture and manifest. Do not activate hosted archival. Before separately authorized Preview validation, verify the isolated database and grants, deployment provenance, route protection, time budgets and cross-invocation recovery with managed receipts. Pre-commit candidates remain vulnerable; automatic replay of missing candidates is not implemented. Production archival remains disabled.
