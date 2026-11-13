# SM-1.6C — LinkBike cache and polling risk

## Server behavior

Source review shows separate in-process caches for Maintenance Portal inventory and consumer coordinates. Each stores its completed result for 300 seconds by default and shares pending work among concurrent requests for that source. Expiration is measured separately after each request finishes. Both successes and failures are cached. Expired inventory is replaced by the new result, including an unavailable result with no stations when the portal fails. Consumer failure leaves the effective coordinates unset. The upstream timeout is eight seconds. The adapter checks the content-length header and enforces the 512,000-byte cap while reading the body. It performs one fetch per expired source, with redirects treated as errors and no retry loop. The configurable TTL is bounded from 60 to 3,600 seconds. [Server adapter](../lib/linkbike.ts)

The route sends `Cache-Control: no-store` and the HTTP probe observed it on 404 and 200. These headers govern HTTP caching. The two source caches are in memory and are scoped to the server process. The earlier tests covered independent expiry, coalescing, timeout and dropping inventory after failure. This phase stopped before independently rerunning those tests. [API route](../app/api/micromobility/linkbike/route.ts) · [Prior resilience validation](SM-1.6B-direct-linkbike-integration-report.md#local-validation)

## Browser lifecycle

The active layer schedules the next request after the current fetch and JSON processing complete, so a mounted layer has one polling sequence and does not overlap its requests. The cleanup aborts the browser fetch and clears its timer on toggle off or unmount, including navigation away when the layer unmounts. An aborted browser request does not guarantee cancellation of already-started upstream work. A failed refresh clears the displayed inventory and schedules another attempt at the configured or default interval. The browser accepts a server-provided interval of at least 60 seconds. The current server caps it at 3,600 seconds. [Map mount condition](../components/transit-map.tsx) · [Polling effect](../components/linkbike-layer.tsx)

The implementation does not inspect page visibility. A hidden tab with the overlay open can continue to poll, subject to browser timer throttling. The source also contains no client-side timeout independent of the abort on unmount. A hung HTTP request therefore delays the next poll. On a future correction, pausing while hidden and resuming with at most one refresh when visible would reduce avoidable traffic without new infrastructure. Independently exercise hidden tabs, navigation, unmount and slow requests with a controlled browser clock before release.

## Upstream request estimates

Assumptions are sustained demand, default 300-second TTL, and one runtime process per instance. Rates are steady-state approximations. A new or restarted instance can make two immediate requests, one to each source.

| Scenario | Upstream estimate |
| --- | --- |
| One warm instance | About 12 requests per source per hour, **24 total per hour**, with sustained demand. Idle instances fetch on demand. |
| `N` continuously active instances | About **24 × N per hour**, plus cold starts or process replacement. A simultaneous cold start of `N` instances can generate **2 × N** immediate requests. |
| `U` users opening the overlay together | Approximately `U` browser GETs. If served by one cold instance, two upstream requests total. If each lands on a distinct cold instance, up to `2 × U` immediate upstream requests. |
| Repeated upstream failure | On one warm instance with a fixed default TTL, the failed source is attempted about 12 times per hour, with no immediate retries. If both fail, about 24 attempts per hour total. Instance churn still permits cold-start bursts. |
| Smallest allowed TTL, 60 seconds | About 60 requests per source per hour, or **120 total per continuously active instance**. |

There is no shared cache, global rate limit or global retry budget. Direct anonymous API clients can create more demand than the map alone. Keep the feature off until the operator's polling allowance is established. Retain the five-minute default or use a longer approved interval, and reduce hidden-tab traffic before public enablement. If the operator requires a strict aggregate limit, the current design cannot guarantee it.

