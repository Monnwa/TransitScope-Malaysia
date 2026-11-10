import { BusEvidencePersistence, emptyDuration, evidenceFailure, recordDuration, type EvidenceBackend, type EvidenceFailure, type EvidenceReadResult, type EvidenceStatus, type EvidenceTransportMetrics, type EvidenceWrite, type EvidenceWriteResult } from "@/lib/bus-evidence";

/** Atomic revision check plus absolute, measurement-based expiry. No local filesystem state. */
export const EVIDENCE_CAS_SCRIPT = `
local previous = redis.call('GET', KEYS[1])
local revision = 0
local old = nil
if previous then
  local ok, decoded = pcall(cjson.decode, previous)
  if not ok then return -2 end
  old = decoded
  revision = tonumber(old.revision) or 0
end
if revision ~= tonumber(ARGV[1]) then return 0 end
local incoming = cjson.decode(ARGV[2])
if incoming.scope.key ~= KEYS[1] or incoming.revision ~= revision + 1 then return -2 end
if old and old.checkpoint.timestamp > incoming.checkpoint.timestamp then return -3 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('PEXPIREAT', KEYS[1], ARGV[3])
return 1`;

export const EVIDENCE_BATCH_LIMITS = { items: 40, targetBytes: 256000, maximumBytes: 4000000, concurrency: 3 } as const;
function batches<T>(values: T[], bytes: (value: T) => number): T[][] {
  const result: T[][] = []; let batch: T[] = [], size = 2;
  for (const value of values) { const next = bytes(value) + 1; if (batch.length && (batch.length >= EVIDENCE_BATCH_LIMITS.items || size + next > EVIDENCE_BATCH_LIMITS.targetBytes)) { result.push(batch); batch = []; size = 2; } batch.push(value); size += next; }
  if (batch.length) result.push(batch); return result;
}
/** A failed worker never rejects its siblings. Await all started requests; stop dispatch after abort. */
async function pooled<T>(values: T[], signal: AbortSignal | undefined, work: (value: T) => Promise<void>, fail: (value: T, kind: EvidenceFailure) => void): Promise<void> {
  let index = 0;
  await Promise.allSettled(Array.from({ length: Math.min(EVIDENCE_BATCH_LIMITS.concurrency, values.length) }, async () => {
    for (;;) { const i = index++; if (i >= values.length) return; if (signal?.aborted) { fail(values[i], "TIMEOUT"); continue; } try { await work(values[i]); } catch (error) { fail(values[i], evidenceFailure(error)); } }
  }));
}
class EvidenceRequestError extends Error {
  constructor(readonly kind: EvidenceFailure) { super(`Evidence request ${kind.toLowerCase()}`); }
}

export class RedisRestEvidenceBackend implements EvidenceBackend {
  private endpoint: string;
  private metrics: EvidenceTransportMetrics = { requests: 0, timeouts: 0, connectionFailures: 0, requestLatency: emptyDuration(), readBatchDuration: emptyDuration(), writeBatchDuration: emptyDuration(), recentRequests: [], connectionTime: "NOT_OBSERVED_BY_FETCH", serverExecutionTime: "NOT_MEASURED" };
  constructor(url: string, private token: string, private fetcher: typeof fetch = fetch, private timeoutMs = 1800) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !token.trim()) throw new Error("Invalid server-only Redis REST configuration");
    this.endpoint = endpoint.toString().replace(/\/$/, "");
  }
  instrumentation(): EvidenceTransportMetrics { return structuredClone(this.metrics); }
  private async request(body: unknown, pipeline = false, signal?: AbortSignal): Promise<unknown> {
    const started = performance.now(), combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs); let outcome: "OK" | EvidenceFailure = "OK";
    this.metrics.requests++;
    try {
      const encoded = JSON.stringify(body); if (Buffer.byteLength(encoded) > EVIDENCE_BATCH_LIMITS.maximumBytes) throw new EvidenceRequestError("INVALID");
      const response = await this.fetcher(this.endpoint + (pipeline ? "/pipeline" : ""), { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: encoded, signal: combined, cache: "no-store" });
      if (!response.ok) throw new EvidenceRequestError("UNAVAILABLE");
      const text = await response.text(); if (text.length > 4_000_000) throw new EvidenceRequestError("INVALID");
      try { return JSON.parse(text); } catch { throw new EvidenceRequestError("INVALID"); }
    } catch (error) {
      outcome = combined.aborted ? "TIMEOUT" : evidenceFailure(error);
      if (outcome === "TIMEOUT") this.metrics.timeouts++; if (outcome === "CONNECTION") this.metrics.connectionFailures++;
      throw new EvidenceRequestError(outcome); // Provider bodies, endpoint and token never enter diagnostics.
    } finally {
      const durationMs = performance.now() - started; recordDuration(this.metrics.requestLatency, durationMs);
      this.metrics.recentRequests.push({ kind: pipeline ? "EVAL" : "MGET", durationMs, outcome }); this.metrics.recentRequests = this.metrics.recentRequests.slice(-32);
    }
  }
  async read(keys: string[], signal?: AbortSignal, onResult?: (result: EvidenceReadResult) => void): Promise<Map<string, unknown>> {
    const started = performance.now(), values = new Map<string, unknown>(); let failure: EvidenceFailure | undefined;
    const failed = (batch: string[], kind: EvidenceFailure) => { failure = kind; for (const key of batch) onResult?.({ key, state: kind }); };
    await pooled(batches([...new Set(keys)], key => Buffer.byteLength(JSON.stringify(key))), signal, async batch => {
      const response = await this.request(["MGET", ...batch], false, signal) as { result?: unknown; error?: unknown } | null;
      if (!response || response.error || !Array.isArray(response.result) || response.result.length > batch.length) throw new EvidenceRequestError("INVALID");
      for (let i = 0; i < batch.length; i++) {
        const key = batch[i], value = response.result[i];
        if (value === null) { onResult?.({ key, state: "MISSING" }); continue; }
        if (typeof value !== "string") { failure = "INVALID"; onResult?.({ key, state: "INVALID" }); continue; }
        let document: unknown; try { document = JSON.parse(value); } catch { values.set(key, null); onResult?.({ key, state: "INVALID" }); continue; }
        values.set(key, document); onResult?.({ key, state: "FOUND", value: document });
      }
    }, failed);
    recordDuration(this.metrics.readBatchDuration, performance.now() - started);
    if (failure && !onResult) throw new EvidenceRequestError(failure);
    return values;
  }
  async compareAndSet(writes: EvidenceWrite[], signal?: AbortSignal, onResult?: (result: EvidenceWriteResult) => void): Promise<boolean[]> {
    const started = performance.now(), results = writes.map(() => false); let failure: EvidenceFailure | undefined;
    const commands = writes.map((write, index) => ({ index, command: ["EVAL", EVIDENCE_CAS_SCRIPT, "1", write.key, String(write.expectedRevision), JSON.stringify(write.document), String(write.expiresAt)] }));
    const failed = (batch: typeof commands, kind: EvidenceFailure) => { failure = kind; for (const item of batch) onResult?.({ index: item.index, state: kind }); };
    await pooled(batches(commands, item => Buffer.byteLength(JSON.stringify(item.command))), signal, async batch => {
      const response = await this.request(batch.map(item => item.command), true, signal);
      if (!Array.isArray(response) || response.length > batch.length) throw new EvidenceRequestError("INVALID");
      for (let i = 0; i < batch.length; i++) {
        const item = response[i], index = batch[i].index;
        if (!item || typeof item !== "object" || item.error || ![0, 1].includes(item.result)) { failure = "INVALID"; onResult?.({ index, state: "INVALID" }); continue; }
        results[index] = item.result === 1; onResult?.({ index, state: results[index] ? "SAVED" : "CONFLICT" });
      }
    }, failed);
    recordDuration(this.metrics.writeBatchDuration, performance.now() - started);
    if (failure && !onResult) throw new EvidenceRequestError(failure);
    return results;
  }
}

export function configuredBusEvidence(env: Record<string, string | undefined> = process.env): { persistence?: BusEvidencePersistence; status: EvidenceStatus } {
  const retentionMinutes = Number(env.TRANSIT_EVIDENCE_RETENTION_MINUTES ?? 60), url = env.TRANSIT_EVIDENCE_REDIS_REST_URL, token = env.TRANSIT_EVIDENCE_REDIS_REST_TOKEN;
  const status: EvidenceStatus = { mode: "DISABLED", state: "DISABLED", retentionMinutes: Number.isInteger(retentionMinutes) ? retentionMinutes : 60, loaded: 0, saved: 0, rejected: 0, conflicts: 0, failures: 0 };
  if (!url && !token) return { status };
  try {
    if (!url || !token) throw new Error("Incomplete configuration");
    const persistence = new BusEvidencePersistence(new RedisRestEvidenceBackend(url, token), retentionMinutes);
    return { persistence, status: persistence.status() };
  } catch { return { status: { ...status, state: "DEGRADED", failures: 1 } }; }
}
