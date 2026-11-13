# SM-1.6C — LinkBike feature gate matrix

| Environment | Expected | Evidence and result |
| --- | --- | --- |
| Local development, flag unset | Disabled | Source evaluates false. Disabled HTTP and UI passed in SM-1.6B. Independent rerun stopped. |
| Local development, public flag `true` | Enabled | Source evaluates true with Vercel metadata absent. Enabled fixture browser and HTTP passed in SM-1.6B. Independent rerun stopped. |
| Vercel Preview, flag unset | Disabled | Source evaluates false. Independent runtime check pending. |
| Vercel Preview, public flag `true`, both identifiers `preview` | Enabled | Independent loopback test of the existing optimized artifact returned anonymous 200 `UNVERIFIED`, while the homepage rendered disabled. **Mismatch.** |
| Vercel Preview, mismatched identifiers | Disabled | Source evaluates false for mixed Preview/Production identifiers. Independent runtime check pending. |
| Vercel Production, private flag unset | Disabled | Independent loopback test with both identifiers `production` and the legacy public flag `true` returned 404 `no-store`. The serialized homepage gate was false. Chromium observed zero toggles and zero LinkBike requests. |
| Vercel Production, private flag `true`, both identifiers `production` | Enabled | Source requires all three conditions plus `NODE_ENV=production`. SM-1.6B tested the function and GET with mocked environment and fixtures. No independent enabled Production build or runtime check was attempted. |
| Vercel Production, mismatched identifiers | Disabled | Source evaluates false for mixed or partial Production metadata. Independent runtime check pending. |
| Missing or invalid environment values | Fail closed | Opt-in strings must be exact lowercase `true`. Production requires exact Production metadata. Local development treats empty optional Vercel values as absent. Further independent runtime cases are pending. |

## Built artifact evidence

The prerender manifest reports the homepage as static with revalidation disabled. The artifact contains `enableLinkBike=false`. The LinkBike API is absent from the prerender routes and runs dynamically. The same HTML artifact, SHA-256 `fa926b2ef8afe35e89f27ca48d07126d6fc2193a2440c12563eacd59c33cc0e1`, was served in both loopback configurations. The private Production flag was removed from both child process environments. Preview inventory came from synthetic upstream responses. [Probe and results](../test-results/sm16c/built-gate.cjs) · [HTTP and Chromium log](../test-results/sm16c/built-gate.log)

The dashboard's boolean is fixed when Next.js prerenders the page. The route reads the environment at request time. This creates a reproducible case where the API is enabled and the dashboard is disabled. The inverse can occur if the artifact captures an enabled homepage and the runtime gate is later disabled. The inverse is a source-based inference. Hosted Vercel deployment behavior was outside the test. The gate needs a common lifecycle before this matrix can pass. [Homepage](../app/page.tsx) · [Gate](../lib/linkbike-feature.ts) · [Dynamic API](../app/api/micromobility/linkbike/route.ts)

