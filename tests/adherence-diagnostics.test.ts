import { describe, expect, it } from "vitest";
import { attachAdherenceDiagnostics, rejectedPassageDiagnostic, stopDiagnostic } from "@/lib/adherence-diagnostics";
import { adherenceFixture, adherencePoint } from "@/tests/fixtures/adherence";
import { calculateBusJourney } from "@/lib/bus-journey";
import type { PassageObservation } from "@/lib/gps-passage";

describe("internal stop-level reasons", () => {
  it("assigns one primary reason to every unavailable passed stop without changing classifications", () => {
    const f = adherenceFixture(), before = f.journey.stops.map(s => [s.status, s.adherence?.status]);
    attachAdherenceDiagnostics(f.journey, f.now); attachAdherenceDiagnostics(f.journey, f.now);
    expect(f.journey.stops.map(s => [s.status, s.adherence?.status])).toEqual(before);
    for (const s of f.journey.stops.filter(s => s.status === "PASSED" && s.adherence?.status === "STATUS_UNKNOWN")) { expect(s.adherence?.diagnostic?.primary).toBe("NO_GPS_HISTORY"); expect(Array.isArray(s.adherence?.diagnostic?.primary)).toBe(false); }
    expect(f.journey.stops.filter(s => s.adherence?.result).every(s => !s.adherence?.diagnostic)).toBe(true);
  });
  it("keeps measurement, publication and receipt clocks distinct, including missing measurement time", () => {
    const f = adherenceFixture(); f.journey.vehicle.feedPublishedAt = new Date(f.now + 1000).toISOString(); f.journey.vehicle.receivedAt = new Date(f.now + 2000).toISOString();
    const d = stopDiagnostic(f.journey, f.journey.stops[0], f.now);
    expect(d.clocks).toEqual({ measurementAt: f.bus.reportedAt, feedPublishedAt: new Date(f.now + 1000).toISOString(), receivedAt: new Date(f.now + 2000).toISOString() });
    f.journey.vehicle.reportedAt = null; expect(stopDiagnostic(f.journey, f.journey.stops[0], f.now).primary).toBe("INVALID_GPS_TIMESTAMP");
  });
  it("identifies actual rejected long brackets instead of guessing from generic passage absence", () => {
    const f = adherenceFixture(), j = calculateBusJourney(f.table, f.bus, { now: f.now, paths: new Map([["t", f.path]]), history: { token: "gap", fixes: [[90, 120], [600, 50]].map(([m, ago]) => ({ position: adherencePoint(m), timestamp: f.now - ago * 1000, bearing: 90, speed: 8, accuracyM: null })) } });
    expect(j.stops[2].status).toBe("PASSED"); expect(j.stops[2].adherence?.diagnostic?.primary).toBe("GPS_GAP_TOO_LARGE"); expect(j.stops[2].adherence?.result).toBeNull();
  });
  it("records insufficient movement at the actual bracketing pair while preserving PASSED rules", () => {
    const f = adherenceFixture(), j = calculateBusJourney(f.table, f.bus, { now: f.now, paths: new Map([["t", f.path]]), history: { token: "slow", fixes: [[90, 120], [200, 90], [390, 60], [410, 50], [700, 30]].map(([m, ago]) => ({ position: adherencePoint(m), timestamp: f.now - ago * 1000, bearing: 90, speed: 8, accuracyM: null })) } });
    expect(j.stops[2].status).toBe("PASSED"); expect(j.stops[2].adherence?.diagnostic?.primary).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("distinguishes unmatched runs, inexact schedules, stale clocks and unresolved passage absence", () => {
    const f = adherenceFixture(), stop = f.journey.stops[0], j = f.journey;
    expect(stopDiagnostic({ ...j, match: { ...j.match, status: "PATTERN_ONLY" } }, stop, f.now).primary).toBe("TRIP_MISMATCH");
    expect(stopDiagnostic(j, { ...stop, classification: "ESTIMATED" }, f.now).primary).toBe("NO_SCHEDULED_TIME");
    expect(stopDiagnostic(j, stop, f.now + 120001).primary).toBe("GPS_STALE");
    const unknown = structuredClone(j); unknown.tracking!.passages = []; unknown.tracking!.state!.origin.distanceM = 0;
    expect(stopDiagnostic(unknown, stop, f.now).primary).toBe("PASSAGE_TIME_UNAVAILABLE");
  });
  it("does not claim a prior global outlier caused a stop's missing pre-origin history", () => {
    const f = adherenceFixture(); f.journey.tracking!.continuityDiagnostic = "GPS_OUTLIER_REJECTED";
    const d = stopDiagnostic(f.journey, f.journey.stops[0], f.now); expect(d.primary).toBe("NO_GPS_HISTORY"); expect(d.secondary.join()).toContain("CAUSAL_ASSOCIATION_NOT_PROVEN");
  });
  it("identifies clamped/implausible brackets and ignores unrelated unbracketed stops", () => {
    const f = adherenceFixture(), sample: PassageObservation = { contextKey: "same", vehicleId: "bus", tripId: "t", routeId: "R", shapeId: "shape", serviceDate: "2026-11-07", timestamp: f.now - 30000, distanceM: 200, rawDistanceM: 200, offsetM: 0, accuracyM: null, confidence: "HIGH" }, stop = { id: "s", sequence: 1, name: "Fixture", distanceM: 400, offsetM: 0, confidence: "HIGH" as const, reason: null };
    expect(rejectedPassageDiagnostic(stop, sample, { ...sample, timestamp: f.now, distanceM: 600, rawDistanceM: 590 }, f.now)?.primary).toBe("GPS_OUTLIER_REJECTED");
    expect(rejectedPassageDiagnostic({ ...stop, distanceM: 100 }, sample, { ...sample, timestamp: f.now, distanceM: 600, rawDistanceM: 600 }, f.now)).toBeNull();
  });
});
