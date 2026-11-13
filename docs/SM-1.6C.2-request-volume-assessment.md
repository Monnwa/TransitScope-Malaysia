# SM-1.6C.2 — LinkBike request volume assessment

## Browser requests to TransitScope

Estimates assume the overlay is enabled and use the default 300-second refresh interval. The next timer is scheduled after the current fetch and response handling finish. These are approximate steady-state rates under sustained use. Initial opens and visibility changes can add requests.

| Scenario | Browser-to-TransitScope inventory GETs |
| --- | --- |
| Overlay off, demo mode or gate disabled | Zero from the dashboard. |
| One visible tab with the overlay on | One initial GET, then up to about 12 per hour at the default interval. Slow requests reduce that cadence. |
| `U` visible tabs with the overlay on | About `12 × U` per hour, plus opening and resume requests. Each tab has its own timer. |
| Hidden tab before SM-1.6C.2 | The tab could continue to issue roughly 12 GETs per hour at default cadence, subject to browser throttling. |
| Hidden tab after SM-1.6C.2 | Zero new scheduled GETs while hidden. One already-started request may finish. A transition to visible can start one immediate GET if idle. An in-flight request serves that transition without a duplicate. |
| Repeated failures in one visible tab | The tab still waits the valid server-provided interval or the five-minute default for scheduled retries. Repeated actual visibility transitions or manual reopening can make extra requests. |

The accepted interval range is 60–3,600 seconds. At the minimum, one continuously visible tab can schedule about 60 GETs per hour. These figures describe the dashboard client. An anonymous API caller can make requests outside that cadence.

## TransitScope requests to LinkBike

The portal and consumer coordinate caches are independent. Each warm server process coalesces concurrent loads per source and caches completed success or failure results for five minutes by default. This constrains repeated work within a process. Cache entries and pending work are not shared across instances.

| Scenario | TransitScope-to-LinkBike upstream attempts |
| --- | --- |
| One continuously active warm instance | Approximately 12 per source per hour, **24 total** at the default TTL. Idle instances refresh only when asked. |
| `N` continuously active warm instances | Approximately **`24 × N` per hour** at the default TTL. |
| Cold starts and process replacement | Each new or restarted instance can issue **two immediate requests** when first used. `N` simultaneous cold instances can issue `2 × N` attempts. Repeated replacement can exceed the warm-rate estimate. |
| `U` users opening simultaneously | Up to `U` browser GETs. A single warm instance with both sources cached makes zero upstream attempts. One cold instance makes up to two. Separate cold instances could make up to `2 × U` immediate attempts. |
| Repeated upstream failures | Each failing source is cached for the same TTL. One warm instance attempts that source about 12 times per hour under sustained demand. If both fail, about 24 total. Cold starts and replacement still apply. |
| Minimum configured TTL | Approximately 60 per source per hour, **120 total per continuously active warm instance**. |

Pausing hidden tabs reduces dashboard traffic and can reduce upstream attempts when a hidden request would have triggered an expired cache or cold instance. A browser abort cannot guarantee that a server or upstream request already in progress will stop.

There is no global request limit. Keep Production off until written permission or an applicable licence covers both sources, redistribution, attribution, retention, cache behavior and permitted polling volume. Use the default five-minute interval or a longer approved interval. If the operator requires a strict aggregate rate, the current per-instance design cannot enforce it. [Prior cache review](SM-1.6C-cache-and-polling-risk.md) · [Portal reuse audit](linkbike-portal-integration-audit.md#terms-and-data-reuse)

