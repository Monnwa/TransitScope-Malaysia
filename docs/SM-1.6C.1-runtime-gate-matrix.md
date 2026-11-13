# SM-1.6C.1 — LinkBike runtime gate matrix

The optimized build was created once with both LinkBike flags and Vercel identifiers unset. The build output marks both `/` and `/api/micromobility/linkbike` dynamic. The homepage is absent from the prerender routes and has no static `index.html` in the build. The runtime harness verified the same SHA-256 fingerprint of the build ID, prerender manifest, compiled page and compiled API route after each case.

`65cf26b6ba17bd4dabab10f9f2d75b205f3eb921fc78b8fb6d31f0ab57f72a52`

| Loopback process configuration | Control in HTML | Control in Chromium | Anonymous GET | Upstream fetches |
| --- | --- | --- | --- | --- |
| Local development mode, opt-in unset | Absent | Absent | 404 | 0 |
| Local development mode, non-Production opt-in true | Present | Present, unchecked | 200 | 2 |
| Local development mode, opt-in unset again | Absent | Absent | 404 | 0 |
| Preview, opt-in unset | Absent | Absent | 404 | 0 |
| Preview, matching identifiers and non-Production opt-in true | Present | Present, unchecked | 200 | 2 |
| Preview, mismatched identifiers | Absent | Absent | 404 | 0 |
| Preview, legacy public flag only | Absent | Absent | 404 | 0 |
| Production, private opt-in unset, public and non-Production flags true | Absent | Absent | 404 | 0 |
| Production, matching identifiers and private opt-in true in the fixture subprocess | Present | Present, unchecked | 200 | 2 |
| Production, private opt-in unset again | Absent | Absent | 404 | 0 |
| Production, mismatched identifiers | Absent | Absent | 404 | 0 |
| Production, missing target identifier | Absent | Absent | 404 | 0 |
| Production, uppercase opt-in value | Absent | Absent | 404 | 0 |
| Production Node mode, both flags true and no Vercel identifiers | Absent | Absent | 404 | 0 |
| Local development mode, empty Vercel environment identifier | Absent | Absent | 404 | 0 |
| Production metadata with development Node mode | Absent | Absent | 404 | 0 |

Both off → on → off sequences reused the same build and used separate loopback processes. Each process had its gate-related environment scrubbed before the case-specific values were set. Cases with `NODE_ENV=development` use `next start` against the same optimized build and emit Next.js's expected non-standard-environment warning for this test setup. The real Production opt-in remained unset. Both LinkBike sources were synthetic.

The homepage returned a non-cacheable response and contained the actual checkbox markup only when enabled. Chromium observed zero inventory requests on initial load in all cases. In all three enabled cases, direct demo navigation excluded the control from both HTML and the hydrated page. Anonymous GET returned `Cache-Control: no-store` in every case. All three successful responses retained `UNVERIFIED` and null verified observation time, available docks and public station status. POST, PUT, PATCH and DELETE returned 405 in every case. The denied cases produced no upstream fetches. The unchanged API guard precedes the only inventory cache entry point.

[Runtime matrix log](../test-results/sm16c1/runtime-matrix.log) · [Loopback test harness](../test-results/sm16c1/runtime-matrix.cjs) · [Build log](../test-results/sm16c1/build.log)

