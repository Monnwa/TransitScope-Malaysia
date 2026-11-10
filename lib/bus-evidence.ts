import { createHash } from "node:crypto";
import { z } from "zod";
import { calculateBusJourney, type BusJourney } from "@/lib/bus-journey";
import type { BusJourneyFeed } from "@/lib/processed-bus-journeys";
import type { Record as TransitRecord } from "@/lib/transit-data";
import type { ProgressHistory, VehicleProgress } from "@/lib/vehicle-progress";
import { validGpsPosition } from "@/lib/vehicle-observation";
import { PROGRESS_LIMITS as L } from "@/lib/route-projection";
import { inferStopPassage, strongerPassage, type PassageEvidence } from "@/lib/gps-passage";
import { diagnosticReasons } from "@/lib/adherence-diagnostics";

const number = z.number().finite(), stamp = number.int().positive(), text = z.string().min(1).max(24000);
const point = z.tuple([number, number]).refine(validGpsPosition);
const matchedFix = z.object({ timestamp: stamp, position: point, bearing: number.min(0).max(360).nullable(), speed: number.min(0).nullable(), accuracyM: number.min(0).max(L.highAccuracyM).nullable(), distanceM: number.min(0), rawDistanceM: number.min(0), offsetM: number.min(0).max(L.highRouteOffsetM), point, segment: number.int().min(0) }).refine(fix => Math.abs(fix.distanceM - fix.rawDistanceM) <= .05);
const passageObservation = z.object({ contextKey: text, vehicleId: text, tripId: text, routeId: text.nullable(), shapeId: text.nullable(), serviceDate: text, timestamp: stamp, distanceM: number.min(0), rawDistanceM: number.min(0), offsetM: number.min(0).max(L.highRouteOffsetM), accuracyM: number.min(0).max(L.highAccuracyM).nullable(), confidence: z.literal("HIGH") });
export const passageSchema = z.object({ stopId: text, sequence: number.int().min(0), stopDistanceM: number.min(0), inferredPassageTime: z.string().datetime(), from: passageObservation, to: passageObservation, intervalMs: number.positive().max(60000), confirmedAt: z.string().datetime().nullable() });
const scopeSchema = z.object({ key: text, source: text, vehicleId: text, contextKey: text, passageKey: text, tripId: text, routeId: text.nullable(), shapeId: text, serviceDate: text, runKey: text, staticVersion: text });
const observationSchema = z.object({ fix: matchedFix, validatedAt: stamp, feedPublishedAt: z.string().datetime().nullable(), receivedAt: z.string().datetime().nullable() });
const checkpointSchema = z.object({ timestamp: stamp, passages: z.array(passageSchema).max(2000), evidenceDiagnostics: z.array(z.object({ stopId: text, sequence: number.int().min(0), primary: z.enum(diagnosticReasons), secondary: z.array(z.string().max(200)).max(8) })).max(2000), observationsUsed: number.int().min(1).max(16) });
const documentSchema = z.object({ schema: z.literal(1), revision: number.int().min(1), scope: scopeSchema, observations: z.array(observationSchema).max(10000), checkpoint: checkpointSchema });
export type EvidenceDocument = z.infer<typeof documentSchema>;
export type EvidenceScope = EvidenceDocument["scope"];
export type EvidenceWrite = { key: string; expectedRevision: number; document: EvidenceDocument; ttlMs: number; expiresAt: number };
export type EvidenceFailure = "TIMEOUT" | "CONNECTION" | "UNAVAILABLE" | "INVALID";
export function evidenceFailure(error: unknown): EvidenceFailure {
  const value = error as { kind?: string; name?: string } | null;
  if (value?.kind && ["TIMEOUT", "CONNECTION", "UNAVAILABLE", "INVALID"].includes(value.kind)) return value.kind as EvidenceFailure;
  if (value?.name === "AbortError" || value?.name === "TimeoutError") return "TIMEOUT";
  return value?.name === "TypeError" ? "CONNECTION" : "UNAVAILABLE";
}
export type EvidenceReadResult = { key: string; state: "FOUND"; value: unknown } | { key: string; state: "MISSING" | EvidenceFailure };
export type EvidenceWriteResult = { index: number; state: "SAVED" | "CONFLICT" | EvidenceFailure };
export type EvidenceDuration = { count: number; totalMs: number; lastMs: number; maxMs: number };
export const emptyDuration = (): EvidenceDuration => ({ count: 0, totalMs: 0, lastMs: 0, maxMs: 0 });
export function recordDuration(metric: EvidenceDuration, ms: number) { metric.count++; metric.totalMs += ms; metric.lastMs = ms; metric.maxMs = Math.max(metric.maxMs, ms); }
export type EvidenceTransportMetrics = { requests: number; timeouts: number; connectionFailures: number; requestLatency: EvidenceDuration; readBatchDuration: EvidenceDuration; writeBatchDuration: EvidenceDuration; recentRequests: { kind: "MGET" | "EVAL"; durationMs: number; outcome: "OK" | EvidenceFailure }[]; connectionTime: "NOT_OBSERVED_BY_FETCH"; serverExecutionTime: "NOT_MEASURED" };
export interface EvidenceBackend {
  read(keys: string[], signal?: AbortSignal, onResult?: (result: EvidenceReadResult) => void): Promise<Map<string, unknown>>;
  compareAndSet(writes: EvidenceWrite[], signal?: AbortSignal, onResult?: (result: EvidenceWriteResult) => void): Promise<boolean[]>;
  instrumentation?(): EvidenceTransportMetrics;
}
export type EvidenceMetrics = { histories: { found: number; missing: number; invalid: number; timeout: number; connection: number; unavailable: number }; cachePopulation: EvidenceDuration; retrieval: EvidenceDuration; fleetProcessing: EvidenceDuration; retries: number; retryDuration: EvidenceDuration };
export type EvidenceStatus = { mode: "DISABLED" | "REDIS_REST" | "TEST"; state: "READY" | "DEGRADED" | "DISABLED"; retentionMinutes: number; loaded: number; saved: number; rejected: number; conflicts: number; failures: number; metrics?: EvidenceMetrics; transport?: EvidenceTransportMetrics };
type Prepared = { scope: EvidenceScope; preview: BusJourney; record: TransitRecord; history?: ProgressHistory };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const versions = new WeakMap<BusJourneyFeed, Map<string, string>>();

function scopeFor(source: string, record: TransitRecord, feed: BusJourneyFeed, preview: BusJourney): EvidenceScope | null {
  const tracking = preview.tracking, run = preview.vehicleDeparture;
  if (!run || preview.match.status !== "MATCHED" || !tracking?.shapeId || !tracking.stopProjections.length || !feed.progressPaths?.has(run.tripId)) return null;
  let trips = versions.get(feed); if (!trips) { trips = new Map(); versions.set(feed, trips); }
  let version = trips.get(run.tripId);
  if (!version) {
    const times = feed.timetable.byTrip.get(run.tripId) ?? [];
    version = digest([feed.timetable.source, feed.timetable.trips.get(run.tripId), feed.timetable.routes.get(preview.route?.id ?? ""), times, times.map(row => feed.timetable.stops.get(row.stop_id)), feed.progressPaths.get(run.tripId), feed.tripShapeDistances.get(run.tripId), feed.timetable.calendars, feed.timetable.exceptions, feed.timetable.frequencies.get(run.tripId)]);
    trips.set(run.tripId, version);
  }
  const context = { source, vehicleId: record.id, contextKey: tracking.key, passageKey: tracking.passageKey ?? tracking.key, tripId: run.tripId, routeId: preview.route?.id ?? null, shapeId: tracking.shapeId, serviceDate: run.serviceDate, runKey: run.key, staticVersion: version };
  return { key: `transitscope:evidence:v1:${digest(context)}`, ...context };
}

function validPassage(e: PassageEvidence, scope: EvidenceScope): boolean {
  if ([e.from, e.to].some(f => f.contextKey !== scope.passageKey || f.vehicleId !== scope.vehicleId || f.tripId !== scope.tripId || f.routeId !== scope.routeId || f.shapeId !== scope.shapeId || f.serviceDate !== scope.serviceDate)) return false;
  const inferred = inferStopPassage({ id: e.stopId, sequence: e.sequence, name: "", distanceM: e.stopDistanceM, offsetM: 0, confidence: "HIGH", reason: null }, e.from, e.to, e.to.timestamp);
  // Verify historical arithmetic; this is not new current-time passage inference.
  return !!inferred && inferred.intervalMs === e.intervalMs && Math.abs(Date.parse(e.inferredPassageTime) - Date.parse(inferred.inferredPassageTime)) <= 1 && (!e.confirmedAt || Date.parse(e.confirmedAt) >= e.to.timestamp);
}

export function readEvidence(value: unknown, scope: EvidenceScope, now: number, retentionMs: number): EvidenceDocument | null {
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) return null;
  const doc = parsed.data, cutoff = now - retentionMs;
  if (JSON.stringify(doc.scope) !== JSON.stringify(scope) || doc.checkpoint.timestamp <= cutoff || doc.checkpoint.timestamp > now + L.futureToleranceMs) return null;
  if (doc.observations.some(o => o.validatedAt - o.fix.timestamp > L.maxAgeMs || o.fix.timestamp - o.validatedAt > L.futureToleranceMs || o.validatedAt > now + L.futureToleranceMs) || doc.checkpoint.passages.some(e => !validPassage(e, scope))) return null;
  const seen = new Map<number, string>();
  for (const o of doc.observations) { const value = JSON.stringify(o.fix), previous = seen.get(o.fix.timestamp); if (previous && previous !== value) return null; seen.set(o.fix.timestamp, value); }
  const observations = [...new Map(doc.observations.filter(o => o.fix.timestamp > cutoff && o.fix.timestamp <= now + L.futureToleranceMs).map(o => [o.fix.timestamp, o])).values()].sort((a, b) => a.fix.timestamp - b.fix.timestamp);
  if (!observations.length || observations.at(-1)!.fix.timestamp !== doc.checkpoint.timestamp || doc.checkpoint.passages.some(e => e.to.timestamp > doc.checkpoint.timestamp || e.confirmedAt && Date.parse(e.confirmedAt) > doc.checkpoint.timestamp)) return null;
  return { ...doc, observations, checkpoint: { ...doc.checkpoint, passages: doc.checkpoint.passages.filter(e => e.from.timestamp > cutoff && e.to.timestamp > cutoff) } };
}

function capture(prepared: Prepared, journey: BusJourney, now: number): EvidenceDocument | null {
  const tracking = journey.tracking, measured = Date.parse(prepared.record.observation?.positionTimestamp ?? "");
  if (!tracking?.state || !["GPS_INFERRED", "APPROXIMATE"].includes(tracking.source) || !Number.isFinite(measured) || now - measured > L.maxAgeMs || measured - now > L.futureToleranceMs || tracking.state.last.timestamp !== measured || tracking.key !== prepared.scope.contextKey) return null;
  const fix = matchedFix.safeParse(tracking.state.last);
  if (!fix.success || JSON.stringify(fix.data.position) !== JSON.stringify(prepared.record.position)) return null;
  const parsed = documentSchema.safeParse({ schema: 1, revision: 1, scope: prepared.scope, observations: [{ fix: fix.data, validatedAt: now, feedPublishedAt: journey.vehicle.feedPublishedAt ?? null, receivedAt: journey.vehicle.receivedAt ?? null }], checkpoint: { timestamp: measured, passages: (tracking.passages ?? []).filter(e => validPassage(e, prepared.scope)), evidenceDiagnostics: tracking.evidenceDiagnostics ?? [], observationsUsed: tracking.observationsUsed } });
  return parsed.success ? parsed.data : null;
}

export function mergeEvidence(old: EvidenceDocument | undefined, incoming: EvidenceDocument, now: number, retentionMs: number): EvidenceDocument {
  const cutoff = now - retentionMs, observations = new Map<number, EvidenceDocument["observations"][number]>();
  for (const o of [...(old?.observations ?? []), ...incoming.observations]) if (o.fix.timestamp > cutoff && !observations.has(o.fix.timestamp)) observations.set(o.fix.timestamp, o);
  const incomingFix = incoming.observations.at(-1)!.fix, sameTime = old?.observations.find(o => o.fix.timestamp === incomingFix.timestamp);
  const conflict = sameTime && JSON.stringify(sameTime.fix) !== JSON.stringify(incomingFix);
  const useNew = !old || !conflict && incoming.checkpoint.timestamp > old.checkpoint.timestamp;
  const checkpoint = { ...(useNew ? incoming.checkpoint : old!.checkpoint) }, passages = new Map<string, EvidenceDocument["checkpoint"]["passages"][number]>();
  for (const e of [...(old?.checkpoint.passages ?? []), ...(conflict ? [] : incoming.checkpoint.passages)]) {
    if (e.from.timestamp <= cutoff || e.to.timestamp <= cutoff) continue;
    const key = JSON.stringify([e.stopId, e.sequence]), prior = passages.get(key);
    if (!prior || strongerPassage(prior, e)) passages.set(key, { ...e, confirmedAt: prior?.confirmedAt ?? e.confirmedAt });
    else if (!prior.confirmedAt && e.confirmedAt) passages.set(key, { ...prior, confirmedAt: e.confirmedAt });
  }
  checkpoint.passages = [...passages.values()];
  return { ...incoming, revision: (old?.revision ?? 0) + 1, observations: [...observations.values()].sort((a, b) => a.fix.timestamp - b.fix.timestamp), checkpoint };
}

export class BusEvidencePersistence {
  private cache = new Map<string, EvidenceDocument>();
  private counters: EvidenceStatus;
  private metrics: EvidenceMetrics = { histories: { found: 0, missing: 0, invalid: 0, timeout: 0, connection: 0, unavailable: 0 }, cachePopulation: emptyDuration(), retrieval: emptyDuration(), fleetProcessing: emptyDuration(), retries: 0, retryDuration: emptyDuration() };
  readonly retentionMs: number;
  constructor(private backend: EvidenceBackend, retentionMinutes = 60, mode: "REDIS_REST" | "TEST" = "REDIS_REST") {
    if (!Number.isInteger(retentionMinutes) || retentionMinutes < 1 || retentionMinutes > 120) throw new Error("Evidence retention must be 1–120 minutes");
    this.retentionMs = retentionMinutes * 60000;
    this.counters = { mode, state: "READY", retentionMinutes, loaded: 0, saved: 0, rejected: 0, conflicts: 0, failures: 0 };
  }
  status(): EvidenceStatus { return { ...this.counters, metrics: structuredClone(this.metrics), transport: this.backend.instrumentation?.() }; }
  recordProcessing(ms: number) { recordDuration(this.metrics.fleetProcessing, ms); }
  unavailable() { this.fail(); }
  private fail() { this.counters.failures++; this.counters.state = "DEGRADED"; }
  prepare(source: string, records: TransitRecord[], feed: BusJourneyFeed, history: (id: string) => ProgressHistory | undefined, now: number): Prepared[] {
    for (const [key, doc] of this.cache) if (doc.checkpoint.timestamp + this.retentionMs <= now) this.cache.delete(key);
    while (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!);
    const result: Prepared[] = [];
    for (const record of records) {
      const time = Date.parse(record.observation?.positionTimestamp ?? "");
      if (record.mode !== "Bus" || record.recordKind !== "vehicle" || record.dataMode !== "LIVE") continue;
      if (!validGpsPosition(record.position) || !Number.isFinite(time) || now - time > L.maxAgeMs || time - now > L.futureToleranceMs) { this.counters.rejected++; continue; }
      const local = history(record.id), preview = calculateBusJourney(feed.timetable, record, { now, paths: feed.tripPaths, gpsPaths: feed.progressPaths, shapeDistances: feed.tripShapeDistances, history: local }), scope = scopeFor(source, record, feed, preview);
      if (scope) result.push({ scope, preview, record, history: local });
    }
    return result;
  }
  async hydrate(prepared: Prepared[], now: number): Promise<Map<string, ProgressHistory>> {
    const overrides = new Map<string, ProgressHistory>(), missing = prepared.filter(p => !this.cache.has(p.scope.key));
    if (missing.length) {
      const started = performance.now(), byKey = new Map(missing.map(p => [p.scope.key, p])), handled = new Set<string>(); let failed = false;
      const accept = (result: EvidenceReadResult) => {
        const p = byKey.get(result.key); if (!p || handled.has(result.key)) return; handled.add(result.key);
        if (result.state === "FOUND") {
          const population = performance.now(), doc = readEvidence(result.value, p.scope, now, this.retentionMs);
          if (doc) { const cached = this.cache.get(p.scope.key); if (!cached || doc.revision >= cached.revision && doc.checkpoint.timestamp >= cached.checkpoint.timestamp) this.cache.set(p.scope.key, doc); this.counters.loaded++; this.metrics.histories.found++; }
          else { this.counters.rejected++; this.metrics.histories.invalid++; failed = true; }
          recordDuration(this.metrics.cachePopulation, performance.now() - population);
        } else if (result.state === "MISSING") this.metrics.histories.missing++;
        else { this.metrics.histories[result.state.toLowerCase() as "timeout" | "connection" | "unavailable" | "invalid"]++; if (result.state === "INVALID") this.counters.rejected++; failed = true; }
      };
      try {
        const loaded = await this.backend.read([...byKey.keys()], AbortSignal.timeout(2500), accept);
        // Compatibility with backends that return a complete Map without streaming callbacks.
        for (const key of byKey.keys()) if (!handled.has(key)) accept(loaded.has(key) ? { key, state: "FOUND", value: loaded.get(key) } : { key, state: "MISSING" });
      } catch (error) { failed = true; for (const key of byKey.keys()) if (!handled.has(key)) accept({ key, state: evidenceFailure(error) }); }
      recordDuration(this.metrics.retrieval, performance.now() - started);
      if (failed) this.fail(); else this.counters.state = "READY";
    }
    for (const p of prepared) {
      const cached = this.cache.get(p.scope.key), doc = cached ? readEvidence(cached, p.scope, now, this.retentionMs) : null, local = p.history, tracking = p.preview.tracking;
      if (cached && !doc) this.cache.delete(p.scope.key);
      else if (doc) this.cache.set(p.scope.key, doc);
      if (!doc || !local || !tracking || doc.checkpoint.timestamp > Date.parse(p.record.observation?.positionTimestamp ?? "")) continue;
      const currentFix = local.fixes.find(f => f.timestamp === doc.checkpoint.timestamp), storedFix = doc.observations.find(o => o.fix.timestamp === doc.checkpoint.timestamp)?.fix;
      if (currentFix && storedFix && JSON.stringify(currentFix.position) !== JSON.stringify(storedFix.position)) { this.counters.conflicts++; continue; }
      const localPrevious = local.previous?.key === tracking.key ? local.previous : undefined;
      const passages = new Map<string, PassageEvidence>();
      for (const e of [...doc.checkpoint.passages, ...(localPrevious?.passages ?? [])]) { const key = JSON.stringify([e.stopId, e.sequence]), prior = passages.get(key); if (!prior || strongerPassage(prior, e)) passages.set(key, { ...e, confirmedAt: prior?.confirmedAt ?? e.confirmedAt }); else if (!prior.confirmedAt && e.confirmedAt) passages.set(key, { ...prior, confirmedAt: e.confirmedAt }); }
      if (!passages.size || JSON.stringify([...passages.values()]) === JSON.stringify(localPrevious?.passages ?? [])) continue;
      // Historical raw fixes and motion state are never replayed as current movement.
      // Fresh local observations must independently re-establish HIGH progress after a restart.
      const previous: VehicleProgress = { ...(localPrevious ?? tracking), vehicleTimestamp: localPrevious?.vehicleTimestamp ?? new Date(doc.checkpoint.timestamp).toISOString(), historyToken: local.token, state: localPrevious?.state ?? null, position: localPrevious?.position ?? null, distanceM: localPrevious?.distanceM ?? null, passages: [...passages.values()], evidenceDiagnostics: localPrevious?.evidenceDiagnostics ?? doc.checkpoint.evidenceDiagnostics, observationsUsed: localPrevious?.observationsUsed ?? 1, historicalSpeed: localPrevious?.historicalSpeed ?? null };
      overrides.set(p.record.id, { token: local.token, previous, fixes: local.fixes });
    }
    return overrides;
  }
  async persist(prepared: Prepared[], journeys: Map<string, BusJourney>, now: number): Promise<void> {
    const signal = AbortSignal.timeout(2500);
    const candidates = prepared.flatMap(p => { const journey = journeys.get(p.record.id), doc = journey ? capture(p, journey, now) : null; if (!doc) { this.counters.rejected++; return []; } return [{ p, incoming: doc }]; });
    let failed = false;
    for (let attempt = 0, pending = candidates; attempt < 2 && pending.length; attempt++) {
      const writes = pending.flatMap(item => {
        const old = this.cache.get(item.p.scope.key), next = mergeEvidence(old, item.incoming, now, this.retentionMs);
        if (old && JSON.stringify({ ...old, revision: 0 }) === JSON.stringify({ ...next, revision: 0 })) return [];
        return [{ ...item, write: { key: next.scope.key, expectedRevision: old?.revision ?? 0, document: next, ttlMs: Math.max(1, next.checkpoint.timestamp + this.retentionMs - now), expiresAt: next.checkpoint.timestamp + this.retentionMs } }];
      });
      if (!writes.length) break;
      const handled = new Set<number>(), retry: typeof writes = [];
      const accept = (result: EvidenceWriteResult) => {
        if (!writes[result.index] || handled.has(result.index)) return; handled.add(result.index);
        const item = writes[result.index];
        if (result.state === "SAVED") {
          const cached = this.cache.get(item.write.key), doc = item.write.document;
          if (!cached || doc.revision >= cached.revision && doc.checkpoint.timestamp >= cached.checkpoint.timestamp) this.cache.set(item.write.key, doc);
          this.counters.saved++;
        } else if (result.state === "CONFLICT") { this.counters.conflicts++; retry.push(item); }
        else failed = true; // Unknown write outcome is never treated as a CAS conflict.
      };
      const retryStarted = performance.now(); if (attempt) this.metrics.retries++;
      try {
        const success = await this.backend.compareAndSet(writes.map(item => item.write), signal, accept);
        for (let i = 0; i < writes.length; i++) if (!handled.has(i)) accept({ index: i, state: typeof success[i] !== "boolean" ? "UNAVAILABLE" : success[i] ? "SAVED" : "CONFLICT" });
      } catch (error) { failed = true; for (let i = 0; i < writes.length; i++) if (!handled.has(i)) accept({ index: i, state: evidenceFailure(error) }); }
      finally { if (attempt) recordDuration(this.metrics.retryDuration, performance.now() - retryStarted); }
      if (!retry.length) break;
      if (attempt || signal.aborted) { failed = true; break; }
      const byKey = new Map(retry.map(item => [item.write.key, item])), refreshed = new Set<string>(), seen = new Set<string>(), readStarted = performance.now();
      const refresh = (result: EvidenceReadResult) => {
        const item = byKey.get(result.key); if (!item || seen.has(result.key)) return; seen.add(result.key);
        if (result.state === "MISSING") { this.cache.delete(result.key); refreshed.add(result.key); }
        else if (result.state === "FOUND") {
          const population = performance.now(), doc = readEvidence(result.value, item.p.scope, now, this.retentionMs);
          if (doc) { const cached = this.cache.get(result.key); if (!cached || doc.revision >= cached.revision && doc.checkpoint.timestamp >= cached.checkpoint.timestamp) this.cache.set(result.key, doc); refreshed.add(result.key); }
          else { this.counters.rejected++; failed = true; }
          recordDuration(this.metrics.cachePopulation, performance.now() - population);
        } else failed = true; // An outage/invalid response must not erase valid cached evidence.
      };
      try { const latest = await this.backend.read([...byKey.keys()], signal, refresh); for (const key of byKey.keys()) if (!seen.has(key)) refresh(latest.has(key) ? { key, state: "FOUND", value: latest.get(key) } : { key, state: "MISSING" }); }
      catch (error) { failed = true; for (const key of byKey.keys()) if (!seen.has(key)) refresh({ key, state: evidenceFailure(error) }); }
      finally { recordDuration(this.metrics.retryDuration, performance.now() - readStarted); }
      pending = retry.filter(item => refreshed.has(item.write.key));
    }
    if (failed) this.fail(); else if (candidates.length) this.counters.state = "READY";
  }
}
