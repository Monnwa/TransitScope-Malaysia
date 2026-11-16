import { afterEach, describe, expect, it, vi } from "vitest";
import { BusEvidencePersistence, mergeEvidence, readEvidence, type EvidenceBackend, type EvidenceWrite } from "@/lib/bus-evidence";
import { RedisRestEvidenceBackend } from "@/lib/redis-evidence-store";
import { ProcessedBusJourneys, type BusJourneyFeed } from "@/lib/processed-bus-journeys";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import { adherenceFixture, adherencePoint } from "@/tests/fixtures/adherence";
import { TestEvidenceBackend } from "@/tests/fixtures/evidence-store";
import type { Record as TransitRecord } from "@/lib/transit-data";

function scenario(retention = 60) {
  const fixture = adherenceFixture(); let clock = fixture.now - 120000;
  const backend = new TestEvidenceBackend(() => clock);
  const feed: BusJourneyFeed = { timetable: fixture.table, tripPaths: new Map([["t", fixture.path]]), progressPaths: new Map([["t", fixture.path]]), tripShapeDistances: new Map() };
  const processor = (remote: EvidenceBackend = backend) => { const history = new VehicleProgressHistory(), persistence = new BusEvidencePersistence(remote, retention, "TEST"), store = new ProcessedBusJourneys(history, persistence); return { history, persistence, store }; };
  const record = (metres: number, time: number, patch: Partial<TransitRecord> = {}): TransitRecord => ({ ...fixture.bus, position: adherencePoint(metres), reportedAt: new Date(time).toISOString(), feedPublishedAt: new Date(time + 1000).toISOString(), lastUpdatedAt: new Date(time + 2000).toISOString(), observation: { ...fixture.bus.observation, positionTimestamp: new Date(time).toISOString() }, ...patch });
  const process = async (p: ReturnType<typeof processor>, metres: number, time: number, patch: Partial<TransitRecord> = {}) => { clock = time; const records = p.history.ingest("rapid-bus-kl", [record(metres, time, patch)], time); return (await p.store.processWithPersistence("rapid-bus-kl", records, feed, time))[0].journey!; };
  const seed = async (p: ReturnType<typeof processor>) => { for (const [metres, ago] of [[90, 120], [200, 90], [600, 60], [900, 30], [1100, 0]]) await process(p, metres, fixture.now - ago * 1000); };
  return { ...fixture, backend, feed, processor, record, process, seed, setClock: (now: number) => { clock = now; } };
}
afterEach(()=>vi.useRealTimers());

describe("persistent accepted bus evidence", () => {
  it("restores validated passage evidence across processor restarts, requiring fresh local movement", async () => {
    const f = scenario(), initial = f.processor(); await f.seed(initial);
    expect([...f.backend.values.values()][0].value.checkpoint.passages.filter(e => e.confirmedAt)).toHaveLength(3);
    const restarted = f.processor(), first = await f.process(restarted, 1150, f.now + 30000);
    expect(first.stops.every(stop => !stop.adherence?.result)).toBe(true); expect(first.tracking?.source).toBe("APPROXIMATE");
    const second = await f.process(restarted, 1250, f.now + 60000);
    expect(second.stops.slice(1, 4).map(stop => stop.adherence?.status)).toEqual(["DELAYED", "ON_TIME", "EARLY"]);
    expect(restarted.persistence.status().loaded).toBe(1);
  });
  it("preserves original GPS coordinates, vehicle ID and all three clock meanings", async () => {
    const f = scenario(), p = f.processor(); await f.process(p, 90, f.now);
    const doc = [...f.backend.values.values()][0].value, observation = doc.observations[0];
    expect(doc.scope.vehicleId).toBe(f.bus.id); expect(observation.fix.position).toEqual(adherencePoint(90)); expect(observation.fix.timestamp).toBe(f.now);
    expect(observation.feedPublishedAt).toBe(new Date(f.now + 1000).toISOString()); expect(observation.receivedAt).toBe(new Date(f.now + 2000).toISOString()); expect(observation.validatedAt).toBe(f.now);
  });
  it("does not extend a duplicate's lifetime or append repeated/out-of-order measurements", async () => {
    const f = scenario(), p = f.processor(); await f.process(p, 90, f.now);
    const before = structuredClone([...f.backend.values.values()][0]), writes = f.backend.writes;
    await f.process(p, 90, f.now); await f.process(p, 80, f.now - 10000);
    const after = [...f.backend.values.values()][0]; expect(after.value.observations).toHaveLength(1); expect(after.expiresAt).toBe(before.expiresAt); expect(after.value.checkpoint.timestamp).toBe(f.now); expect(f.backend.writes).toBe(writes);
  });
  it("prunes observations and passage pairs at the configured measurement-based expiry", async () => {
    const f = scenario(1), p = f.processor(); await f.process(p, 90, f.now - 60000); await f.process(p, 200, f.now - 30000); await f.process(p, 600, f.now);
    const doc = [...f.backend.values.values()][0].value;
    expect(doc.observations.map(o => o.fix.timestamp)).toEqual([f.now - 30000, f.now]);
    expect(readEvidence(doc, doc.scope, f.now + 60000, 60000)).toBeNull();
    f.setClock(f.now + 60000); expect(await f.backend.read([doc.scope.key])).toEqual(new Map());
  });
  it("keeps 60-minute accepted history for audit without replaying expired movement into progress", async () => {
    const f = scenario(), initial = f.processor(); await f.seed(initial);
    f.setClock(f.now + 1800000); const restarted = f.processor(), j = await f.process(restarted, 1250, f.now + 1800000);
    expect(j.stops.every(stop => !stop.adherence?.result)).toBe(true); expect(j.tracking?.source).toBe("APPROXIMATE");
    expect([...f.backend.values.values()][0].value.observations.length).toBeGreaterThan(2);
  });
  it.each([[0, 0], [91, 101.69], [3.14, 181], [NaN, 101.69]] as [number, number][])("never persists invalid coordinates %j", async (lat, lon) => {
    const f = scenario(), p = f.processor(); await f.process(p, 90, f.now, { position: [lat, lon] }); expect(f.backend.values.size).toBe(0);
  });
  it.each(["missing", "invalid", "stale", "future"])("does not persist %s measurement timestamps or replace them with publication time", async mode => {
    const f = scenario(), p = f.processor(), stamp = mode === "missing" ? undefined : mode === "invalid" ? "nonsense" : new Date(f.now + (mode === "future" ? 31000 : -121000)).toISOString();
    await f.process(p, 90, f.now, { observation: { ...f.bus.observation, positionTimestamp: stamp }, reportedAt: stamp ?? null }); expect(f.backend.values.size).toBe(0);
  });
  it("does not persist a rejected jump, poor route match, clamped movement or poor reported accuracy", async () => {
    const f = scenario(), p = f.processor(); await f.process(p, 90, f.now - 30000); await f.process(p, 200, f.now);
    const writes = f.backend.writes; await f.process(p, 2200, f.now + 1000); expect(f.backend.writes).toBe(writes);
    const far = f.processor(); await f.process(far, 90, f.now + 30000, { position: [3.5, 101.69] }); expect(f.backend.writes).toBe(writes);
    const poor = f.processor(); await f.process(poor, 250, f.now + 40000, { observation: { ...f.bus.observation, positionTimestamp: new Date(f.now + 40000).toISOString(), gpsAccuracyM: 51 } }); expect(f.backend.writes).toBe(writes);
  });
  it("does not persist positions clamped for visual progress stability", async () => {
    const f=scenario(),p=f.processor();await f.process(p,90,f.now-30000);await f.process(p,200,f.now);const writes=f.backend.writes;
    const j=await f.process(p,195,f.now+30000);expect(j.tracking?.rawDistanceM).toBeLessThan(j.tracking!.distanceM!);expect(f.backend.writes).toBe(writes);
  });
  it("rechecks real processing freshness after storage I/O rather than freezing the pre-read clock",async()=>{
    const f=scenario(),history=new VehicleProgressHistory();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(f.now);
    const persistence=new BusEvidencePersistence({read:async()=>{vi.setSystemTime(f.now+121000);return new Map();},compareAndSet:async()=>{throw Error("Stale GPS must not be written");}},60,"TEST"),store=new ProcessedBusJourneys(history,persistence),records=history.ingest("rapid-bus-kl",[f.record(1100,f.now)],f.now);
    const j=(await store.processWithPersistence("rapid-bus-kl",records,f.feed))[0].journey!;expect(j.tracking?.source).toBe("STALE");expect(j.stops.every(s=>!s.adherence?.result)).toBe(true);
  });
  it("never bridges a rejected GPS interval with persisted raw fixes after a restart",async()=>{
    const f=scenario(),first=f.processor();await f.process(first,90,f.now-30000);await f.process(first,200,f.now);await f.process(first,2200,f.now+1000);
    const restart=f.processor(),j=await f.process(restart,1100,f.now+30000);expect(j.tracking?.source).toBe("APPROXIMATE");expect(j.stops.every(s=>!s.adherence?.result)).toBe(true);
  });
  it("fails open on storage outages, recovers, and never requires opening a detail panel", async () => {
    const f = scenario(), p = f.processor(); f.backend.failRead = true; f.backend.failWrite = true; await f.seed(p);
    const current = await f.process(p, 1250, f.now + 30000); expect(current.stops.filter(stop => stop.adherence?.result)).toHaveLength(3); expect(p.persistence.status().state).toBe("DEGRADED");
    f.backend.failRead = false; f.backend.failWrite = false; await f.process(p, 1300, f.now + 60000); expect(p.persistence.status().state).toBe("READY"); expect(f.backend.values.size).toBe(1);
  });
  it("merges concurrent writers atomically without losing confirmed passages or rewinding the checkpoint", async () => {
    const f = scenario(), p = f.processor(); await f.seed(p);
    const doc = structuredClone([...f.backend.values.values()][0].value), newer = structuredClone(doc), older = structuredClone(doc);
    newer.checkpoint.timestamp += 30000; newer.observations.push({ ...structuredClone(newer.observations.at(-1)!), fix: { ...structuredClone(newer.observations.at(-1)!.fix), timestamp: newer.checkpoint.timestamp } });
    older.checkpoint.passages = []; older.checkpoint.timestamp -= 30000;
    const merged = mergeEvidence(newer, older, f.now + 30000, 3600000); expect(merged.checkpoint.timestamp).toBe(newer.checkpoint.timestamp); expect(merged.checkpoint.passages).toHaveLength(newer.checkpoint.passages.length);
    const a = f.processor(), b = f.processor(); await Promise.all([f.process(a, 1150, f.now + 30000), f.process(b, 1150, f.now + 30000)]);
    expect([...f.backend.values.values()][0].value.observations.filter(o => o.fix.timestamp === f.now + 30000)).toHaveLength(1);
  });
  it("rejects corrupted coordinates, timestamps, pair arithmetic and mismatched scope on restore", async () => {
    const f = scenario(), p = f.processor(); await f.seed(p); const original = [...f.backend.values.values()][0].value;
    for (const mutate of [(doc: typeof original) => { doc.observations[0].fix.position = [0, 0]; }, (doc: typeof original) => { doc.observations[0].validatedAt += 121000; }, (doc: typeof original) => { doc.checkpoint.passages[0].inferredPassageTime = new Date(0).toISOString(); }, (doc: typeof original) => { doc.scope.vehicleId = "different"; }]) {
      const bad = structuredClone(original); mutate(bad); expect(readEvidence(bad, original.scope, f.now, 3600000)).toBeNull();
    }
  });
  it("does not reuse another vehicle, run, direction, static timetable or source's evidence", async () => {
    const f = scenario(), p = f.processor(); await f.seed(p);
    const other = f.processor(); const j = await f.process(other, 1150, f.now + 30000, { id: "different-vehicle" }); expect(j.stops.every(stop => !stop.adherence?.result)).toBe(true);
    const feed = { ...f.feed, timetable: { ...f.feed.timetable, source: "different official archive version" } }, history = new VehicleProgressHistory(), persistence = new BusEvidencePersistence(f.backend, 60, "TEST"), store = new ProcessedBusJourneys(history, persistence), records = history.ingest("rapid-bus-kl", [f.record(1200, f.now + 60000)], f.now + 60000);
    const changed = (await store.processWithPersistence("rapid-bus-kl", records, feed, f.now + 60000))[0].journey!; expect(changed.stops.every(stop => !stop.adherence?.result)).toBe(true);
  });
  it("keeps non-exact or interpolated timetable references unavailable even with restored GPS pairs", async () => {
    const f = scenario(), p = f.processor(); await f.seed(p); f.feed.timetable.byTrip.get("t")![2].timepoint = "0";
    const freshFeed = { ...f.feed }, history = new VehicleProgressHistory(), persistence = new BusEvidencePersistence(f.backend, 60, "TEST"), store = new ProcessedBusJourneys(history, persistence);
    for (const [metres, time] of [[1150, f.now + 30000], [1250, f.now + 60000]]) { const records = history.ingest("rapid-bus-kl", [f.record(metres, time)], time); const j = (await store.processWithPersistence("rapid-bus-kl", records, freshFeed, time))[0].journey!; expect(j.stops[2].adherence?.result).toBeNull(); }
  });
  it("caches forty valid vehicle histories before a peer timeout, survives a restart and recovers the failed vehicle", async () => {
    const f = scenario(), ids = Array.from({ length: 41 }, (_, i) => `PARTIAL-${i}`);
    for (const id of ids) { const seed = f.processor(); for (const [m, ago] of [[90, 120], [200, 90], [600, 60], [900, 30], [1100, 0]]) await f.process(seed, m, f.now - ago * 1000, { id }); }
    const blocked = [...f.backend.values.values()].find(e => e.value.scope.vehicleId === ids[40])!.value.scope.key; let broken = true;
    const rest = new RedisRestEvidenceBackend("https://redis.test", "secret", async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (!String(url).endsWith("/pipeline")) {
        if (broken && body.includes(blocked)) return new Promise<Response>((_resolve, reject) => { options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true }); if (options?.signal?.aborted) reject(options.signal.reason); });
        const result = await f.backend.read(body.slice(1)); return new Response(JSON.stringify({ result: body.slice(1).map((key: string) => result.has(key) ? JSON.stringify(result.get(key)) : null) }));
      }
      const success = await f.backend.compareAndSet(body.map((cmd: string[]): EvidenceWrite => ({ key: cmd[3], expectedRevision: Number(cmd[4]), document: JSON.parse(cmd[5]), expiresAt: Number(cmd[6]), ttlMs: 3600000 })));
      return new Response(JSON.stringify(success.map(ok => ({ result: ok ? 1 : 0 }))));
    }, 50);
    const restarted = f.processor(rest);
    const step = async (m: number, time: number) => { f.setClock(time); const records = restarted.history.ingest("rapid-bus-kl", ids.map(id => f.record(m, time, { id })), time); return restarted.store.processWithPersistence("rapid-bus-kl", records, f.feed, time); };
    const first = step(1150, f.now + 30000);
    await vi.waitFor(() => expect(restarted.persistence.status().loaded).toBe(40), { interval: 1 }); await first;
    const partial = await step(1250, f.now + 60000);
    expect(partial.flatMap(e => e.journey!.stops).filter(s => s.adherence?.result)).toHaveLength(120);
    expect(partial.at(-1)!.journey!.stops.every(s => !s.adherence?.result)).toBe(true); expect(restarted.persistence.status().metrics!.histories.timeout).toBeGreaterThan(0);
    broken = false; const recovered = await step(1300, f.now + 90000);
    expect(recovered.flatMap(e => e.journey!.stops).filter(s => s.adherence?.result)).toHaveLength(123); expect(restarted.persistence.status().state).toBe("READY");
  });
  it("does not erase a valid cached history after a failed conflict reread", async () => {
    const f = scenario(), seed = f.processor(); await f.seed(seed); let reads = 0;
    const remote: EvidenceBackend = { read: async keys => { reads++; if (reads > 1) throw new TypeError("interrupted"); return f.backend.read(keys); }, compareAndSet: async writes => writes.map(() => false) };
    const first = f.processor(remote); await f.process(first, 1150, f.now + 30000); expect(first.persistence.status().state).toBe("DEGRADED");
    const history = new VehicleProgressHistory(); const record = f.record(1200, f.now + 60000); history.ingest("rapid-bus-kl", [record], f.now + 60000);
    const prepared = first.persistence.prepare("rapid-bus-kl", [record], f.feed, id => history.get("rapid-bus-kl", id), f.now + 60000), before = reads;
    const restored = await first.persistence.hydrate(prepared, f.now + 60000);
    expect(reads).toBe(before); expect(restored.get(record.id)?.previous?.passages?.filter(p => p.confirmedAt)).toHaveLength(3);
  });
  it("keeps retry attempts bounded and never converts a failed write into a conflict", async () => {
    const f = scenario(); let conflicts = 0;
    const conflict = f.processor({ read: async () => new Map(), compareAndSet: async writes => { conflicts++; return writes.map(() => false); } });
    await f.process(conflict, 90, f.now); expect(conflicts).toBe(2); expect(conflict.persistence.status().metrics!.retries).toBe(1); expect(conflict.persistence.status().state).toBe("DEGRADED");
    let failures = 0; const failed = f.processor({ read: async () => new Map(), compareAndSet: async (writes, _signal, onResult) => { failures++; writes.forEach((_, index) => onResult?.({ index, state: "TIMEOUT" })); return writes.map(() => false); } });
    await f.process(failed, 90, f.now); expect(failures).toBe(1); expect(failed.persistence.status().conflicts).toBe(0); expect(failed.persistence.status().metrics!.retries).toBe(0);
  });
  it("retains independently valid histories while rejecting a corrupt peer document", async () => {
    const f = scenario(), seed = f.processor(); await f.seed(seed);
    for (const [m, ago] of [[90, 120], [200, 90], [600, 60], [900, 30], [1100, 0]]) await f.process(seed, m, f.now - ago * 1000, { id: "CORRUPT" });
    const broken = f.processor({ read: async keys => new Map(keys.map(key => { const value = structuredClone(f.backend.values.get(key)!.value); if (value.scope.vehicleId === "CORRUPT") value.observations[0].fix.position = [0, 0]; return [key, value]; })), compareAndSet: async () => { throw new Error("outage"); } });
    let results: Awaited<ReturnType<ProcessedBusJourneys["processWithPersistence"]>> = [];
    for (const [m, time] of [[1150, f.now + 30000], [1250, f.now + 60000]]) { f.setClock(time); const records = broken.history.ingest("rapid-bus-kl", [f.record(m, time), f.record(m, time, { id: "CORRUPT" })], time); results = await broken.store.processWithPersistence("rapid-bus-kl", records, f.feed, time); }
    expect(results[0].journey!.stops.filter(s => s.adherence?.result)).toHaveLength(3); expect(results[1].journey!.stops.every(s => !s.adherence?.result)).toBe(true);
    expect(broken.persistence.status().loaded).toBe(1); expect(broken.persistence.status().metrics!.histories.invalid).toBe(2);
  });
});
