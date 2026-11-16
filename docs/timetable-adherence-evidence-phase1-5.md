# Phase 1.5 — Classification evidence consistency and Redis recovery audit

**Keep Production Redis persistence disabled.** The archived responses establish two classification consistency defects. The Preview run also lost sustained persistence and recorded one confirmed function out-of-memory failure. The available telemetry cannot identify the Redis provider failure or the allocation that exhausted function memory.

This review used the frozen Phase 1.4 source, collector logs, archived responses, read-only Vercel queries, and a local recovery experiment with an in-memory test backend. No app endpoint was called because normal fleet processing can write evidence. The post-review Vercel check matched the preflight Production deployment and protection settings, with zero Production Redis variables. All times in this report are Malaysia Time. Machine-readable trace timestamps are UTC.

Reference: [Phase 1.4 validation report](timetable-adherence-evidence-phase1-4.md).

## 1. Classification consistency root causes

**The freshness clock advances after a journey result is built.** `ProcessedBusJourneys` assesses a journey at its processing clock and then awaits persistence. `getOfficialTransit` joins all feed results before the route assigns `fetchedAt`. The route serializes the existing assessments without a final freshness check. Cached journey reuse and out-of-order response protection can also return an earlier result. The traced stale case proves a clock gap between calculation and payload creation. The archived data do not isolate which operation consumed that gap.

**The retained result and current tracking state have different lifetimes.** `retainJourneyAdherence` copies a prior result or `lastValid` into the new journey after checking vehicle, run, route, stop, schedule, projection and current progress conditions. That result still embeds its original crossing pair. The function does not put the pair into `tracking.passages`. The independent assessor only looks for a confirmed pair in that current list. This produces a result that the same payload cannot reproduce through its normal assessment path.

Tracking carries previous passages forward when the tracking key and history token match. The progress history can start a new token after a continuity gap, unusable fix, changed trip identity or feed interruption. Redis can restore compatible validated pairs under its retention rules. Retained stop assessments can survive a tracking token change within the same vehicle run. The archive confirms this lifecycle split in sampled responses. It cannot identify the exact reset trigger or Redis document revision for each transition.

| Candidate explanation | Finding |
| --- | --- |
| Stale current GPS | Confirmed in 28 traced occurrences. The crossing pair was still present. The latest GPS fix crossed the age threshold before the payload timestamp. |
| Retained result without a current pair | Confirmed in 590 traced occurrences. Every response embedded the original pair in the result, and none had another pair for that stop in current tracking. |
| Expired crossing inputs | 25 of the 618 pairs already had an endpoint beyond the 60-minute Redis admission cutoff at journey time. Expiry can explain why those pairs were ineligible for restoration. It does not establish a key expiry or eviction event. |
| Missing raw GPS records | The archived responses omit many original raw observations. Their absence from sampled archives cannot establish loss in the original source or Redis. Each traced result contains the two projected GPS observations. |
| Cache inconsistency | The independent lifetimes of cached results and tracking are demonstrated. The logs do not show corruption, a competing overwrite, or a cache eviction for the traced IDs. |
| Redis failure | 585 missing-pair occurrences were in degraded responses and five were in ready responses. A global state cannot link a given stop to an individual Redis failure. Redis loss could limit restoration, but it does not explain every case. |
| Other causes | The remaining aggregate-only occurrences lack payload detail. No cause is assigned to them. |

## 2. Denominators and distinct identities

An occurrence is one eligible run-stop in one successful poll. Eligibility requires a GPS-passed stop on the uniquely matched current run and a finite exact scheduled departure. The mismatch counter counts a server-reported result that the frozen assessor withdraws at the payload timestamp. It does not test all status and value differences between two non-null results. The archived recheck additionally compared the status, crossing time, schedule reference, signed difference and tolerance.

| Population | Count |
| --- | ---: |
| Successful polls | 2,869 |
| Eligible stop occurrences across successful polls | 6,878,137 |
| Server-reported classifications in that denominator | 2,625,051 |
| Unreproducible occurrences | 7,078 (0.27% of reported classifications) |
| Polls containing a mismatch | 382 |
| Distinct eligible run-stops across the full window | 143,796 |
| Archived responses matched to successful polls | 141 |
| Eligible stop occurrences in those archives | 330,999 |
| Reported classifications examined in those archives | 125,520 |
| Archived classifications reproduced with matching values | 124,902 |
| Traced mismatch occurrences / distinct affected run-stops | 618 / 551 |
| Aggregate-only mismatch occurrences | 6,460 |

The run-stop key combines feed source, vehicle ID, selected run key, stop ID and stop sequence. The trace hashes that key. A separate classification version hash also includes the crossing proof, exact scheduled reference, tolerance and reported result. The underlying measurement pair hash omits the stop, so one pair that crosses several stops counts once.

| Traced case | Occurrences | Distinct run-stops / classification versions | Distinct runs | Distinct measurement pairs |
| --- | ---: | ---: | ---: | ---: |
| Stale at payload time | 28 | 28 / 28 | 1 | 21 |
| Retained result missing from tracking | 590 | 523 / 523 | 56 | 402 |
| Total | 618 | 551 / 551 | 57 | 423 |

The exact full-window distinct mismatch count is unrecoverable. The largest single poll contained 1,105 mismatches and zero duplicate eligible keys, so the full-window count is **at least 1,105**. The 551 known distinct keys plus 6,460 aggregate-only occurrences put the upper bound at **7,011**. Full-window counters recorded 302 occurrences before the first unavailable Redis read and 6,776 from that point onward. The different cohorts and missing payload detail prevent a causal allocation.

## 3. Tracing the stale and missing-pair cases

Each trace row contains the archived response filename, identity hashes, both projected GPS observations and their measurement timestamps, confirmation and crossing times, schedule reference, reported classification, age at each clock, and earlier archived proof where available. The audit re-ran the frozen crossing interpolation against the embedded endpoints and the recorded stop projection. All 618 pairs reproduced their passage arithmetic and matched the recorded vehicle, trip, route, shape, service date and stop scope. Confirmation time is a GPS measurement clock. The exact original classification generation time is not recorded.

The archive has no complete raw feed history. Matching raw coordinates for both endpoints were recoverable from archived vehicle records or accepted tracking state in 93 occurrences. Another 124 had one recoverable endpoint and 401 had neither. The projected evidence still identifies the measurements and reproduces the historical calculation. It cannot independently validate missing coordinates or prove an actual stop arrival.

**The 28 stale results came from one Rapid Penang run in one payload at 08:04:32.080 on 9 November.** All were reproducible at journey time, when the current GPS fix was 90.356 seconds old. At payload time the same fix was 120.080 seconds old. Inserting the embedded crossing pair into the assessment input did not change that outcome. Earlier archives reproduced 21 of the same classifications. Five pairs were already beyond the Redis retention cutoff, independently of the response-time freshness failure.

For stop sequence 6 in that payload, the GPS pair measured 1,143.630 m at 06:54:47 and 1,477.580 m at 06:55:39 along the shape. It crosses the stop at 1,227.639 m at 06:55:00.081. The exact reference was 06:52:50, giving +130.081 seconds and `DELAYED` under the ±120-second tolerance. The latest GPS fix was measured at 08:02:32. The historical calculation reproduces. The result was **invalid as a current classification at payload time**.

**The 590 missing-pair results came from 19 payloads.** All carried a retained result, had fresh current GPS at payload time, and had no crossing pair for that stop in current tracking. Replaying with the embedded pair as the only tracking passage reproduced the result in all 590 cases. That diagnostic replay locates the inconsistency. It does not authorize admitting retained evidence without the existing checks.

- Earlier archived responses reproduced the exact same pair for 427 occurrences. For 418 of these, the earlier proof came from the same runtime and the later response had a different history token. This directly establishes that the tracking history changed while the stop assessment retained the original proof.
- The remaining 163 occurrences have embedded proof without an earlier independently captured reproduction. The archives do not reveal the original generation event.
- Twenty pairs had an endpoint beyond the storage cutoff. The other 570 were within that cutoff. The available records show absence from current tracking, with no replacement pair for those stops. Per-key history would be required to identify storage overwrite or eviction.

For an example within retention, a Rapid Penang stop at sequence 44 returned `DELAYED` at 15:45:30.166. Its pair measured 12,766.903 m at 15:32:07 and 13,368.884 m at 15:33:07. It crossed the projected stop at 15:32:37.832 against a 15:08:28 reference, a difference of +1,449.832 seconds. The earlier response contains both matching accepted fixes and reproduces the pair. The later response used a new tracking token and still carried the old result. The historical result is reproducible from the stored proof, but the current result lacks the evidence required by the existing tracking-based assessment.

[Open the 618 occurrence traces](</C:/Users/loong/.codex/visualizations/2026/10/31/01a19042-26fc-77d0-9d6f-54c350d6b494/adherence-evidence-phase1-4/phase1-5-classification-traces.jsonl>).

## 4. Redis degradation and state transitions

The first captured unavailable MGET was observed at 15:24:33 on 9 November. The final 882 successful polls reported `DEGRADED` over the following 7 hours 22 minutes. Nine same-instance transitions from `DEGRADED` back to `READY` occurred before that onset. There was no observed return to `READY` after it, including after the application instance changed.

| Signal during the degraded interval | What it establishes |
| --- | --- |
| 2,706 MGET spans marked `UNAVAILABLE` and 57 marked `TIMEOUT` | Repeated read transport failures. The adapter maps non-success HTTP responses and untyped errors to `UNAVAILABLE`. The stored spans omit provider status and error detail. |
| 2,724 MGET spans marked `OK` | The adapter got a parseable transport response. Missing keys, invalid documents and validated histories require separate interpretation. |
| Two increases in validated history loads in archive comparisons spanning onset through 15:45:30 | Some useful reads survived. A load counter increase does not prove that every cache entry was restored or replaced. |
| 8,437 EVAL spans marked `OK` | The pipeline HTTP response parsed. Individual command errors and CAS outcomes are evaluated afterward. These spans do not establish writes. |
| Save counter increased by 1,896 between the 15:14:31 and 15:25:00 archives | Some writes were acknowledged in an interval that straddles the first unavailable read. The interval cannot date each individual write. |
| No additional save counter increase in later archived responses | Sustained acknowledged write recovery was not demonstrated. Unsampled writes and commands with unknown remote outcomes remain unresolved. |
| Zero observed retry increments in successful polls after onset | The 16 retries in the full-window counters did not continue in the observed degraded interval. A command-level rejection, timeout or unknown outcome does not enter the CAS conflict retry path. |
| Last nonempty probe had 530 keys and 491,522 processed commands. Nine successful probes after onset had zero keys, with a lower observed command counter. | The keyspace and provider-reported statistics changed. Failed probes and absent provider errors leave the cause unresolved. |
| Prior Phase 1.4 post-run DBSIZE and MGET returned HTTP 200 with zero keys and a miss | Read connectivity returned for those probes. No successful write or persisted read-back was shown. |

The application-side cause of continued degradation is repeated persistence failures combined with no demonstrated restoration of acknowledgments. At the provider boundary, a quota restriction, routing or service reset, expiry during interrupted writes, and command-level rejection remain hypotheses. The sampled Redis memory peak was below the reported limit. A database flush, eviction event, exceeded quota, or provider outage cannot be assigned from the existing counters.

The state is a mutable last-operation flag shared by all feeds on the instance. A failed hydrate or persist marks it degraded. A successful hydrate can set it ready even if every key is missing. A candidate-bearing persist can set it ready when deduplication skipped every write. Concurrent feeds can overwrite each other’s state. An idle instance with no eligible work can keep a degraded flag after the backend recovers. There is no permanent retry lockout, and a ready flag alone cannot demonstrate healthy durability.

## 5. Write recovery and memory fallback

A read-only local experiment used the frozen processor and its existing test fixture with a fake backend. The same processor handled all steps.

| Step | Result |
| --- | --- |
| Seed healthy observations | Five acknowledged saves |
| Fail the next write | `DEGRADED`, saves stayed at five, three classifications still returned, no retry |
| Restore the fake backend with no eligible work | Status stayed `DEGRADED` |
| Supply the next valid GPS observation | Save six acknowledged and status returned to `READY` without a restart |
| Mark the status degraded and repeat the identical saved observation | Status returned to `READY` with unchanged read and write counts |
| Empty the fake remote store while retaining a cached revision | The next CAS conflicted. One read refresh and one retry wrote save seven on the same processor. |

The retry policy is a single refresh and retry for known CAS conflicts within the operation deadline. A confirmed missing key during that refresh clears the stale cached revision. Unknown outcomes are not immediately retried or blindly reapplied. A later poll can submit a still-eligible observation again. There is no durable queue of prior failed observations.

Local vehicle history and the acknowledged evidence cache keep the fleet usable while Redis fails. New unacknowledged documents are not installed as saved cache entries. The processor can still produce classifications using local GPS evidence and retained results. The response exposes an aggregate persistence state, but it lacks per-classification proof of storage provenance. Thus the fleet can look operational while relying on memory, and a restart can remove evidence that never reached Redis. Recovery without a restart is proven in the local experiment. Write recovery in the affected Preview Redis instance remains unverified.

## 6. Preview memory and HTTP 500

Vercel confirmed one `/api/transit` instance ran out of available memory at **22:15:55.013 on 9 November**. The retained log has no numeric memory attributes. Deployment metadata exposed 8,192 MB for the build machine only. It did not supply a runtime function peak or configured runtime allocation. The remaining nine non-JSON HTTP 500s have no retained cause available. Eight of the ten errors preceded the sustained Redis degradation. All ten were bracketed by successful polls with different observed instance IDs. That establishes a change in the responding instance, not the reason for each error.

| Measured size from 141 successful archives | P50 | P95 | Max |
| --- | ---: | ---: | ---: |
| Uncompressed fleet JSON | 18.91 MB | 22.87 MB | 23.89 MB |
| Local gzip archive | 3.16 MB | 3.75 MB | 3.98 MB |
| Serialized tracking objects | 4.48 MB | 5.83 MB | 6.09 MB |
| Serialized stop arrays | 7.46 MB | 9.07 MB | 9.37 MB |
| Crossing pairs inside tracking | 1.75 MB | 2.61 MB | 2.77 MB |
| Embedded pair copies inside stop results | 1.52 MB | 2.25 MB | 2.43 MB |

These are decimal byte units for serialized objects. Several rows overlap by design, and the gzip archives were made by the collector. Neither measurement represents Node heap, resident memory, or the failed response. The nearest archived payloads before and after the OOM were 13.18 MB and 9.93 MB uncompressed. The largest archived payload was earlier in the day.

| Memory area | Code finding and limit of evidence |
| --- | --- |
| GPS history | The live history keeps up to eight raw fixes per entry in the recent GPS window and one previous progress state. It prunes absent vehicles and entries unseen for ten minutes on ingestion, and interrupts a feed’s history on feed failure. The archive had up to four speed samples in a state. There is no measured process-wide peak entry count. |
| Persistence cache | Before preparing a feed, expired checkpoints and entries above 1,000 are pruned by map order. Hydration and writes can add entries between prunes. The limit is an entry-count check, with no total byte budget. Documents include observations and passage arrays. The schema allows up to 10,000 observations and 2,000 pairs per document. Actual cache bytes and eviction events were not logged. |
| Redis payloads | The adapter batches up to 40 items with a 256,000-byte request target and three concurrent workers per operation. MGET batch sizing uses request keys, so it does not bound the returned document bytes. The adapter materializes the response text before checking its four-million-character limit, then parses the envelope and individual documents. Actual Redis response bytes were not recorded. |
| Static GTFS and object retention | Cold or expired loads expand several GTFS files concurrently and build full timetable and geometry indexes. Warm instances keep a 24-hour static cache. Processed journey entries also retain a timetable reference until feed or age cleanup. This can increase peak overlap on refresh. No heap profile establishes a leak or identifies the dominant retained objects. |
| Concurrent fleet work | Three bus feeds can process in parallel. Separate static, realtime and bus processing promise maps coalesce same-feed work within an instance and delete settled promises. They do not coalesce across Vercel instances. Preparation calculates a preview journey before the main processing pass. The collector polls serially and has no per-instance concurrency trace for other requests. Duplicate background processing is possible across instances and has not been established as the OOM cause. |
| Response generation | The route holds the fleet object graph, stringifies it and compresses the result before applying a four-million-byte response cap. Compression and the cap do not prevent the earlier allocation peak. Repeated geometry and embedded crossing pairs inflate the serialized response. |

Redis INFO peaked at 12,539,574 bytes used against a reported 67,108,864-byte limit. That is remote database memory. Heap growth, RSS, external buffers, allocation sites and the exact request overlap at the Preview OOM remain unknown. The code and serialized sizes identify places to measure first.

## 7. Evidence lifecycle options

| Option | Value | Limitation |
| --- | --- | --- |
| Recalculate from current tracking and withdraw unsupported results at the response boundary | Keeps the existing admission rules and closes the freshness gap. | A valid historical crossing may disappear from the current view when its tracking epoch changes. |
| Store an immutable proof for each accepted classification | Makes past calculations reproducible across warm instances and restarts. | Requires a bounded retention policy, versioning and access control. Copying the full proof per response would add memory pressure. |
| Reference shared accepted GPS observations and the canonical crossing pair | Reduces duplication across stops and ties a result to specific measured input. | A reference cannot reproduce a result once its target expires. Evidence and reference lifetimes must align. |
| Preserve a separate historical result | Retains the last verified outcome and explains why it is no longer current. | Historical metadata must carry its proof availability and cannot promote itself back to a current classification. |

Use one canonical, immutable passage proof for an admitted result. Bind it to the source, vehicle, service date, run, route, direction, shape and projection version, stop ID and sequence, and exact schedule reference. Keep the original measured endpoint IDs and timestamps, the accepted projection and quality fields, crossing time, confirmation time, classification generation time, and rule version. Record generation time separately from feed publication, receipt and GPS measurement times.

At the API boundary, evaluate current freshness and eligibility from the current journey plus the compatible canonical proof. Keep the ±120-second timetable tolerance and the existing GPS quality checks. A retained result can be reproducible historical evidence without qualifying as current. Apply measurement-based retention consistently across in-process and restored evidence. After proof expiry or loss, withdraw the current result and label any preserved summary as historical with unavailable proof. Longer audit retention requires an explicit policy decision. Recalculation must use accepted evidence and versioned context. Interpolated vehicle animation supplies no evidence.

## 8. Prioritized implementation plan

1. **Close the correctness gap.** Add response-time freshness checks and separate current results from retained history. Define the admission path for a canonical proof before changing storage. Test boundary cases crossing the GPS age limit during a slow peer feed, same-run history resets, expired pairs, changed scope and non-exact schedules. Preserve the existing matching, progress and timetable tolerance.
2. **Make storage health verifiable.** Record sanitized HTTP status, command failure category, CAS outcome, batch bytes, store generation and last successful read and acknowledged write. Distinguish successful misses, partial failures and no-work cycles. Exercise recovery on the same runtime and verify an acknowledged write by read-back in an isolated Preview test.
3. **Measure memory and reduce peak allocations.** Capture RSS, heap used and external buffers at static load, history hydration, fleet processing, serialization and compression. Measure cache bytes, per-feed concurrency and Redis request and response sizes. Compare Redis enabled and disabled on the same workload. Then reduce duplicate payloads and bound cache bytes and concurrent batch allocation where profiling warrants it.
4. **Repeat the isolated Preview soak.** Use storage sized for the observed command and data volume. Retain per-occurrence mismatch IDs and cause codes without full fleet duplication. Exercise a cold start, warm processing, a static refresh, a provider interruption and recovery. Require reproducible current classifications, sustained acknowledged writes with read-back, verified restart recovery, and measured memory headroom through the peak workload.

## 9. Production activation recommendation

**Production Redis persistence should stay disabled.** The correctness gap, lack of demonstrated write recovery, and unresolved function memory exhaustion are independent activation blockers. The existing fixed replay remains a regression reference for progress and classification. It cannot substitute for response-time consistency, sustained persistence, or runtime memory validation.

The investigation is complete and ready for review. Only this report and its local trace output were written. The frozen application code, Preview deployments and Redis settings were inspected without changes.

