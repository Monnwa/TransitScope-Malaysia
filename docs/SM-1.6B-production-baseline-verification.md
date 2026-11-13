# SM-1.6B — Production baseline verification

**TransitScope Malaysia · 13 November 2026 (MYT)**

The Production source was restored and verified in the new local worktree on `codex/linkbike-direct-production` before applying any LinkBike changes. HEAD is GitHub `master` commit `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. Vercel deployment `dpl_G5fdXzqSsERpUHCtHFGdo8ZXH1zM` and archive manifest `f17c26abf1d286d13c53514179f4dd77a16e440ba0c8e8fe82271eb2cab5358f` are the identities verified in SM-1.6A. The archived deployment and upload records agree on both identities. [SM-1.6A reconciliation](../../linkbike-hci-production/docs/SM-1.6A-production-source-reconciliation.md)

## Verification before applying LinkBike

- Restored all **120** source files. Recomputed SHA-1 on the archived bytes and restored bytes and checked both against the manifest. Also checked the archived size and Windows regular-file mode `0100666` on both copies. The Git mode for pre-existing uploaded files is `100644`.
- Compared the uploaded bytes against the Git blobs. One was identical, 96 differed only by CRLF, 12 had substantive edits and 11 were new. Worktree files that already matched were left in place. Git did not report line-ending-only changes.
- Retained all **34** tracked paths outside the upload, under `docs/` and `presentation/` plus `.gitignore`. The two upload directory placeholders are represented by those existing directories.
- Materialized the archive's classification and outbox source, schema and tests. Its Production-disabled guard and recorded archive-off status were preserved. The restore neither connected to a database nor ran migrations.

## Exact substantive inventory

| Status | File |
| --- | --- |
| Modified | `app/api/bus-journey/route.ts` |
| Modified | `app/api/transit/route.ts` |
| Modified | `components/dashboard.tsx` |
| Modified | `components/upcoming-departures.tsx` |
| Modified | `lib/alert-classifier.ts` |
| Modified | `lib/official-alert-model.ts` |
| Modified | `lib/official-alerts.ts` |
| Modified | `lib/official-transit.ts` |
| Modified | `lib/processed-bus-journeys.ts` |
| Modified | `package.json` |
| Modified | `pnpm-lock.yaml` |
| Modified | `tests/official-alerts.test.ts` |
| Added | `.env.example` |
| Added | `.vercelignore` |
| Added | `app/station-operations.css` |
| Added | `components/station-operations.tsx` |
| Added | `database/classification-evidence.sql` |
| Added | `database/classification-outbox.sql` |
| Added | `lib/classification-evidence-store.ts` |
| Added | `lib/classification-evidence.ts` |
| Added | `lib/station-operations.ts` |
| Added | `tests/classification-evidence.test.ts` |
| Added | `tests/station-operations.test.tsx` |

The dashboard, departure board and station components preserve the deployed station and Bandar Tasik Selatan hub experience. The alert model, classifier and parser preserve ERL, scoped notices and source status behavior. The transit and bus journey routes, associated libraries and package graph preserve the existing API contracts and conditional archive/outbox plumbing. The deployed railway, train positions, timetable and other source files were verified within the full 120-file comparison. No Vercel management operation was needed for this restoration.

