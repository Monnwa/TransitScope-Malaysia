import { describe, expect, it, vi } from "vitest";
import { configuredBusEvidence, EVIDENCE_CAS_SCRIPT, RedisRestEvidenceBackend } from "@/lib/redis-evidence-store";
import type { EvidenceWrite } from "@/lib/bus-evidence";

describe("serverless Redis REST transport", () => {
  it("leaves remote storage disabled until explicitly configured and never exposes credentials in status", () => {
    expect(configuredBusEvidence({}).status.state).toBe("DISABLED");
    for (const env of [{ TRANSIT_EVIDENCE_REDIS_REST_URL: "http://unsafe.test", TRANSIT_EVIDENCE_REDIS_REST_TOKEN: "secret" }, { TRANSIT_EVIDENCE_REDIS_REST_TOKEN: "secret" }, { TRANSIT_EVIDENCE_REDIS_REST_URL: "https://redis.test", TRANSIT_EVIDENCE_REDIS_REST_TOKEN: "secret", TRANSIT_EVIDENCE_RETENTION_MINUTES: "0" }]) { const result = configuredBusEvidence(env); expect(result.persistence).toBeUndefined(); expect(result.status.state).toBe("DEGRADED"); expect(JSON.stringify(result)).not.toContain("secret"); }
    const configured = configuredBusEvidence({ TRANSIT_EVIDENCE_REDIS_REST_URL: "https://redis.test", TRANSIT_EVIDENCE_REDIS_REST_TOKEN: "secret" }); expect(configured.persistence?.status().retentionMinutes).toBe(60); expect(JSON.stringify(configured.status)).not.toContain("secret");
  });
  it("uses bounded MGET batches and authenticates only server-side POST requests", async () => {
    let active = 0, maximum = 0;
    const fetcher = vi.fn(async (_url, options) => { active++; maximum = Math.max(maximum, active); const command = JSON.parse(String(options?.body)); expect(command[0]).toBe("MGET"); expect(command.length).toBeLessThanOrEqual(41); expect((options?.headers as Record<string, string>).Authorization).toBe("Bearer secret"); expect(options?.cache).toBe("no-store"); await new Promise(resolve => setTimeout(resolve, 1)); active--; return new Response(JSON.stringify({ result: command.slice(1).map((key: string) => JSON.stringify({ key })) })); });
    const backend = new RedisRestEvidenceBackend("https://redis.test", "secret", fetcher), keys = Array.from({ length: 85 }, (_, i) => `key-${i}`), result = await backend.read(keys);
    expect(result.size).toBe(85); expect(maximum).toBeLessThanOrEqual(3); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("writes atomic CAS commands with absolute expiry and reports revision conflicts", async () => {
    const fetcher = vi.fn(async (url, options) => { expect(String(url)).toBe("https://redis.test/pipeline"); const commands = JSON.parse(String(options?.body)); for (const command of commands) { expect(command.slice(0, 4)).toEqual(["EVAL", EVIDENCE_CAS_SCRIPT, "1", "key"]); expect(command[4]).toBe("2"); expect(command[6]).toBe("100000"); } return new Response(JSON.stringify(commands.map((_: unknown, i: number) => ({ result: i ? 0 : 1 })))); });
    const backend = new RedisRestEvidenceBackend("https://redis.test", "secret", fetcher), write = { key: "key", expectedRevision: 2, document: { revision: 3 }, ttlMs: 3000, expiresAt: 100000 } as EvidenceWrite;
    expect(await backend.compareAndSet([write, write])).toEqual([true, false]); expect(EVIDENCE_CAS_SCRIPT).toContain("PEXPIREAT"); expect(EVIDENCE_CAS_SCRIPT).toContain("old.checkpoint.timestamp > incoming.checkpoint.timestamp");
  });
  it("rejects incomplete/malformed backend responses and redacts provider errors", async () => {
    for (const response of [new Response("secret provider details", { status: 500 }), new Response(JSON.stringify({ result: [] })), new Response(JSON.stringify({ error: "secret provider details" }))]) {
      const backend = new RedisRestEvidenceBackend("https://redis.test", "secret", vi.fn(async () => response)); await expect(backend.read(["key"])).rejects.not.toThrow("secret");
    }
    const invalid = new RedisRestEvidenceBackend("https://redis.test", "secret", vi.fn(async () => new Response(JSON.stringify({ result: ["bad json"] })))); expect(await invalid.read(["key"])).toEqual(new Map([["key", null]]));
  });
  it("honours cancellation and a bounded HTTP timeout", async () => {
    const fetcher = vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => { options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); if (options?.signal?.aborted) reject(new Error("aborted")); }));
    const backend = new RedisRestEvidenceBackend("https://redis.test", "secret", fetcher, 10); await expect(backend.read(["key"])).rejects.toMatchObject({ kind: "TIMEOUT" });
  });
});
