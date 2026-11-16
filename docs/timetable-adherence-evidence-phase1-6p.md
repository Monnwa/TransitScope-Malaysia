# Phase 1.6P — Neon-bound Vercel Preview validation

The Neon-bound Preview is **Ready** at `d1f9c3ffa27008a0df7491e024d5679b780fa1a2` with archival disabled. It served live transit responses and left both PostgreSQL tables empty. The live comparisons exposed different retained crossing histories across deployments, so they could not establish journey parity with equivalent inputs. The disabled-mode parity gate remains open. Preview opt-in and Phase 1.6K remain pending.

## Source and deployments

| Item | Verified result |
| --- | --- |
| Source and push | Confirmed local branch `feature/postgres-outbox-preview`, HEAD `d1f9c3ffa27008a0df7491e024d5679b780fa1a2` and the explicit activation guard. Pushed that commit from a clean temporary checkout to the existing GitHub feature ref. |
| Project and linkage | `loongmw2021-8669/transit-scope-malaysia`, project `prj_DqTjkYBkW3dmA0hEteczCHOQNVgE`, linked to `Monnwa/TransitScope-Malaysia`. The previous bootstrap was verified before the push. |
| Initial disabled Preview | `dpl_Gz1j3yYKWk4XAZorovX3HY1gk2Jg`, created 11 November 2026 at 00:26:35 MYT, Ready at the authorized SHA. `TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED=false`, with no writer URL. |
| Neon-bound disabled Preview | `dpl_EG9o19YJtDJmqLTvTwJERyiw9KCs`, created 11 November 2026 at 00:29:17 MYT, Ready at the same SHA and branch. The deployment metadata included both archive environment keys. |
| Production | GitHub `master` remained `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. Vercel still identified `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6` as Production and `transit-scope-malaysia.vercel.app` as its primary alias. The project had zero Production archive variables and zero protection bypass credentials. Protection remained `all_except_custom_domains`. |

[GitHub commit](https://github.com/Monnwa/TransitScope-Malaysia/commit/d1f9c3ffa27008a0df7491e024d5679b780fa1a2) · [Initial Preview](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/Gz1j3yYKWk4XAZorovX3HY1gk2Jg) · [Neon-bound Preview](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/EG9o19YJtDJmqLTvTwJERyiw9KCs) · [Protected Neon-bound URL](https://transit-scope-malaysia-foc6l6xk5-loongmw2021-8669.vercel.app)

## Neon configuration and readiness

The disposable Claimable Neon project `divine-lake-98736672`, branch `br-orange-feather-bdfm1xng`, endpoint `ep-cold-base-bd1m7gdy`, database `neondb`, was reachable on PostgreSQL 17.11. Both role URLs matched the isolated endpoint and database. The writer `outbox_preview_writer` passed a read-only check over Neon HTTPS for both versioned tables, required writer grants and the delivery function. The separate observer `outbox_preview_observer` connected with verified TLS, read the outbox and archive tables, and lacked outbox mutation and delivery privileges. The availability check used the already-provisioned test project and made no database writes. Its scheduled expiry is 13 November 2026 at 23:59:55 MYT. [Neon project expiry](https://neon.com/docs/reference/claimable-neon)

The server-only `TRANSIT_CLASSIFICATION_DATABASE_URL` was submitted as a sensitive variable via standard input. Vercel readback showed it and `TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED` scoped only to `preview` and the exact feature branch. The observer connection stayed outside Vercel. The flag was set to `false` before the first push and remained false through the bound rebuild. The deployed initializer exits before constructing a database client in this state. The external read-only probe independently verified schema and role access while the deployed archive stayed disabled. [Branch-scoped Vercel variables](https://vercel.com/docs/environment-variables) · [Archive initialization guard](../lib/classification-evidence-store.ts)

## Disabled live-route results

The initial Preview dashboard rendered the Malaysia transport overview and showed an official update at 00:28:25 MYT. Authenticated browser requests exercised the real `/api/transit` route on both deployments. Every recorded sample below was HTTP 200 and showed all four feeds healthy. No CLI protection helper or bypass credential was used.

| Response times MYT, initial and bound | Transit records, initial / bound | Bus journeys, initial / bound | Classified stops, initial / bound | Same vehicle and measurement timestamp | Matching selected journey and stop fields |
| --- | ---: | ---: | ---: | ---: | ---: |
| 00:30:17.799 and 00:30:40.063 | 12 / 12 | 11 / 11 | 3 / 0 | 11 | 5 |
| 00:31:30.436 and 00:31:34.698 | 12 / 12 | 10 / 10 | 3 / 0 | 1 | 1 |
| 00:32:16.091 and 00:32:16.722 | 11 / 11 | 10 / 10 | 5 / 0 | 10 | 5 |

The closest pair reached Vercel one millisecond apart. Request IDs were `62fl6-1794328335162-5d95b957f6c9` on the initial deployment and `62fl6-1794328335163-124afc03f98d` on the bound deployment. The returned tracking histories held 12 passages and two passages respectively. Six of the ten timestamp-matched journeys had matching adherence fields. The paired requests therefore matched on observed GPS timestamps but had different crossing evidence. The measurements do not establish a change caused by the binding or demonstrate parity under identical history. The authorized deployment has no hosted fixture replay control to hold this input constant. [Transit handler](../app/api/transit/route.ts) · [Journey history and classification processing](../lib/processed-bus-journeys.ts)

The Neon observer found **0 outbox rows and 0 archive rows** at 00:30:04.938 MYT before the bound samples and again at 00:33:10.555 MYT after all samples. The bound deployment's log query returned three successful `/api/transit` requests and no archive-related log lines. The false switch and initializer establish that no archive instance could stage candidates or attempt a write. Staging is not exposed as an independent hosted counter. The Phase 1.6O local fixture separately exercised eligible journeys with a disabled writer configuration and observed zero capture or database transport calls. [Activation tests](../tests/classification-evidence.test.ts)

## Opt-in and reconciliation status

| Verification | Synchronous admission | Deferred Admission |
| --- | --- | --- |
| Successful archival and original snapshot preservation | Unexecuted | Unexecuted |
| Duplicate and concurrent same-ID submissions | Unexecuted | Unexecuted |
| Lost acknowledgement, retries and terminal receipt deduplication | Unexecuted | Unexecuted |
| Database interruption and reconnection | Unexecuted | Unexecuted |
| Writer permission failure and missing or invalid schema | Unexecuted | Unexecuted |
| Application restart after PostgreSQL commit | Unexecuted | Unexecuted |
| Application termination before and after PostgreSQL commit | Unexecuted | Unexecuted |

No enabled cohort was generated. Exact eligible, admitted, rejected, pending, recovered and unreconciled candidate counts are unavailable for enabled processing. A count of classified stops in a journey response does not identify every directly evaluated archive candidate. No lost acknowledgement, retry, database error, restart or termination was injected or verified in the enabled path. The only database counts are the observed zero rows during disabled processing. No loss rate or exactly-once claim follows from these checks.

Future reconciliation must distinguish volatile staging, a committed PostgreSQL outbox intent, the archived evidence row, and its terminal receipt. A disabled route exercises none of the delivery transitions. Vercel eviction and invocation-timeout recovery remain unverified. [Outbox schema](../database/classification-outbox.sql)

Production archival remains disabled. Preview also remains disabled with the isolated writer binding in place. Establish an equivalent-input and equivalent-history comparison before crossing the opt-in gate. The existing commit and report are the only source and documentation changes involved in this phase respectively. No application code changed, so the Phase 1.6O unit, TypeScript, ESLint and build results were carried forward. Both Vercel Preview builds completed successfully. [Phase 1.6O local verification](timetable-adherence-evidence-phase1-6o.md#local-verification)
