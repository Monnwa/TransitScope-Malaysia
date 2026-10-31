# Deployment preparation

## Current status

No public deployment has been performed and no URL exists. The Next.js production build succeeds locally. The official API needs no token. Production hosting must permit server-side outbound HTTPS requests to `api.data.gov.my`; no upstream URL or secret is exposed to the frontend.

## Vercel deployment steps

1. Create a Git repository remote and push this workspace.
2. Import the repository into Vercel as a Next.js project.
3. Use the default build command, `pnpm build`, and publish.
4. Confirm the public URL loads, map tiles have attribution, filters work and the SIMULATED disclosure is visible.
5. Confirm the `/api/transit` route can fetch the official upstream service. It caches realtime responses for 30 seconds and static GTFS sources for 24 hours, reducing unnecessary upstream requests.
6. Add `NEXT_PUBLIC_*` variables only if a future provider adapter requires non-secret public configuration. Store private provider credentials in server-only Vercel variables.
6. Update the presentation with the actual URL. Never replace it with an assumed URL.
