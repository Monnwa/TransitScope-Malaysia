# Phase 1.4 — Preview Redis end-to-end validation

**The 24-hour observation window and engineering review are complete. Keep Production Redis persistence disabled.** The run established restart recovery and failure isolation under controlled conditions. It also exposed a sustained persistence disruption, a Preview out-of-memory failure, and adherence results that did not pass the payload-time evidence check.

All times below use Malaysia Time (MYT, UTC+8).

## 1. Preview architecture and isolation

The existing TransitScope Malaysia Vercel project hosted the frozen Phase 1.3 snapshot on Preview. The main run used deployment-only environment variables and a dedicated temporary Upstash Redis database with 60-minute measurement-based retention. Fault and expiry tests used separate Preview deployments and isolated test storage. The main deployment used no fault injection.

The local Windows Node.js collector polled the request-driven Preview API every 30 seconds, sampled Redis resources, and saved results to disk. Preview ran on Node 26.x in `iad1`. Expiring deployment share links provided access without adding a project-level bypass. The aborted preflight is archived separately because rotating the single Hobby share link interrupted its collection. [Vercel share-link documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/sharable-links)

The post-run check at 22:57:57 on 9 November matched the preflight Production deployment ID, project protection settings and project-level bypass state. It found zero Production Redis variables. Git HEAD remained `235f7cb67d631a17df86bfc23f70de93dc0fff5d`. Phase 1.4 used Preview deployments only.

## 2. Continuous runtime

| Measure | Result |
| --- | --- |
| Collector started | 8 November 2026, 22:46:14.882 |
| Valid observation window started | 8 November 2026, 22:46:27.604 |
| 24-hour threshold | 9 November 2026, 22:46:27.604 |
| Final successful sample | 9 November 2026, 22:46:22.262 |
| Collector completed | 9 November 2026, 22:46:45.759 |
| Successful Preview polls | 2,869 of 2,879 (99.65%) |
| Poll failures | 10 non-JSON HTTP 500 responses |
| Largest gap between successful polls | 110.458 seconds |
| Gaps beyond the 180-second reset threshold | 0 |
| Application instances observed | 32 |
| Isolation checks during collection | 25 |

The last successful sample preceded the threshold by 5.34 seconds. The loop crossed the threshold and ended with a sample 23.50 seconds old, within the collector’s continuity rule. The collector and temporary Windows sleep-prevention process have exited.

The retained Vercel runtime entry for the 9 November 22:15:55 failure says the `/api/transit` instance ran out of available memory. Runtime log retention prevented attributing the earlier nine HTTP 500s. The cause of the confirmed instance memory exhaustion remains open.

## 3. Redis consumption and retention

| Measure | Observed result |
| --- | --- |
| Resource probes | 104 successful, 34 failed |
| Peak key count | 589 |
| Peak sum of sampled per-key memory | 14,125,608 bytes |
| Peak Redis INFO used memory | 12,539,574 bytes |
| Reported Redis memory limit | 67,108,864 bytes |
| Redis INFO connected clients | 1 across 101 available samples |
| Documents / observation rows inspected across probes | 740 / 20,732 |
| Ordering errors / logical validation rejects | 0 / 1 |
| Physically stored rows older than 60 minutes | 6,086 occurrences across 68 probes |

Resource samples can include the same document or row more than once. Per-key memory and Redis INFO memory are distinct measurements. The INFO client count represents the provider’s sampled Redis connections. It does not measure concurrent application REST requests.

The logical retention filter uses original GPS measurement time. Older rows can remain physically present in a document until it is rewritten or the key expires. The one validation reject was excluded by the existing validator. The probe did not record a reason for that rejection. The separate one-minute native expiry test verified that a real key disappeared after its PTTL elapsed.

The last nonempty sample at 15:13:39 on 9 November reported 530 keys, 491,522 processed commands and 2,934 expired keys. Nine successful resource probes after the first Redis unavailability all returned zero keys. The first such probe, at 16:27:09, reported 17,651 processed commands. This discontinuity and the failed probes prevent a full-day resource trend or definitive provider-side cause. The temporary database has a 72-hour lifetime. [Upstash REST documentation](https://upstash.com/docs/redis/features/restapi)

## 4. Application restart recovery

The collector started two new Preview runtimes from the same frozen source and reused the main Preview Redis database.

| Controlled restart | New runtime returned | Histories loaded | Original observation rows retained | Scope mismatches |
| --- | --- | --- | --- | --- |
| About +15 minutes, 8 November 23:02 | HTTP 200 | 114 | 205 | 0 |
| About +12 hours, 9 November 10:47 | HTTP 200 | 229 | 443 | 0 |

Both responses came from a new instance. Whole-observation fingerprints verify that the retained rows kept their original timestamps and stored fields. The post-restart SCAN samples did not contain one and two keys respectively from the 30-key pre-restart samples. Because the collector selected a new subset from each SCAN, it cannot determine whether those keys expired or fell outside the subset.

In the isolated restart retest, the new runtime loaded 137 histories. All 111 sampled original observation rows survived with the same scope. Concurrent requests produced no duplicate timestamps or ordering errors in the 30 sampled histories.

## 5. Fleet performance and sustained degradation

| Client-observed span | Samples | P50 | P95 | P99 |
| --- | ---: | ---: | ---: | ---: |
| Redis REST request, all captured outcomes | 30,233 | 64.89 ms | 1,145.93 ms | 2,089.87 ms |
| Redis REST request, transport OK only | 27,093 | 55.79 ms | 1,020.45 ms | 1,594.83 ms |
| DNS/TCP/TLS establishment | 2,252 | 118.18 ms | 811.16 ms | 1,139.18 ms |
| Last fleet duration reported at each poll | 2,869 | 893.98 ms | 2,772.98 ms | 3,874.09 ms |
| Successful Preview API round trip | 2,869 | 5,569.55 ms | 9,240.93 ms | 22,137.22 ms |

Application counter deltas show 30,242 REST requests, 436 timeouts (1.44%), zero connection failures, 16 retries, 117,863 acknowledged saves and 3,728 loaded histories. The 4,736 persistence failures are application counter increments. They use a different unit from transport request failures. Cache hits numbered 289,694 against 192,870 misses (60.03% hit rate).

The rolling request buffers captured 30,233 spans, nine fewer than the request counter delta. The captured spans included 434 timeouts and 2,706 unavailable MGET responses. These are client timings. Redis server execution time and the split between individual request and shared operation deadline failures remain unmeasured.

The first captured unavailable read occurred at 15:24:33 on 9 November. All 882 successful polls from that point through completion reported persistence as degraded, bringing the full-window total to 894 of 2,869. The archived payload at 15:25:00 showed acknowledged writes. Later archived payloads showed no additional acknowledged saves across observed instances. During the degraded period, 8,437 EVAL transport spans recorded `OK`. The adapter records HTTP/JSON success before evaluating individual pipeline command outcomes, so those spans cannot establish successful writes.

The service continued to return fleet data in many degraded polls. The collected evidence does not identify the cause of the persistence disruption. A post-run read-only DBSIZE probe returned HTTP 200 with zero keys, and a read-only MGET of a probe key returned a miss. These probes establish connectivity at review time. Write recovery remains unverified.

## 6. Coverage and classification integrity

The denominator includes GPS-passed stops on a uniquely matched current run with a finite exact scheduled departure. The numerator applies the existing adherence assessment at sample reception. The distinct union deduplicates source, vehicle, run, stop and sequence. Its numerator counts stops classified at least once during the window.

| View | Classified / eligible | Coverage |
| --- | ---: | ---: |
| Final Preview poll | 640 / 2,087 | 30.67% |
| All Preview polls, repeated stop occurrences | 2,615,374 / 6,878,137 | 38.02% |
| Preview distinct union, ever classified | 60,462 / 143,796 | 42.05% |
| Before first unavailable MGET, repeated occurrences | 1,735,596 / 4,151,798 | 41.80% |
| From first unavailable MGET through completion, repeated occurrences | 879,778 / 2,726,339 | 32.27% |
| Phase 1.3 controlled replay | 130 / 3,157 | 4.12% |
| Historical Production audit | 604 / 3,519 | 17.16% |

The live pre/post groups differ in service hours, vehicle runs and available GPS observations. Their difference cannot be assigned to Redis alone. The historical Production and Phase 1.3 replay cohorts use different windows and inputs, so they supply context for this run rather than a coverage uplift estimate. Rapid KL Bus supplied vehicle records but contributed zero eligible observations under this denominator.

| Primary reason among unclassified Preview stop occurrences | Count |
| --- | ---: |
| No GPS history | 3,236,253 |
| GPS gap too large | 869,202 |
| Stale GPS | 99,469 |
| Insufficient evidence | 38,768 |
| GPS outlier rejected | 10,714 |
| Passage time unavailable | 8,357 |

All 2,869 successful polls had zero duplicate eligible occurrences. The distinct classified union is a subset of the eligible union. Across the full run, 382 polls contained 7,078 occurrences where the API reported a classification and the unchanged assessor returned no current result at the payload timestamp. These occurrences can repeat the same stop across polls.

An independent recheck of 141 archived responses examined 125,520 reported classifications. Of these, 124,902 reproduced the same status, passage time, schedule reference and difference. The 618 disagreements had two causes in that sample.

- **28 stale results at payload time.** These passed at journey calculation time and crossed the 120-second GPS age limit before the API set `fetchedAt`. In one response, GPS age rose from 90.356 seconds at calculation to 120.080 seconds at payload creation.
- **590 retained results lacked a confirmed crossing pair in the current tracking payload.** They carried the previous assessment and its embedded pair via `retainJourneyAdherence`. The independent assessor searches the current tracking passage list and could not reproduce the result. This is an evidence reconciliation issue. The sample does not establish that the previously retained crossing itself was false.

The ±120-second timetable tolerance remains the one used for classification. The 120-second GPS freshness limit is a separate check. Neither a controlled replay nor these results supply arrival ground truth.

## 7. Controlled failure and recovery tests

| Check | Observed result |
| --- | --- |
| Redis fetch unavailable | Preview returned HTTP 200 with 250 records and reported 160 unavailable histories |
| Single failing request | Preserved 101 loaded histories and 93 acknowledged saves alongside two timeouts |
| Multiple simultaneous failures | Preserved 53 loaded histories and 80 acknowledged saves alongside five timeouts |
| Connection interruption | Preserved 85 loaded histories and 90 acknowledged saves alongside two connection failures |
| Native expiry | An isolated one-minute key disappeared after the remaining PTTL elapsed |
| Concurrent polling and restart | Both passed on retest after serializing Preview share-link access |

The transport faults were injected at the Preview Redis-fetch boundary. They exercise application fallback and partial-success handling. The sustained failure observed in the main run was separate from these injected cases.

## 8. Regression and source integrity

| Check | Result |
| --- | --- |
| Unit tests rerun after the soak | 331 passed across 27 files |
| TypeScript and ESLint rerun | Passed |
| Phase 1.3 browser regression | 100 passed against the production build |
| Phase 1.3 production build | Passed |
| Phase 1.4 Preview build | All main Preview deployments reached READY |
| Source preservation | All 116 checked workspace source files matched the frozen base hashes |
| Controlled progress reference | Phase 1.3 replay retained all 2,391 progress records |

The current unit and TypeScript reruns passed after filesystem access allowed installed dependencies to resolve. The browser suite, local production build and fixed replay results are carried forward from Phase 1.3. The Preview snapshot adds validation instrumentation and isolated fault switches. The runtime GPS, matching, progress, railway and adherence code in the workspace matches the frozen baseline.

## 9. Production activation recommendation

Keep Production Redis persistence disabled. Before activation, investigate Preview instance memory usage, capture sanitized Redis response and pipeline command failure categories, and reconcile retained and stale results with the unchanged eligibility rules at the API response boundary. Repeat the soak on Preview storage sized for the measured workload. The repeat must demonstrate sustained acknowledged writes and recoverable reads across restarts, with complete resource telemetry and no unaccounted classification disagreements.

Evidence files are in `C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-4/`. The completed collector summary is in `monitor-state.json`, poll and request details are in `samples.jsonl` and `request-events.jsonl`, and resource and restart evidence is in `resources.jsonl` and `restart-events.jsonl`. Archived response snapshots support the classification recheck. Credential values remain in ignored environment files.

