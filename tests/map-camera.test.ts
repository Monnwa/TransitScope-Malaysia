import { describe, expect, it } from "vitest";
import { cameraReducer, initialCameraState, ProgrammaticCameraGuard, followDecision, cameraArea, cameraAnchor, withinCameraArea, type CameraMode } from "@/lib/map-camera";
import type { GeoPoint } from "@/lib/route-projection";

const selected = cameraReducer(initialCameraState, { type: "SELECT", id: "bus:T401:01" });
const focused = cameraReducer(selected, { type: "FOCUS", available: true });
const free = cameraReducer(focused, { type: "MANUAL" });

describe("explicit bus camera transitions", () => {
  it("separates selection from focus and leaves ordinary refresh selection unchanged", () => {
    expect(selected.mode).toBe("OVERVIEW");
    expect(selected.request).toBe(0);
    expect(cameraReducer(selected, { type: "SELECT", id: selected.vehicleId })).toBe(selected);
    expect(focused.mode).toBe("VEHICLE_FOCUS");
    expect(focused.request).toBe(1);
  });
  it.each([initialCameraState, selected, focused, free])("manual interaction always suspends without requesting a move: %s", state => {
    const next = cameraReducer(state, { type: "MANUAL" });
    expect(next.mode).toBe("FREE_EXPLORE");
    expect(next.request).toBe(state.request);
    expect(next.vehicleId).toBe(state.vehicleId);
  });
  it("only Return can resume a manually suspended selection", () => {
    expect(cameraReducer(free, { type: "FOCUS", available: true })).toBe(free);
    expect(cameraReducer(free, { type: "RETURN", available: true }).mode).toBe("VEHICLE_FOCUS");
  });
  it.each([selected, focused, free])("clearing a vehicle requests overview", state => {
    const cleared = cameraReducer(state, { type: "SELECT", id: null });
    expect(cleared).toMatchObject({ mode: "OVERVIEW", vehicleId: null, command: { kind: "overview" } });
    expect(cleared.request).toBe(state.request + 1);
  });
  it.each([focused, free])("changing selected vehicle never transfers following", state => {
    expect(cameraReducer(state, { type: "SELECT", id: "bus:T402:01" })).toMatchObject({ mode: "FREE_EXPLORE", vehicleId: "bus:T402:01", request: state.request });
  });
  it.each(["OVERVIEW", "VEHICLE_FOCUS", "FREE_EXPLORE"] as CameraMode[])("route intent leaves %s for overview, never for follow", mode => {
    expect(cameraReducer({ ...focused, mode }, { type: "ROUTE" })).toMatchObject({ mode: "OVERVIEW", command: { kind: "overview" } });
  });
  it("retains unavailable identity, pauses, rejects invalid return and requires explicit return after recovery", () => {
    const unavailable = cameraReducer(focused, { type: "UNAVAILABLE" });
    expect(unavailable).toMatchObject({ mode: "FREE_EXPLORE", vehicleId: focused.vehicleId, request: focused.request });
    expect(cameraReducer(unavailable, { type: "RETURN", available: false })).toBe(unavailable);
    expect(cameraReducer(unavailable, { type: "SELECT", id: focused.vehicleId })).toBe(unavailable);
    expect(cameraReducer(unavailable, { type: "RETURN", available: true }).mode).toBe("VEHICLE_FOCUS");
    expect(cameraReducer(initialCameraState, { type: "FOCUS", available: true })).toBe(initialCameraState);
  });
  it("stop navigation suspends follow and supports repeating a prior stop after reselection", () => {
    const event = { type: "STOP" as const, point: [3.1, 101.7] as GeoPoint, id: "stop-1", sequence: 1 };
    const first = cameraReducer(focused, event), second = cameraReducer(first, event);
    expect(first.mode).toBe("FREE_EXPLORE");
    expect(second.request).toBe(first.request + 1);
    expect(cameraReducer(focused, { ...event, point: [NaN, 101.7] })).toBe(focused);
  });
});

describe("programmatic transition guard", () => {
  it("covers synchronous setView/fitBounds-style events and nested commands", () => {
    const guard = new ProgrammaticCameraGuard(), seen: boolean[] = [];
    guard.run(() => { seen.push(guard.active); guard.run(() => seen.push(guard.active)); seen.push(guard.active); });
    expect(seen).toEqual([true, true, true]);
    expect(guard.active).toBe(false);
  });
  it("cleans up after a failed camera command without a timing timeout", () => {
    const guard = new ProgrammaticCameraGuard();
    expect(() => guard.run(() => { throw Error("map unavailable"); })).toThrow("map unavailable");
    expect(guard.active).toBe(false);
  });
});

describe("follow threshold and cadence", () => {
  const origin: GeoPoint = [3.1, 101.7], small: GeoPoint = [3.10005, 101.7], moved: GeoPoint = [3.1002, 101.7];
  it("does not move for unchanged positions even outside the safe area", () => expect(followDecision(origin, [...origin], false, 5000)).toEqual({ move: false, wait: 0 }));
  it("ignores sub-threshold jitter", () => expect(followDecision(origin, small, false, 5000).move).toBe(false));
  it("moves once cumulative displacement crosses 12 metres and leaves the safe interior", () => expect(followDecision(origin, moved, false, 5000)).toEqual({ move: true, wait: 0 }));
  it("does not recenter unnecessarily while the vehicle remains in the safe interior", () => expect(followDecision(origin, moved, true, 5000).move).toBe(false));
  it("throttles rapid updates and provides a bounded trailing delay", () => {
    expect(followDecision(origin, moved, false, 1000)).toEqual({ move: false, wait: 500 });
    expect(followDecision(origin, moved, false, 1500)).toEqual({ move: true, wait: 0 });
  });
  it.each([null, [NaN, 101.7], [91, 101.7]] as (GeoPoint | null)[])("rejects unavailable/invalid positions", point => expect(followDecision(origin, point, false, 5000)).toEqual({ move: false, wait: 0 }));
});

describe("responsive camera area", () => {
  it("clips the map to viewport, sheet and controls instead of using a fixed mobile offset", () => {
    const map = { left: 30, right: 345, top: 80, bottom: 500 };
    const area = cameraArea(map, { width: 375, height: 844 }, [
      { left: 0, right: 375, top: 422, bottom: 844 },
      { left: 40, right: 74, top: 90, bottom: 154 },
    ])!;
    expect(area.top).toBeGreaterThanOrEqual(16);
    expect(area.bottom + map.top).toBeLessThan(422);
    expect(area.left + map.left).toBeGreaterThan(74);
    expect(withinCameraArea(cameraAnchor(area), area)).toBe(true);
  });
  it("reserves measured popup headroom", () => {
    const rect = { left: 0, top: 0, right: 300, bottom: 300 };
    expect(cameraAnchor(rect, 180).y).toBe(204);
    expect(cameraAnchor(rect, 600).y).toBe(282);
  });
  it("does not invent a camera target for a hidden map", () => expect(cameraArea({ left: 0, right: 300, top: 1000, bottom: 1400 }, { width: 375, height: 844 }, [])).toBeNull());
});
