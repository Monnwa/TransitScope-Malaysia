# Phase 1.6M — Preview-only Outbox deployment preparation

## Outcome

The reviewed PostgreSQL Outbox source was committed locally on `feature/postgres-outbox-preview`. A new disposable Neon database was provisioned, migrated and verified with separate writer and observer roles. **Preview deployment stopped at the environment configuration gate.** Vercel rejected a branch-scoped setting because the feature branch does not yet exist on GitHub. A push can trigger a build before those required settings exist. The branch remains local, the database secret was never sent to Vercel, and Phase 1.6K cannot resume. Production remains on the existing pre-Outbox deployment with archival disabled.

## Source and branch isolation

| Item | Verified result |
| --- | --- |
| Existing repository | `Monnwa/TransitScope-Malaysia`. GitHub reported `master` as the default branch. |
| Base and Production source | `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. The local and remote `master` refs remained at this SHA. |
| Dedicated branch | `feature/postgres-outbox-preview`, created from the verified base. GitHub did not have this branch before the work or after the Vercel rejection. |
| Preview commit | `7b73d7b964c4db7dc66b9f91438cbc8b2aa48abf`, parent `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. |
| Index and scope | Staged paths matched the 20-file allowlist below. The staged whitespace and credential checks passed after recognizing the reserved `.example` hostname used in the archive-disabled unit test. The index is empty after the commit. Existing phase reports, unrelated validation artifacts and the generated `tsconfig.tsbuildinfo` were excluded. |

The commit contains these 20 files.

| Area | Files and role |
| --- | --- |
| Immutable evidence, admission and recovery | `lib/classification-evidence.ts` captures and validates the original snapshot and stable ID. `lib/classification-evidence-store.ts` implements bounded staging, same-ID admission, receipt reconciliation, claim fencing and recovery. |
| Database schema | `database/classification-evidence.sql` creates the historical archive. `database/classification-outbox.sql` creates the intent table, indexes and transactional delivery function. Apply them in that order. |
| Route and feed integration | `app/api/transit/route.ts`, `app/api/bus-journey/route.ts`, `lib/official-transit.ts` and `lib/processed-bus-journeys.ts` pass directly evaluated results into capture and register request-retained work. Both routes declare `nodejs` and `maxDuration=60`. |
| Supporting evidence types and Redis boundary | `lib/adherence-diagnostics.ts`, `lib/bus-evidence.ts`, `lib/bus-journey.ts`, `lib/redis-evidence-store.ts`, `lib/timetable-adherence.ts`, `lib/transit-data.ts` and `lib/vehicle-progress.ts` supply shared crossing proof, diagnostics and journey types used by the reviewed draft. Redis is optional GPS history persistence under separate `TRANSIT_EVIDENCE_REDIS_*` settings. The planned PostgreSQL Preview uses no Redis binding. |
| Dependencies, safe defaults and regression | `package.json`, `pnpm-lock.yaml`, `.env.example`, `.gitignore` and `tests/classification-evidence.test.ts`. The archive URL is blank and Deferred Admission defaults off. The test exercises immutable evidence, migration compatibility, concurrency, receipt reconciliation and restart recovery using isolated local storage. |

No Production configuration files or deployment settings changed. The commit preserves the existing classification threshold, proof requirements and railway logic. [Evidence capture](../lib/classification-evidence.ts) · [Archive configuration](../lib/classification-evidence-store.ts) · [Environment template](../.env.example)

### Local build and test readiness

| Check | Result |
| --- | --- |
| Unit suite on the reviewed working draft | **353 passed across 28 files**, including 22 archive tests. This count includes supporting tests that remained in the working tree outside the 20-file commit. |
| TypeScript and ESLint | Passed with `tsc --noEmit --incremental false` and `pnpm run lint`. |
| Local production-mode build | Passed on Next.js `15.5.28`. The build included both dynamic transit routes. |
| Chromium and hosted lifecycle | No new runs in this phase. A local build supplies no Vercel lifecycle evidence. |

## Disposable Neon database and isolation

| Item | Verified result |
| --- | --- |
| Provider identity | A fresh [Claimable Neon](https://neon.com/docs/reference/claimable-neon) project, `divine-lake-98736672`, branch `br-orange-feather-bdfm1xng`, in `aws-us-east-2`. Provider registration and credential responses returned the same project and branch IDs. |
| Connection target | Endpoint `ep-cold-base-bd1m7gdy`, database `neondb`, PostgreSQL `17.11`. Direct inspection checked the target and authenticated client TLS with `sslmode=verify-full`. The backend's `pg_stat_ssl` returned false, so it was insufficient to verify the client-to-Neon leg. The initial gate stopped before migration and was rerun with client TLS verification. |
| Schema and isolation | Both archive tables were absent before migration. Applied the archive and outbox migrations in one transaction on the new project. Independent SQL readback found **0 outbox rows and 0 archive rows**. No Production credentials or database connection were used. |
| Runtime role | `outbox_preview_writer` passed a real Neon HTTPS readback against the expected database. It has archive select and insert, outbox select, insert and update, and permission to execute the delivery function. It has no outbox delete or truncate privilege. |
| Observer role | `outbox_preview_observer` independently read both tables. It cannot mutate the outbox or execute the delivery function. Empty tables verify readback access. A durable application receipt has yet to be observed. |
| Secrets and expiry | Credentials are encrypted with Windows DPAPI outside Git. No connection string is recorded here or in the commit. The unclaimed project expires **13 November 2026 at 23:59:55 MYT** (`15:59:55 UTC`). Recheck expiry before reuse. |

For the future fixture run, retain an allowlist of synthetic stable IDs. After workers and leases settle, a separately authorized operator can reconcile and remove only those rows using the isolated database owner role. Preserve sanitized receipt evidence, remove the Preview-only binding after testing, and retire the disposable database or let it expire. The database is currently empty. [Archive migration](../database/classification-evidence.sql) · [Outbox migration](../database/classification-outbox.sql)

## Vercel setup and Production safety

| Check | Observed result |
| --- | --- |
| Existing project and linkage | Authenticated Vercel CLI confirmed `loongmw2021-8669/transit-scope-malaysia`, project `prj_DqTjkYBkW3dmA0hEteczCHOQNVgE`, linked to `Monnwa/TransitScope-Malaysia`. No Vercel project was created. |
| Production target and protection | The project names `master` as Production. Production deployment `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6` and alias `transit-scope-malaysia.vercel.app` were unchanged after the attempt. System environment exposure is enabled. Existing SSO protection is `all_except_custom_domains`. |
| Production environment and archival | CLI found no Production environment variables before setup. Post-attempt project readback found zero project environment variables. The deployed source predates the Outbox and the draft has the explicit `VERCEL_ENV=production` guard. There was no Production invocation, configuration change, database access, promotion or deployment. |
| Branch-scoped environment | The first mutation attempted `TRANSIT_CLASSIFICATION_DEFER_ADMISSION=1` with `--environment preview --git-branch feature/postgres-outbox-preview`. Vercel returned `branch_not_found`. No flag was created. The following secret binding command was never executed. The isolated database URL and deferred flag are both absent from Preview. |
| New Preview URL, deployment ID and source SHA | None. No Git push or deployment occurred. The prior Redis Preview remains ineligible. |
| Hosted logs, database identity and receipts | Project log explorer access was verified in Phase 1.6L. There is no new deployment to inspect, no hosted database binding to attest and no durable receipt from Vercel. The restricted Neon writer and observer checks were performed outside Vercel. |

[Existing Vercel project](https://vercel.com/loongmw2021-8669/transit-scope-malaysia) · [Production deployment](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/AJksjHdwSp7EsyL7cBE82PBySeW6) · [Phase 1.6L provenance](timetable-adherence-evidence-phase1-6l.md) · [Vercel Preview environment scopes](https://vercel.com/docs/environment-variables)

## Remaining blocker and handoff

Vercel needs the GitHub branch before it accepts branch-scoped settings. The Phase 1.6M stop condition requires those settings before deploying. **No push was made.** The settings were not widened to other Preview branches.

The smallest workflow change is explicit authorization for an **archive-disabled bootstrap Preview** of the exact feature branch. With no database URL, that build cannot start the archive. Once the GitHub branch exists, add the branch-scoped writer secret and `TRANSIT_CLASSIFICATION_DEFER_ADMISSION=1`, then build a new Preview for the same reviewed SHA. Vercel applies changed environment settings to new deployments. Verify the new deployment target, SHA, protected URL, isolated binding, Production baseline, log access and receipt readback capability before allowing fixture requests. [Vercel Git deployment behaviour](https://vercel.com/docs/git/vercel-for-github) · [Vercel environment changes](https://vercel.com/docs/environment-variables/managing-environment-variables)

**Phase 1.6K remains blocked.** No hosted lifecycle test traffic was sent. The report is outside the source commit.
