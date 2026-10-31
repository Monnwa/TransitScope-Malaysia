# Deployment preparation

## Current status

No public deployment has been performed and no URL exists. The Next.js production build succeeds locally. The project contains no environment secrets.

## Vercel deployment steps

1. Create a Git repository remote and push this workspace.
2. Import the repository into Vercel as a Next.js project.
3. Use the default build command, `pnpm build`, and publish.
4. Confirm the public URL loads, map tiles have attribution, filters work and the SIMULATED disclosure is visible.
5. Add `NEXT_PUBLIC_*` variables only if a future provider adapter requires non-secret public configuration. Store private provider credentials in server-only Vercel variables.
6. Update the presentation with the actual URL. Never replace it with an assumed URL.
