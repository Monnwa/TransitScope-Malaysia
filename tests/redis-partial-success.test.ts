import { describe, expect, it, vi } from "vitest";
import { RedisRestEvidenceBackend, EVIDENCE_BATCH_LIMITS } from "@/lib/redis-evidence-store";
import type { EvidenceReadResult, EvidenceWrite, EvidenceWriteResult } from "@/lib/bus-evidence";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `key-${i}`);
const pending = (signal?: AbortSignal | null) => new Promise<Response>((_resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
});
const write = (key: string, padding = ""): EvidenceWrite => ({ key, expectedRevision: 0, document: { revision: 1, padding } as unknown as EvidenceWrite["document"], expiresAt: 100000, ttlMs: 1000 });

describe("independent Redis request outcomes", () => {
  it("delivers a successful group before a single vehicle's peer request times out", async () => {
    const results: EvidenceReadResult[] = []; let active = 0;
    const fetcher: typeof fetch = vi.fn(async (_url, options) => {
      const cmd = JSON.parse(String(options?.body)); active++;
      try { return cmd.includes("key-40") ? await pending(options?.signal) : new Response(JSON.stringify({ result: cmd.slice(1).map((key: string) => JSON.stringify({ key })) })); }
      finally { active--; }
    });
    const backend = new RedisRestEvidenceBackend("https://redis.test", "secret", fetcher, 100);
    const operation = backend.read(keys(41), undefined, result => results.push(result));
    await vi.waitFor(() => expect(results.filter(r => r.state === "FOUND")).toHaveLength(40), { interval: 1, timeout: 80 });
    expect(results.some(r => r.state === "TIMEOUT")).toBe(false);
    const loaded = await operation; expect(loaded.size).toBe(40); expect(results.at(-1)).toEqual({ key: "key-40", state: "TIMEOUT" }); expect(active).toBe(0);
    expect(backend.instrumentation().timeouts).toBe(1); expect(backend.instrumentation().serverExecutionTime).toBe("NOT_MEASURED");
  });
  it("settles simultaneous timeouts and reports undispatched keys without exceeding three requests", async () => {
    let active = 0, maximum = 0; const results: EvidenceReadResult[] = [], controller = new AbortController();
    const fetcher: typeof fetch = vi.fn(async (_url, options) => {
      const cmd = JSON.parse(String(options?.body)); active++; maximum = Math.max(maximum, active);
      try { return cmd.includes("key-0") ? new Response(JSON.stringify({ result: cmd.slice(1).map(() => "{}") })) : await pending(options?.signal); }
      finally { active--; }
    });
    const backend = new RedisRestEvidenceBackend("https://redis.test", "secret", fetcher);
    const operation = backend.read(keys(161), controller.signal, result => results.push(result));
    await vi.waitFor(() => expect(results.filter(r => r.state === "FOUND")).toHaveLength(40), { interval: 1 }); controller.abort();
    expect((await operation).size).toBe(40); expect(results.filter(r => r.state === "TIMEOUT")).toHaveLength(121);
    expect(active).toBe(0); expect(maximum).toBeLessThanOrEqual(3); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("distinguishes missing, invalid and successful values within the same MGET", async () => {
    const results: EvidenceReadResult[] = [], backend = new RedisRestEvidenceBackend("https://redis.test", "secret", vi.fn(async () => new Response(JSON.stringify({ result: ['{"ok":true}', "bad json", null, 123] }))));
    await backend.read(keys(4), undefined, result => results.push(result));
    expect(results.map(r => r.state)).toEqual(["FOUND", "INVALID", "MISSING", "INVALID"]);
  });
  it("preserves successful entries even when an MGET envelope is truncated", async () => {
    const results: EvidenceReadResult[] = [], backend = new RedisRestEvidenceBackend("https://redis.test", "secret", vi.fn(async () => new Response(JSON.stringify({ result: ['{"ok":true}'] }))));
    expect((await backend.read(keys(2), undefined, result => results.push(result))).size).toBe(1); expect(results.map(r => r.state)).toEqual(["FOUND", "INVALID"]);
  });
  it("isolates a connection interruption and reuses the backend after recovery", async () => {
    let broken = true; const results: EvidenceReadResult[] = [];
    const backend = new RedisRestEvidenceBackend("https://redis.test", "secret", vi.fn(async (_url, options) => { const cmd = JSON.parse(String(options?.body)); if (broken && cmd.includes("key-40")) throw new TypeError("Network interrupted with private provider detail"); return new Response(JSON.stringify({ result: cmd.slice(1).map(() => "{}") })); }));
    expect((await backend.read(keys(41), undefined, r => results.push(r))).size).toBe(40); expect(results.find(r => r.key === "key-40")?.state).toBe("CONNECTION");
    broken = false; expect((await backend.read(keys(41))).size).toBe(41); expect(backend.instrumentation().connectionFailures).toBe(1); expect(JSON.stringify(backend.instrumentation())).not.toContain("private");
  });
  it("preserves per-key pipeline success and separates a conflict from a command error", async () => {
    const events: EvidenceWriteResult[] = [], backend = new RedisRestEvidenceBackend("https://redis.test", "secret", vi.fn(async () => new Response(JSON.stringify([{ result: 1 }, { error: "provider secret" }, { result: 0 }, { result: 1 }]))));
    expect(await backend.compareAndSet(keys(4).map(k => write(k)), undefined, r => events.push(r))).toEqual([true, false, false, true]); expect(events.map(r => r.state)).toEqual(["SAVED", "INVALID", "CONFLICT", "SAVED"]);
  });
  it("does not discard acknowledged writes when another pipeline request times out", async () => {
    const events: EvidenceWriteResult[] = [], backend = new RedisRestEvidenceBackend("https://redis.test", "secret", vi.fn(async (_url, options) => { const commands = JSON.parse(String(options?.body)); if (commands.some((c: string[]) => c[3] === "key-40")) return pending(options?.signal); return new Response(JSON.stringify(commands.map(() => ({ result: 1 })))); }), 20);
    expect((await backend.compareAndSet(keys(41).map(k => write(k)), undefined, r => events.push(r))).filter(Boolean)).toHaveLength(40); expect(events.filter(r => r.state === "SAVED")).toHaveLength(40); expect(events.at(-1)?.state).toBe("TIMEOUT");
  });
  it("bounds pipeline payloads by bytes as well as command count", async () => {
    const sizes: number[] = [], backend = new RedisRestEvidenceBackend("https://redis.test", "secret", vi.fn(async (_url, options) => { sizes.push(Buffer.byteLength(String(options?.body))); const commands = JSON.parse(String(options?.body)); return new Response(JSON.stringify(commands.map(() => ({ result: 1 })))); }));
    expect((await backend.compareAndSet(keys(6).map(k => write(k, "x".repeat(100000))))).every(Boolean)).toBe(true);
    expect(sizes).toHaveLength(3); expect(Math.max(...sizes)).toBeLessThanOrEqual(EVIDENCE_BATCH_LIMITS.targetBytes);
  });
  it("rejects a single oversized write without preventing other vehicle writes", async () => {
    const events: EvidenceWriteResult[] = [], fetcher: typeof fetch = vi.fn(async (_url, options) => new Response(JSON.stringify(JSON.parse(String(options?.body)).map(() => ({ result: 1 })))));
    const backend = new RedisRestEvidenceBackend("https://redis.test", "secret", fetcher);
    expect(await backend.compareAndSet([write("huge", "x".repeat(4000001)), write("normal")], undefined, r => events.push(r))).toEqual([false, true]);
    expect(events.find(r => r.index === 0)?.state).toBe("INVALID"); expect(events.find(r => r.index === 1)?.state).toBe("SAVED"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("deduplicates repeated read keys and keeps bounded credential-free request telemetry", async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({ result: [null] }))), backend = new RedisRestEvidenceBackend("https://redis.test", "secret", fetcher);
    await backend.read(["one", "one"]); for (let i = 0; i < 35; i++) await backend.read(["one"]);
    expect(fetcher).toHaveBeenCalledTimes(36); expect(backend.instrumentation().recentRequests).toHaveLength(32); expect(JSON.stringify(backend.instrumentation())).not.toMatch(/secret|redis\.test/);
  });
});
