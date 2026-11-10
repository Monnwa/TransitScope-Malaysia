import type { BusJourney, JourneyStop } from "@/lib/bus-journey";
import type { PassageObservation } from "@/lib/gps-passage";
import { PASSAGE_LIMITS } from "@/lib/gps-passage";
import { PROGRESS_LIMITS as L, type StopProjection } from "@/lib/route-projection";

export const diagnosticReasons = ["NO_GPS_HISTORY", "GPS_GAP_TOO_LARGE", "GPS_STALE", "INVALID_GPS_TIMESTAMP", "GPS_OUTLIER_REJECTED", "TRIP_MISMATCH", "STOP_SEQUENCE_MISMATCH", "NO_SCHEDULED_TIME", "PASSAGE_TIME_UNAVAILABLE", "INSUFFICIENT_EVIDENCE", "OTHER"] as const;
export type DiagnosticReason = typeof diagnosticReasons[number];
export type EvidenceClocks = { measurementAt: string | null; feedPublishedAt: string | null; receivedAt: string | null };
export type StopDiagnostic = { primary: DiagnosticReason; secondary: string[]; clocks: EvidenceClocks };
export type PassageDiagnostic = { stopId: string; sequence: number; primary: DiagnosticReason; secondary: string[] };

/** Explains an original rejected bracket; never admits a pair or changes an inference limit. */
export function rejectedPassageDiagnostic(stop: StopProjection, from: PassageObservation, to: PassageObservation, now: number): PassageDiagnostic | null {
  if (stop.distanceM === null || stop.distanceM < Math.min(from.distanceM, to.distanceM) - .0001 || stop.distanceM > Math.max(from.distanceM, to.distanceM) + .0001) return null;
  const result = (primary: DiagnosticReason, detail: string): PassageDiagnostic => ({ stopId: stop.id, sequence: stop.sequence, primary, secondary: [detail] });
  if (from.contextKey !== to.contextKey || from.vehicleId !== to.vehicleId || from.tripId !== to.tripId || from.routeId !== to.routeId || from.shapeId !== to.shapeId || from.serviceDate !== to.serviceDate) return result("TRIP_MISMATCH", "BRACKET_CONTEXT_CHANGED");
  if (![from.timestamp, to.timestamp].every(Number.isFinite) || to.timestamp <= from.timestamp || [from, to].some(fix => fix.timestamp - now > L.futureToleranceMs)) return result("INVALID_GPS_TIMESTAMP", "INVALID_BRACKET_MEASUREMENT_TIME");
  if ([from, to].some(fix => now - fix.timestamp > L.maxAgeMs)) return result("GPS_STALE", "BRACKET_MEASUREMENT_EXPIRED");
  if (stop.confidence !== "HIGH" || stop.offsetM === null || stop.offsetM > L.maxStopOffsetM) return result("STOP_SEQUENCE_MISMATCH", "STOP_PROJECTION_NOT_RELIABLE");
  const interval = to.timestamp - from.timestamp, movement = to.distanceM - from.distanceM;
  if (interval > PASSAGE_LIMITS.maxIntervalMs) return result("GPS_GAP_TOO_LARGE", "BRACKET_INTERVAL_OVER_LIMIT");
  if ([from, to].some(fix => Math.abs(fix.distanceM - fix.rawDistanceM) > .05) || to.rawDistanceM <= from.rawDistanceM || movement > L.maximumSpeedMps * interval / 1000 + L.passedBufferM) return result("GPS_OUTLIER_REJECTED", "BACKWARD_CLAMPED_OR_IMPLAUSIBLE_MOVEMENT");
  if (movement < PASSAGE_LIMITS.minMovementM) return result("INSUFFICIENT_EVIDENCE", "BRACKET_MOVEMENT_BELOW_LIMIT");
  if ([from, to].some(fix => fix.confidence !== "HIGH" || fix.offsetM > L.highRouteOffsetM || fix.accuracyM !== null && fix.accuracyM > L.highAccuracyM)) return result("INSUFFICIENT_EVIDENCE", "BRACKET_QUALITY_NOT_HIGH");
  return result("OTHER", "ORIGINAL_INFERENCE_REJECTED_BRACKET");
}

/** One primary reason for a withheld passed-stop classification, including inexact references. */
export function stopDiagnostic(journey: BusJourney, stop: JourneyStop, now: number): StopDiagnostic {
  const tracking = journey.tracking, measured = Date.parse(journey.vehicle.reportedAt ?? "");
  const clocks: EvidenceClocks = { measurementAt: journey.vehicle.reportedAt, feedPublishedAt: journey.vehicle.feedPublishedAt ?? null, receivedAt: journey.vehicle.receivedAt ?? null };
  const result = (primary: DiagnosticReason, ...secondary: string[]): StopDiagnostic => ({ primary, secondary, clocks });
  if (journey.match.status !== "MATCHED" || !journey.selectedDeparture || journey.selectedDeparture.key !== journey.vehicleDeparture?.key) return result("TRIP_MISMATCH", "NO_UNIQUE_CURRENT_RUN");
  if (journey.selectedDeparture.classification !== "SCHEDULED" || stop.classification !== "SCHEDULED" || !Number.isFinite(Date.parse(stop.departure ?? ""))) return result("NO_SCHEDULED_TIME", stop.departure ? "REFERENCE_IS_NOT_EXACT" : "DEPARTURE_REFERENCE_MISSING");
  if (!Number.isFinite(measured) || measured - now > L.futureToleranceMs) return result("INVALID_GPS_TIMESTAMP", "MEASUREMENT_TIME_INVALID_OR_FUTURE");
  if (now - measured > L.maxAgeMs || !journey.vehicle.realtimeAvailable || tracking?.source === "STALE") return result("GPS_STALE", "CURRENT_MEASUREMENT_UNAVAILABLE_OR_EXPIRED");
  const projection = tracking?.stopProjections.find(item => item.id === stop.id && item.sequence === stop.sequence);
  if (!projection || projection.confidence !== "HIGH" || projection.distanceM === null) return result("STOP_SEQUENCE_MISMATCH", "STOP_PROJECTION_UNAVAILABLE_OR_AMBIGUOUS");
  const known = tracking?.evidenceDiagnostics?.find(item => item.stopId === stop.id && item.sequence === stop.sequence);
  if (known) return result(known.primary, ...known.secondary);
  const passage = tracking?.passages?.find(item => item.stopId === stop.id && item.sequence === stop.sequence);
  if (passage) return result("PASSAGE_TIME_UNAVAILABLE", passage.confirmedAt ? "PASSAGE_CONTEXT_OR_REFERENCE_VALIDATION_FAILED" : "CROSSING_NOT_YET_CONFIRMED_PASSED");
  if (tracking?.state?.origin && projection.distanceM < tracking.state.origin.distanceM - .0001) return result("NO_GPS_HISTORY", "STOP_BEFORE_CURRENT_CONTINUITY_ORIGIN", ...(tracking.continuityDiagnostic ? ["OUTLIER_RESET_RECORDED;CAUSAL_ASSOCIATION_NOT_PROVEN"] : []));
  if ((tracking?.observationsUsed ?? 0) < 2 && (!tracking?.state || tracking.state.origin.timestamp === tracking.state.last.timestamp)) return result("NO_GPS_HISTORY", "FEWER_THAN_TWO_RELIABLE_OBSERVATIONS");
  return result("PASSAGE_TIME_UNAVAILABLE", "NO_RETAINED_CONFIRMED_BRACKET", "NARROWER_CAUSE_NOT_OBSERVED");
}

export function attachAdherenceDiagnostics(journey: BusJourney, now: number): BusJourney {
  journey.stops = journey.stops.map(stop => {
    if (stop.status !== "PASSED" || !stop.adherence || stop.adherence.status !== "STATUS_UNKNOWN") return stop;
    return { ...stop, adherence: { ...stop.adherence, diagnostic: stopDiagnostic(journey, stop, now) } };
  });
  return journey;
}
