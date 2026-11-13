import { LINKBIKE_CONSUMER, LINKBIKE_PORTAL, LINKBIKE_REFRESH_SECONDS, type LinkBikeResponse } from "./linkbike-data";
import { linkBikeStations, parseLinkBikeConsumer, parseLinkBikePortal } from "./linkbike-parser";

const MAX_RESPONSE_BYTES = 512_000;
const REQUEST_TIMEOUT_MS = 8_000;
type SourceResult<T> = { data: T; fetchedAt: string; warning: null } |
  { data: null; fetchedAt: string | null; warning: string };

async function readBody(response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("LinkBike response exceeded the size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("LinkBike response body was empty.");
  const decoder = new TextDecoder();
  let size = 0;
  let content = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return content + decoder.decode();
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("LinkBike response exceeded the size limit.");
      }
      content += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function cachedSource<T>(url: string, parse: (body: string) => T, refreshMs: number, timeoutMs: number) {
  let pending: Promise<SourceResult<T>> | undefined;
  let cached: { result: SourceResult<T>; expires: number } | undefined;
  async function load(): Promise<SourceResult<T>> {
    const signal = AbortSignal.timeout(timeoutMs);
    let fetchedAt: string | null = null;
    try {
      const response = await fetch(url, { signal, cache: "no-store", redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        return { data: null, fetchedAt: new Date().toISOString(), warning: `Upstream HTTP ${response.status}.` };
      }
      const body = await readBody(response);
      fetchedAt = new Date().toISOString();
      return { data: parse(body), fetchedAt, warning: null };
    } catch {
      const warning = signal.aborted ? "Upstream request timed out." : fetchedAt ?
        "Upstream response could not be parsed." : "Upstream request or response body failed validation.";
      return { data: null, fetchedAt, warning };
    }
  }
  return async () => {
    if (pending) return pending;
    if (cached && cached.expires > Date.now()) return cached.result;
    pending = load().then(result => {
      cached = { result, expires: Date.now() + refreshMs };
      return result;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

export function createLinkBikeSource(refreshSeconds = LINKBIKE_REFRESH_SECONDS, timeoutMs = REQUEST_TIMEOUT_MS) {
  const portal = cachedSource(LINKBIKE_PORTAL, parseLinkBikePortal, refreshSeconds * 1000, timeoutMs);
  const consumer = cachedSource(LINKBIKE_CONSUMER, parseLinkBikeConsumer, refreshSeconds * 1000, timeoutMs);
  return async (): Promise<LinkBikeResponse> => {
    const [inventory, coordinates] = await Promise.all([portal(), consumer()]);
    const coordinateWarning = coordinates.data?.rejected ?
      `${coordinates.data.rejected} consumer records quarantined.` : coordinates.warning;
    const stations = inventory.data ? linkBikeStations(inventory.data, inventory.fetchedAt, coordinates.data ?? undefined) : [];
    return {
      source: "LinkBike",
      status: inventory.data ? "UNVERIFIED" : "UNAVAILABLE",
      fetched_at: inventory.fetchedAt,
      upstream_updated_at: null,
      upstream_updated_at_raw: inventory.data?.updated ?? null,
      stations,
      source_health: {
        portal: {
          status: inventory.data ? inventory.data.warnings.length ? "DEGRADED" : "HEALTHY" : "UNAVAILABLE",
          fetched_at: inventory.fetchedAt,
          warning: inventory.warning,
        },
        consumer_json: {
          status: coordinates.data ? coordinateWarning ? "DEGRADED" : "HEALTHY" : "UNAVAILABLE",
          fetched_at: coordinates.fetchedAt,
          warning: coordinateWarning,
        },
      },
      refresh_seconds: refreshSeconds,
      excluded_stations: inventory.data?.excluded ?? 0,
      warnings: [inventory.warning, coordinateWarning].filter((warning): warning is string => warning !== null)
        .concat(inventory.data?.warnings ?? []),
    };
  };
}

const configuredRefresh = Number(process.env.LINKBIKE_REFRESH_SECONDS);
export const getLinkBike = createLinkBikeSource(
  Number.isInteger(configuredRefresh) && configuredRefresh >= 60 && configuredRefresh <= 3600 ?
    configuredRefresh : LINKBIKE_REFRESH_SECONDS,
);
