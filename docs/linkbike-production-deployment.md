# Phase SM-1.5 — LinkBike Production deployment preflight

**TransitScope Malaysia · 12 November 2026 (MYT)**

**NO-GO. Deployment stopped at preflight.** The existing Production domain is publicly accessible, the LinkBike gate rejects Production, and the intended changes are mixed with other uncommitted work. Vercel denied read access to the current project configuration, so Production and Preview variable scopes and rollback eligibility could not be confirmed.

## Repository and release provenance

| Item | Evidence |
| --- | --- |
| Current local branch | `feature/postgres-outbox-preview` at `3bb0e2a48f3c1047b886c79a9c2497961de78d45`. GitHub reports the same SHA for that branch. |
| Existing GitHub repository and production branch | Git remote `Monnwa/TransitScope-Malaysia`. A read-only remote query confirmed that `HEAD` points to `master` at `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. The repository runbook identifies `master` as the connected Production branch. [GitHub repository](https://github.com/Monnwa/TransitScope-Malaysia) · [Deployment runbook](deployment.md) |
| Worktree at the start of preflight | 12 modified tracked files and 59 untracked status entries, with zero staged files. LinkBike implementation and tests are mixed with uncommitted station operations, official alerts, timetable-adherence evidence and generated TypeScript metadata. The dashboard file itself includes changes from multiple workstreams. |
| Completed SM-1.3 and SM-1.3.1 work | Server-side station parsing and coordinate validation, five-minute caching, failure handling, independent map controls and station details, the Preview/local gate, and the evidence-based train grouping test correction. The latest LinkBike work has no release commit. [Implementation and changed files](linkbike-experimental-integration.md) · [Regression audit](linkbike-regression-audit.md) |
| Existing Vercel project | `transit-scope-malaysia`, project ID `prj_DqTjkYBkW3dmA0hEteczCHOQNVgE`, per the repository release evidence. Live project linkage was not re-confirmed through the management API. [Prior Production release record](timetable-adherence-evidence-phase1-7-production-readiness.md) |
| Production URL | [transit-scope-malaysia.vercel.app](https://transit-scope-malaysia.vercel.app/) responded from Vercel during this preflight. |
| Production deployment ID | No SM-1.5 deployment was created. The previous release record, captured at 17:58 MYT on 12 November, shows `dpl_CJooTQJvR5shgicdzRDA6truhJyG` as Ready and assigned to the canonical domain. That record identifies a direct upload of reviewed source tree `f64363ece5e64800eddaa5e1494812449e9e6e6b`. The current alias-to-deployment assignment could not be re-confirmed from Vercel. [Prior alias readback](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-production-release/production-published.json>) |

The mixed Preview worktree was left intact. No commit, push, source package upload or domain reassignment was performed.

## Access restriction and environment scope

| Check | Result |
| --- | --- |
| Anonymous request to the canonical Production domain | **Failed protection check.** A cookie-free GET with redirects disabled returned HTTP 200 and the TransitScope dashboard. It did not return a Vercel sign-in challenge. |
| Anonymous LinkBike endpoint request | `GET /api/micromobility/linkbike` returned HTTP 404 with an HTML response. This confirms the public endpoint did not serve LinkBike inventory. |
| Vercel Deployment Protection capability | Vercel documents **All Deployments** as the scope covering the canonical Production domain. Standard Protection excludes that domain. No protection setting was changed. The project's live protection method, exceptions and settings permissions remain unverified. [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection#all-deployments) |
| Production and Preview environment scopes | Vercel’s authenticated project and environment metadata GETs returned HTTP 403 using the existing session. Binding and scope for `NEXT_PUBLIC_ENABLE_LINKBIKE_LAYER` and `LINKBIKE_REFRESH_SECONDS` remain unverified. No values were retrieved or changed. |
| Server-side gate | **Failed Production enablement check.** The page and API both use `linkBikeEnabled`. With the public flag true, the function permits local Next.js development or Vercel when both environment identifiers are `preview`. With both set to `production`, the API returns 404 and the page omits the toggle. The SM-1.3.1 local production-mode build verified 404, zero controls and zero browser LinkBike requests. Setting `LINKBIKE_REFRESH_SECONDS=300` controls cadence and does not affect the gate. [Feature gate](../lib/linkbike-data.ts) · [Page](../app/page.tsx) · [Route](../app/api/micromobility/linkbike/route.ts) · [Regression audit](linkbike-regression-audit.md#api-reliability-and-environment-restrictions) |
| Rollback | Vercel’s authenticated deployment lookups returned HTTP 403. The prior deployment record establishes the last documented Ready alias assignment. Current rollback target eligibility and permission remain unverified. Vercel documents the immediately previous deployment as the Hobby rollback target and restores the target deployment’s existing configuration. Confirm the exact current deployment and eligible rollback before staging a release. [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback) |

## Verification evidence and limitations

The SM-1.3.1 local audit passed 446 unit tests and 107 browser checks across enabled and disabled runs, plus TypeScript, ESLint and a production-mode build. It included all 100 existing transit checks. The prior train marker failure was traced to 12 estimates intentionally sharing six icons. The corrected test verifies group membership, with train logic unchanged. The enabled local API returned 27 unverified candidates, of which 26 passed coordinate checks. Browser checks covered the independent map toggle, station popup, manual zoom, failure clearing, and widths of 390px, 768px and 1440px. The layer currently starts off behind its own toggle. [Test and local API evidence](linkbike-regression-audit.md)

This phase verified the canonical domain’s anonymous HTTP behavior only. Production post-deployment checks for LinkBike, transit interactions, refresh, browser bundles and mobile layout did not run because no deployment was created. The prior local results are not evidence of a deployed release. No new deployment screenshots exist.

LinkBike counts describe reported bicycles. They do not establish rentability, true observation time, usable free docks, or confirmed public station access. The maintenance portal remains an undocumented source and no operator authorization was established. Keep the experimental label, separate retrieval and raw portal times, and the existing failure and coordinate handling in any reviewed candidate.

## Conditions for resuming

1. Review an exact release candidate based on the intended Production source. Include the approved LinkBike changes while preserving the other working-tree changes and excluding unrelated Preview experiments.
2. Restore authorized read access to the existing Vercel project. Confirm Git linkage, Production and Preview scopes, the canonical domain's active deployment and a Ready, eligible rollback target.
3. Establish access protection on the existing Production domain before enabling the experiment. Verify that an anonymous client cannot load the dashboard or API and that the intended audience can sign in.
4. Review a Production-specific enablement path that honors the protection requirement and retains the gate for other Production builds. The current implementation has no such path through the two requested settings. Validate the exact candidate before staging a deployment.

**Final deployment status: blocked.** Production and Preview settings were left unchanged.
