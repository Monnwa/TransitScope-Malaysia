import { createHash } from "node:crypto";
import { z } from "zod";
import type { BusJourney, JourneyStop } from "@/lib/bus-journey";
import { inferStopPassage } from "@/lib/gps-passage";
import { PROGRESS_LIMITS } from "@/lib/route-projection";
import { assessStopAdherence, classifyAdherence, ON_TIME_TOLERANCE_SECONDS } from "@/lib/timetable-adherence";

export const CLASSIFICATION_ALGORITHM = "gtfs-gps-adherence-v1";
const dayMs = 86_400_000;
const text = z.string().min(1).max(24_000);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const milliseconds = z.number().int().positive().safe();
const dateTime = z.string().datetime({ offset: true });
const number = z.number().finite();
const stamp = number.int().positive();
const passageObservation = z.object({
  contextKey: text, vehicleId: text, tripId: text, routeId: text.nullable(), shapeId: text.nullable(),
  serviceDate: text, timestamp: stamp, distanceM: number.min(0), rawDistanceM: number.min(0),
  offsetM: number.min(0).max(PROGRESS_LIMITS.highRouteOffsetM),
  accuracyM: number.min(0).max(PROGRESS_LIMITS.highAccuracyM).nullable(), confidence: z.literal("HIGH"),
});
const passageSchema = z.object({
  stopId: text, sequence: number.int().min(0), stopDistanceM: number.min(0),
  inferredPassageTime: z.string().datetime(), from: passageObservation, to: passageObservation,
  intervalMs: number.positive().max(60000), confirmedAt: z.string().datetime().nullable(),
});
const proofSchema = z.object({
  projectionVersion: hex,
  passageKey: text,
  stopDistanceM: number.nonnegative(),
  stopOffsetM: number.nonnegative(),
  pair: passageSchema,
});
const bodySchema = z.object({
  schemaVersion: z.literal(1),
  algorithmVersion: z.literal(CLASSIFICATION_ALGORITHM),
  runStopId: hex,
  source: text,
  vehicleId: text,
  tripId: text,
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runKey: text,
  routeId: text.nullable(),
  directionId: text.nullable(),
  shapeId: text,
  stopId: text,
  stopSequence: z.number().int().nonnegative(),
  scheduledDeparture: dateTime,
  inferredPassageTime: dateTime,
  deviationSeconds: number,
  classification: z.enum(["EARLY", "ON_TIME", "DELAYED"]),
  toleranceSeconds: z.literal(ON_TIME_TOLERANCE_SECONDS),
  generatedAtMs: milliseconds,
  evaluatedFixMs: milliseconds,
  expiresAtMs: milliseconds,
  proof: proofSchema,
});
const recordSchema = bodySchema.extend({ recordId: hex, checksum: hex });
type RecordBody = z.infer<typeof bodySchema>;
export type ClassificationEvidenceRecord = z.infer<typeof recordSchema>;
export type HistoricalClassification =
  | { state: "VALID_HISTORICAL" | "SUPERSEDED"; record: ClassificationEvidenceRecord; supersededBy: string | null }
  | { state: "EXPIRED_EVIDENCE"; summary: Omit<ClassificationEvidenceRecord, "proof"> }
  | { state: "UNREPRODUCIBLE" | "INVALID_EVIDENCE" | "NOT_FOUND" | "UNAVAILABLE" };

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function classificationRunStopId(source: string, vehicleId: string, runKey: string, stopId: string, sequence: number) {
  return hash([source, vehicleId, runKey, stopId, sequence]);
}

function recordId(record: RecordBody) {
  const { pair, ...projection } = record.proof;
  // A later reconfirmation of the same crossing keeps the first accepted record.
  const { confirmedAt, ...crossing } = pair;
  void confirmedAt;
  return hash([
    record.schemaVersion, record.algorithmVersion, record.runStopId, record.tripId, record.serviceDate,
    record.routeId, record.directionId, record.shapeId, record.scheduledDeparture, record.inferredPassageTime,
    record.deviationSeconds, record.classification, record.toleranceSeconds, projection, crossing,
  ]);
}

function reproduces(record: RecordBody) {
  const { pair, passageKey, stopDistanceM, stopOffsetM } = record.proof;
  const confirmation = Date.parse(pair.confirmedAt ?? "");
  const age = record.generatedAtMs - record.evaluatedFixMs;
  if (age > PROGRESS_LIMITS.maxAgeMs || age < -PROGRESS_LIMITS.futureToleranceMs ||
      !Number.isFinite(confirmation) || confirmation < pair.to.timestamp || confirmation > record.evaluatedFixMs ||
      pair.stopId !== record.stopId || pair.sequence !== record.stopSequence ||
      Math.abs(pair.stopDistanceM - stopDistanceM) >= .05 ||
      record.runStopId !== classificationRunStopId(record.source, record.vehicleId, record.runKey, record.stopId, record.stopSequence)) return false;
  if ([pair.from, pair.to].some(fix => fix.contextKey !== passageKey || fix.vehicleId !== record.vehicleId ||
      fix.tripId !== record.tripId || fix.routeId !== record.routeId || fix.shapeId !== record.shapeId ||
      fix.serviceDate !== record.serviceDate)) return false;
  const crossing = inferStopPassage({
    id: record.stopId, sequence: record.stopSequence, distanceM: pair.stopDistanceM,
    offsetM: stopOffsetM, confidence: "HIGH", name: "", reason: null,
  }, pair.from, pair.to, pair.to.timestamp);
  const difference = (Date.parse(record.inferredPassageTime) - Date.parse(record.scheduledDeparture)) / 1000;
  return !!crossing && crossing.intervalMs === pair.intervalMs &&
    Math.abs(Date.parse(crossing.inferredPassageTime) - Date.parse(pair.inferredPassageTime)) <= 1 &&
    pair.inferredPassageTime === record.inferredPassageTime && difference === record.deviationSeconds &&
    classifyAdherence(difference, record.toleranceSeconds) === record.classification;
}

/** Capture an accepted current assessment, preserving the exact proof used by the classifier. */
export function captureClassificationEvidence(source: string, journey: BusJourney, stop: JourneyStop, generatedAtMs: number, retentionDays: number): ClassificationEvidenceRecord | null {
  const tracking = journey.tracking;
  const run = journey.selectedDeparture;
  const result = stop.adherence?.result;
  if (!tracking?.shapeId || !run || !result || result.toleranceSeconds !== ON_TIME_TOLERANCE_SECONDS ||
      Date.parse(journey.retrievedAt) !== generatedAtMs) return null;
  const evaluated = assessStopAdherence(journey, stop, generatedAtMs).result;
  if (!evaluated || evaluated.evidence !== result.evidence || evaluated.status !== result.status ||
      evaluated.differenceSeconds !== result.differenceSeconds || evaluated.inferredPassageTime !== result.inferredPassageTime ||
      evaluated.scheduledReferenceTime !== result.scheduledReferenceTime) return null;
  const projection = tracking.stopProjections.find(item => item.id === stop.id && item.sequence === stop.sequence &&
    item.confidence === "HIGH" && item.distanceM !== null && Math.abs(item.distanceM - result.evidence.stopDistanceM) < .05);
  const expiresAtMs = Date.parse(run.serviceDate + "T00:00:00+08:00") + (retentionDays + 1) * dayMs;
  if (!projection || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30 || generatedAtMs >= expiresAtMs) return null;
  const parsed = bodySchema.safeParse({
    schemaVersion: 1, algorithmVersion: CLASSIFICATION_ALGORITHM,
    runStopId: classificationRunStopId(source, journey.vehicle.id, run.key, stop.id, stop.sequence),
    source, vehicleId: journey.vehicle.id, tripId: run.tripId, serviceDate: run.serviceDate,
    runKey: run.key, routeId: journey.route?.id ?? null, directionId: tracking.directionId ?? run.direction,
    shapeId: tracking.shapeId, stopId: stop.id, stopSequence: stop.sequence,
    scheduledDeparture: result.scheduledReferenceTime, inferredPassageTime: result.inferredPassageTime,
    deviationSeconds: result.differenceSeconds, classification: result.status, toleranceSeconds: result.toleranceSeconds,
    generatedAtMs, evaluatedFixMs: Date.parse(tracking.vehicleTimestamp ?? ""), expiresAtMs,
    proof: { projectionVersion: hash(tracking.key), passageKey: tracking.passageKey ?? tracking.key,
      stopDistanceM: projection.distanceM, stopOffsetM: projection.offsetM, pair: result.evidence },
  });
  if (!parsed.success || !reproduces(parsed.data)) return null;
  const snapshot = { ...parsed.data, recordId: recordId(parsed.data) };
  return { ...snapshot, checksum: hash(snapshot) };
}

export function inspectClassificationEvidence(payload: unknown, now: number, supersededBy: string | null = null): HistoricalClassification {
  if (payload && typeof payload === "object" &&
      (!("proof" in payload) || payload.proof == null ||
       ("schemaVersion" in payload && payload.schemaVersion !== 1) ||
       ("algorithmVersion" in payload && payload.algorithmVersion !== CLASSIFICATION_ALGORITHM))) return { state: "UNREPRODUCIBLE" };
  const parsed = recordSchema.safeParse(payload);
  if (!parsed.success) return { state: "INVALID_EVIDENCE" };
  const { checksum, ...snapshot } = parsed.data;
  if (checksum !== hash(snapshot) || snapshot.recordId !== recordId(snapshot) ||
      snapshot.expiresAtMs <= snapshot.generatedAtMs || !reproduces(snapshot)) return { state: "INVALID_EVIDENCE" };
  if (now >= snapshot.expiresAtMs) {
    const { proof, ...summary } = parsed.data;
    void proof;
    return { state: "EXPIRED_EVIDENCE", summary };
  }
  return { state: supersededBy ? "SUPERSEDED" : "VALID_HISTORICAL", record: parsed.data, supersededBy };
}
