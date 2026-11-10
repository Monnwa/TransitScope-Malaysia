# Phase 1.6O — Explicit archival activation guard

Commit `7b73d7b` created the PostgreSQL archive whenever a nonempty writer URL was configured outside Vercel Production. Setting Deferred Admission to `0` selected awaited admission. A Neon binding could therefore enable writes on an ordinary Preview request.

The initializer now requires `TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED` to be exactly the lowercase string `true`. The default is `false`. Missing, blank, padded, numeric and unrecognized values fail closed. Vercel Production returns before archive construction even when the switch is `true`. Outside Production, explicit opt-in requires a PostgreSQL writer URL with a host, user and database, plus valid archive retention. [Environment template](../.env.example) · [Archive initializer](../lib/classification-evidence-store.ts)

Before accepting evidence, the feed processor runs a read-only readiness check with a 1.5-second deadline. It checks the two versioned relations, the delivery function and the writer's required privileges. Concurrent checks share an in-flight query. Later processing can check again after a failure. The post-response worker also checks readiness before flushing. When readiness fails, the feed uses the ordinary journey path without accepting candidates, dispatching an outbox write or scheduling deferred admission. The check does not supply a fallback archive. [Readiness and worker](../lib/classification-evidence-store.ts) · [Feed integration](../lib/processed-bus-journeys.ts)

## Activation matrix

| Environment | Enable switch | Writer and schema | Deferred Admission | Result |
| --- | --- | --- | --- | --- |
| Vercel Production | Any | Any | Any | Disabled. No archive client or staging. |
| Preview or local | Missing, `false` or invalid | Any | Any | Disabled. No archive client, database query or staging. |
| Preview or local | `true` | Missing or malformed URL, or invalid retention | Any | Disabled before archive construction. |
| Preview or local | `true` | URL valid, connection, migrations or writer grants unavailable | Any | Disabled for the processing cycle. The read-only check fails and no new candidate is staged or written. |
| Preview or local | `true` | Writer and schema ready | Missing or `0` | Journey response awaits admission. |
| Preview or local | `true` | Writer and schema ready | `1` | Admission is retained through the request scheduler when available. Without a scheduler, the journey response awaits admission. |

The switch is server-only and is read from the environment when the server module initializes. A fresh runtime can use a value different from the build environment. An existing deployment needs a fresh server initialization with the new environment. The readiness check adds a bounded read to enabled processing. PostgreSQL can still become unavailable between a successful probe and the next operation, which remains subject to the existing failure and retry handling. [Next.js runtime environment variables](https://nextjs.org/docs/15/app/guides/environment-variables)

## Local verification

| Check | Result |
| --- | --- |
| Full unit suite | **374 passed across 28 files**, including 43 tests in the classification evidence suite. |
| TypeScript | `pnpm exec tsc --noEmit --incremental false` passed. |
| ESLint | `pnpm run lint` passed. |
| Production build | `pnpm run build` passed on Next.js 15.5.28 and included both dynamic bus routes. |

Tests exercise the switch values, writer validation, Production override and a fresh server initialization with a different flag. Eligible fixture journeys produced zero staging calls, zero archive transport calls and no outbox intent with archival disabled in either admission mode. The missing-migration test preserved the complete journey result and observed only read-only probes. Connection failure and a read-only role both failed readiness. The existing admission-boundary tests exercised awaited and deferred dispatch with a ready database. [Activation and outbox tests](../tests/classification-evidence.test.ts)

## Preview preflight and Production safety

The local commit is on `feature/postgres-outbox-preview`, based on `7b73d7b964c4db7dc66b9f91438cbc8b2aa48abf`. The local `master` ref remains at `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. This phase used local validation and made no deployment or infrastructure calls. The existing bootstrap `dpl_9C2z9w9jsjw61Ae8J1dHF2Twtb2D` still uses the previous SHA. The last verified Production deployment is `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6`, where archival is disabled.

A later Preview preflight requires separate authorization to push and deploy this commit. Verify the deployment SHA, then scope the isolated Neon writer URL to the Preview branch with `TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED=false`. Use the separate observer connection to verify the database, migrations and receipt query access. Verify the disposable database is still available before binding it. A hosted Neon-bound preflight and Phase 1.6K lifecycle verification remain pending.
