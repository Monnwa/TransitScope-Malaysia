# Deployment

## Existing production service

- Repository: https://github.com/Monnwa/TransitScope-Malaysia
- Production branch: `master`
- Existing Vercel project: `transit-scope-malaysia`
- Production URL: https://transit-scope-malaysia.vercel.app/

Preserve this repository, Vercel project, domain and deployment configuration. Publishing to the existing branch triggers the connected Vercel deployment.

## Release authorization

On 8 November 2026, the project owner approved deployment of the automatic bus journey/adherence fix and instructed: **subsequent changes may be deployed directly without asking for approval again**. This standing authorization applies to this project's ordinary releases after the necessary checks pass. It does not waive validation or authorize unrelated project/account changes.

## Release workflow

1. Review the exact diff and preserve unrelated local changes.
2. Run the required unit/browser regressions, TypeScript, ESLint and optimized production build. Documentation-only changes do not require rerunning application tests.
3. Commit only the intended changes and push to the existing GitHub branch. Do not force-push.
4. Verify the deployment status for the exact pushed commit.
5. Check the public page and official API, including shared bus processing, scheduled/estimated distinctions and map/station refresh behavior. Report material failures and resolve them before treating the release as complete.

## Runtime data

The official API requires no token. Hosting must permit server-side HTTPS requests to `api.data.gov.my`. Realtime feed ingestion is shared and cached for 30 seconds; static GTFS data is cached for 24 hours. Processed fleet responses use `no-store` so callers receive current freshness/processing results. Full fleet results use negotiated gzip compression and an explicit response-size fallback.

Do not expose private credentials in frontend configuration. No paid tracking service or extra deployment infrastructure is required for the current implementation.
