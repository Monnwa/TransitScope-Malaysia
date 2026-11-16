# Phase 1.6L — Isolated PostgreSQL Outbox Preview establishment

## Outcome

**The existing Vercel project and its Production source are verified. An isolated Outbox Preview is still blocked.** The signed-in dashboard identified the newest Preview as the Phase 1.4 Redis build. The Outbox draft has no commit in the local repository, and the project shows no PostgreSQL binding. Production still serves the earlier Git revision, whose source lacks the Outbox. This phase stopped after read-only inspection on 10 November 2026, Malaysia Time. It created no resources and ran no hosted lifecycle scenarios. [Existing Vercel project](https://vercel.com/loongmw2021-8669/transit-scope-malaysia) · [Phase 1.6K report](timetable-adherence-evidence-phase1-6k.md)

## Repository and deployment provenance

| Item | Verified finding |
| --- | --- |
| Repository and branch | The Vercel project links to `Monnwa/TransitScope-Malaysia`, matching Git `origin`. The local branch is `master`, and the dashboard identifies `master` as the Production branch. Local `HEAD` and cached `origin/master` both point to `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. The terminal could not resolve `github.com` for an independent live ref check. |
| Outbox revision | No Outbox implementation commit was found in local refs. The archive modules and SQL migrations are untracked. Route integration, journey processing and dependency changes are in the working tree. The current HEAD contains neither the archive modules and migrations nor the archive wiring in the transit route. HEAD cannot serve as the Outbox source identifier. |
| Existing Vercel project | The signed-in `loongmw2021-8669` workspace shows `transit-scope-malaysia`, project ID `prj_DqTjkYBkW3dmA0hEteczCHOQNVgE`. It matches the archived Phase 1.4 project record. The local checkout has no `.vercel/project.json` and no verified CLI session. Dashboard linkage and local CLI linkage are separate. |
| Active Production | The dashboard shows deployment `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6` as **Ready**, with branch `master` and Git SHA `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. The Production alias is `transit-scope-malaysia.vercel.app`. The deployed SHA matches the local pre-Outbox source tree. |
| Project runtime defaults | Vercel project settings show Next.js, Node.js `26.x`, Fluid Compute enabled, region `iad1`, and Standard functions with 1 vCPU and 2 GB memory on Hobby. These are project settings. Record effective per-deployment settings for the eventual Outbox Preview. |
| Outbox draft runtime | The lockfile resolves Next.js `15.5.28` and `@neondatabase/serverless` `1.2.0`. Both `/api/transit` and `/api/bus-journey` declare `runtime = "nodejs"` and `maxDuration = 60`. The routes use Next.js `after` for deferred work and a request-triggered flush. The adapter sets a 1.5-second HTTPS query timeout and a 2.5-second admission operation budget. These are source settings. |

[Vercel project ID](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/settings#project-id) · [Production deployment](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/AJksjHdwSp7EsyL7cBE82PBySeW6) · [Build settings](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/settings/build-and-deployment) · [Function settings](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/settings/functions) · [Transit route](../app/api/transit/route.ts) · [Bus journey route](../app/api/bus-journey/route.ts)

## Preview identification

| Field | Newest Preview in the project inventory |
| --- | --- |
| Deployment URL | `https://transit-scope-malaysia-dnrz1u748-loongmw2021-8669.vercel.app` |
| Deployment ID | `dpl_BLUnMJPf2janeWvsDFiXnx48HURy` |
| Target and build | **Preview**, **Ready**, 9 November 2026. Vercel labels the source `vercel deploy`. |
| Git branch and SHA | Vercel does not display a Git branch or commit for this CLI source upload. The historical workspace HEAD is recorded separately and does not identify the uploaded tree. |
| Runtime | Phase 1.4 records Node.js `26.x` in `iad1`. |
| Persistence and flags | Phase 1.4 used deployment-only Redis settings with a 60-minute retention window. Vercel's uploaded source shows `lib/bus-evidence.ts` and `lib/redis-evidence-store.ts` and does not show the classification archive modules. No Outbox flag or PostgreSQL binding was established for this deployment. |
| Suitability | **Ineligible.** The Preview validated Redis GPS history persistence. Its source cannot exercise the PostgreSQL Outbox. No suitable deployment was found in the project inventory. |

[Vercel deployments](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/deployments) · [Historical Preview details](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/BLUnMJPf2janeWvsDFiXnx48HURy) · [Uploaded source](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/BLUnMJPf2janeWvsDFiXnx48HURy/source) · [Phase 1.4 records](timetable-adherence-evidence-phase1-4.md)

## PostgreSQL configuration and isolation

The project Environment Variables page showed **No Environment Variables Added** with All Environments selected and system environment variable access enabled. Project Storage showed the unconnected database state. These are current project settings. Historical CLI deployments can carry deployment-specific settings. No current Preview PostgreSQL binding, isolated database identity, or readback access was available to verify. Prior Phase 1.6H managed HTTPS evidence belongs to an isolated local harness and establishes no Vercel binding. No database connection was made in this assessment. [Project environment settings](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/settings/environment-variables) · [Project Storage](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/stores) · [Phase 1.6H](timetable-adherence-evidence-phase1-6h.md)

| Server-side setting | Required scope and behaviour |
| --- | --- |
| `VERCEL_ENV` | Vercel supplies `preview` on the intended deployment. The archive guard returns early for the exact value `production`. A missing marker does not trigger that guard, so the Production URL must also be absent. |
| `TRANSIT_CLASSIFICATION_DATABASE_URL` | Keep absent in Production. Set only for the dedicated validation Preview after isolation is proven. Give `neon()` the provider-issued `postgresql://` connection string for the isolated host, database and role. The driver sends queries over HTTPS. Use the server-side secret store. A bare `DATABASE_URL` does not enable this archive. |
| `TRANSIT_CLASSIFICATION_DEFER_ADMISSION` | Defaults off. Set `1` only for the validation Preview to exercise Deferred Admission. Setting this flag to `0` selects awaited admission when a database URL is configured. Remove or omit the URL for an archive-disabled control. |
| `TRANSIT_CLASSIFICATION_RETENTION_DAYS` | Defaults to 7 and accepts integer values from 1 to 30. Record the effective setting. Logical expiry does not replace fixture cleanup. |
| `TRANSIT_EVIDENCE_REDIS_REST_URL`, `TRANSIT_EVIDENCE_REDIS_REST_TOKEN`, `TRANSIT_EVIDENCE_RETENTION_MINUTES` | Separate Redis GPS observation persistence, with a 60-minute default. Redis restores observations used during journey processing. PostgreSQL stores immutable classification evidence and delivery receipts. Leave Redis unbound for the initial Outbox test unless a separately isolated Redis fixture is required. |

[Environment template](../.env.example) · [Archive adapter and Production guard](../lib/classification-evidence-store.ts) · [Redis adapter](../lib/redis-evidence-store.ts) · [Neon HTTPS driver](https://neon.com/docs/serverless/serverless-driver) · [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)

## Runtime observability and Production safety

| Check | Evidence and limit |
| --- | --- |
| Function log access | The signed-in project Runtime Logs view opened and accepted a filter for `dpl_BLUnMJPf2janeWvsDFiXnx48HURy`. It showed no matching entries in the selected window. Access to the explorer is verified. A current Outbox request or invocation ID could not be collected. |
| Request and invocation correlation | Vercel documents `deploymentId`, `requestId` and `invocationId` for filtering runtime logs. Existing archive warnings summarize pending, rejection, timeout and recovery activity. They do not provide a complete per-candidate staging, dispatch and acknowledgement trace. An independently retained fixture manifest is still required to correlate a candidate ID to hosted invocations. |
| Outbox rows, durable receipts and worker states | The SQL defines one outbox row per `record_id`, attempt and retry state, and settlement fields. Independently read a known ID and join `PERSISTED` or `RECOVERED` to the archive row and expected checksum. A `PENDING` row proves durable intent and pending delivery. `enqueued_at_ms` and `settled_at_ms` do not establish exact database commit time. No hosted rows, retry transitions or receipts were accessible in this phase. |
| Production archival | Verified disabled for the currently identified Production revision. Its deployed source has no PostgreSQL Outbox, and the project environment list showed no archive variables. The reviewed draft also has the explicit Production marker guard. Effective Preview-only credential scoping remains a gate for the next deployment. |
| Production writes and functionality | This phase used only local reads and Vercel dashboard reads. It did not invoke the Production transit routes or connect to a database. No Production writes, deployment promotion, domain change or configuration change occurred. The dashboard still identifies the existing Ready Production deployment. No live functionality tests were run. |
| Future fixture isolation | Cannot yet be proven. There is no authorized, verifiable Preview database binding or synthetic-only hosted fixture path. A real feed request to an archive-enabled deployment could generate real candidates, so the Preview must be access-protected and fixture controls verified before sending archive-enabled traffic. |

[Filtered Runtime Logs](https://vercel.com/loongmw2021-8669/transit-scope-malaysia/logs?search=deploymentId%3Adpl_BLUnMJPf2janeWvsDFiXnx48HURy) · [Vercel log fields](https://vercel.com/docs/logs/runtime) · [Outbox schema](../database/classification-outbox.sql) · [Phase 1.6J evidence accounting](timetable-adherence-evidence-phase1-6j.md#candidate-lifecycle-accounting)

## Procedure for resuming Phase 1.6K

These steps require explicit authorization before any commit, push or deployment. The project identity and Production branch are already verified. Use the existing project and GitHub repository.

1. **Establish immutable source provenance.** Review the exact draft files, migrations and lockfile intended for Preview. Exclude secret files, previous validation outputs and build artifacts. After approval, commit the reviewed snapshot on a dedicated non-Production branch such as `codex/outbox-preview-validation`. Record its full SHA and tree. A push can trigger a Vercel build, so approve it as a deployment action. Keep `master` and the existing Production alias outside the workflow. [Vercel GitHub deployments](https://vercel.com/docs/git/vercel-for-github)
2. **Verify the isolated database before binding.** The operator should identify an approved dedicated Neon database, ideally in a separate test project, or explicitly authorize creation of a disposable isolated database. Use an empty database or a test-only branch with no copied Production records. Independently compare provider project, branch and endpoint identity with the target database and role over read-only SQL. `current_database()` alone is insufficient because names can repeat across environments. Apply `classification-evidence.sql` followed by `classification-outbox.sql` using the isolated migration role. Confirm both versioned tables, the delivery function and empty fixture state. Give the runtime role only the required table and function privileges in the test database. Use a separate read-only observer and a scoped operator cleanup role. Record a redacted identity and privilege check. [Evidence migration](../database/classification-evidence.sql) · [Outbox migration](../database/classification-outbox.sql) · [Neon branching](https://neon.com/docs/introduction/branching)
3. **Scope the deployment and secrets.** Keep the Preview protected. Use branch-specific Preview settings for the secret and deferred flag, or settings restricted to the approved Preview deployment. Verify both project and inherited settings leave the archive URL and deferred flag absent from Production. If Vercel needs the branch to exist before scoping it, an explicitly approved archive-disabled Preview can establish the branch first. After adding Preview-only settings, require a new Preview build for that exact SHA because existing deployments retain their prior environment. Verify `Preview`, `Ready`, deployment URL and ID, branch, full SHA and effective Node.js, region, memory, Fluid Compute and duration. Compare the active Production deployment ID and domain to the baseline. [Vercel environment scopes](https://vercel.com/docs/environment-variables) · [Environment changes and existing deployments](https://vercel.com/docs/environment-variables/managing-environment-variables)
4. **Prove the evidence path and cleanup.** Confirm the deployed binding matches the independently verified isolated endpoint and role using approved deployment metadata and a secret-safe check. Verify access to scoped Vercel logs and SQL readback for the same Preview. Prepare the protected synthetic fixture path and an external manifest of stable IDs, checksums and observed acceptance events. Existing logs alone cannot prove a complete accepted cohort. Define a cleanup allowlist of fixture IDs, settle outstanding work and leases before deletion, and retain only sanitized readback evidence. Abort if the deploy-to-database link or fixture isolation remains uncertain.
5. **Return to Phase 1.6K only after the gates pass.** Attach the deployment provenance, Production safety check, database proof, evidence-access checks and cleanup scope. Start with the normal admission scenario and the archive-disabled journey control. Run the fault scenarios only after a known synthetic ID can be traced from acceptance to a verified receipt. Leave platform timeout or eviction **UNVERIFIED** where provider evidence is unavailable. [Phase 1.6J scenario matrix](timetable-adherence-evidence-phase1-6j.md#scenario-matrix)

### Minimum remaining user actions

| Blocker | Minimum action |
| --- | --- |
| No Outbox SHA or suitable Preview | Authorize the reviewed snapshot and Preview-only commit, push and deployment on the existing project, or identify an existing approved Preview with a matching full SHA and source manifest. |
| No independently verified PostgreSQL binding or receipts | Identify an approved isolated PostgreSQL database and arrange Preview-only runtime and read-only observer access through the secret store. If none exists, authorize a disposable isolated database before provisioning. Credentials should stay out of chat and reports. |
| No hosted candidate-to-invocation proof | Use the verified dashboard log access and approve the separate protected fixture run, its observation access and cleanup. If specific Vercel lifecycle telemetry is unavailable, leave the affected scenarios open. |

Phase 1.6L added this assessment only. The Outbox architecture and application source were untouched. Production archival remains disabled. No hosted validation, commit, push, deployment or provisioning took place.
