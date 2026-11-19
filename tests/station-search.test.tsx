import React from "react";
import L from "leaflet";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { railNetwork, busStops } from "@/lib/simulation/network";
import { simulationSnapshot } from "@/lib/simulation";
import { filterRecords } from "@/lib/transit-data";
import { resolveStationResult } from "@/lib/station-search";
import useStationSearchNavigation from "@/components/use-station-search-navigation";

vi.mock("@/components/bus-camera-context", () => ({ useOptionalBusCamera: () => null }));
const trx = railNetwork.stations.find(station => station.name === "Tun Razak Exchange")!;
const single = railNetwork.stations.find(station => station.name === "Taman Midah")!;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("station search result identity", () => {
  it("reuses the filtered merged TRX record and both line/source identities", () => {
    const results = filterRecords(simulationSnapshot(0).records, "Tun Razak Exchange", [], [], []);
    expect(results.filter(result => result.recordKind === "stop")).toHaveLength(1);
    expect(resolveStationResult(results[0], railNetwork)).toBe(trx);
    expect(trx.position).toEqual([3.142, 101.72]);
    expect(trx.railLines).toEqual(["MRT1", "MRT2"]);
    expect(trx.stopRefs).toHaveLength(2);
  });
  it("resolves by ID even when display names duplicate or result coordinates are stale", () => {
    expect(resolveStationResult({ ...trx, name: single.name, position: [0, 0] }, railNetwork)).toBe(trx);
    expect(resolveStationResult({ ...trx, id: "unknown" }, railNetwork)).toBeUndefined();
  });
  it("rejects ambiguous IDs and invalid authoritative coordinates", () => {
    expect(resolveStationResult(trx, { ...railNetwork, stations: [trx, trx] })).toBeUndefined();
    for (const position of [null, [NaN, 101], [91, 101], [3, Infinity]] as const) {
      expect(resolveStationResult(trx, { ...railNetwork, stations: [{ ...trx, position: position ? [...position] : null }] })).toBeUndefined();
    }
  });
  it("does not treat buses, trains, or route records as railway stations", () => {
    expect(resolveStationResult(busStops[0], railNetwork)).toBeUndefined();
    expect(resolveStationResult({ ...trx, recordKind: "vehicle" }, railNetwork)).toBeUndefined();
    expect(resolveStationResult({ ...trx, recordKind: "other" }, railNetwork)).toBeUndefined();
  });
});

function fixture() {
  const container = document.createElement("div"); document.body.append(container);
  const popup = L.popup();
  const marker = L.circleMarker(trx.position!).bindPopup(popup);
  const open = vi.spyOn(marker, "openPopup").mockImplementation(() => { popup.setLatLng(marker.getLatLng()); return marker; });
  const listeners = new Map<string, () => void>();
  const map = {
    getContainer: () => container,
    eachLayer: vi.fn((visit: (layer: L.Layer) => void) => visit(marker)),
    getMinZoom: () => 0, getMaxZoom: () => 18, getZoom: () => 13,
    getSize: () => L.point(700, 500), project: vi.fn(() => L.point(200, 200)), unproject: () => L.latLng(trx.position!),
    stop: vi.fn(), closePopup: vi.fn(), setView: vi.fn(), fire: vi.fn(),
    on: vi.fn((events: string, callback: () => void) => { listeners.set(events, callback); }),
    off: vi.fn(),
  } as unknown as L.Map;
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 700, bottom: 500, width: 700, height: 500 } as DOMRect);
  return { map, popup, marker, open, container, listeners };
}
beforeEach(() => { vi.stubGlobal("React", React); });
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("native station navigation lifecycle", () => {
  it("navigates to the exact authoritative coordinate at bounded station zoom and opens the same popup", () => {
    const { map, popup, open, container } = fixture();
    renderHook(() => useStationSearchNavigation(map, { current: popup }, trx, { stationId: trx.id, revision: 1 }));
    expect(map.project).toHaveBeenCalledWith(trx.position, 17);
    expect(map.setView).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce();
    expect(popup.getLatLng()).toEqual(L.latLng(trx.position!));
    expect(container.dataset.stationSearchId).toBe(trx.id);
  });
  it("does nothing on clearing or selecting another result type", () => {
    const { map, popup, open } = fixture();
    renderHook(() => useStationSearchNavigation(map, { current: popup }, trx, null));
    renderHook(() => useStationSearchNavigation(map, { current: popup }, trx, { stationId: busStops[0].id, revision: 1 }));
    expect(map.setView).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("rejects invalid station coordinates before touching the camera or popup", () => {
    const { map, popup, open } = fixture();
    renderHook(() => useStationSearchNavigation(map, { current: popup }, { ...trx, position: [NaN, 101] }, { stationId: trx.id, revision: 1 }));
    expect(map.setView).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("bounds station zoom by the current map limits", () => {
    const { map, popup } = fixture();
    vi.spyOn(map, "getMaxZoom").mockReturnValue(15);
    renderHook(() => useStationSearchNavigation(map, { current: popup }, trx, { stationId: trx.id, revision: 1 }));
    expect(map.project).toHaveBeenCalledWith(trx.position, 15);
  });
  it("rejects ambiguous marker bindings instead of opening duplicate popups", () => {
    const { map, marker, popup, open, container } = fixture();
    const duplicate = L.circleMarker(trx.position!).bindPopup(popup);
    vi.mocked(map.eachLayer).mockImplementation(visit => { visit(marker); visit(duplicate); return map; });
    renderHook(() => useStationSearchNavigation(map, { current: popup }, trx, { stationId: trx.id, revision: 1 }));
    expect(container.dataset.stationSearchError).toBe("station-marker-unavailable");
    expect(map.setView).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("reports missing refs, absent markers and mismatched coordinates without moving", () => {
    const { map, popup, marker, open, container } = fixture();
    const request = { stationId: trx.id, revision: 1 };
    const ref: { current: L.Popup | null } = { current: null };
    const view = renderHook(() => useStationSearchNavigation(map, ref, trx, request));
    expect(container.dataset.stationSearchError).toBe("popup-unavailable"); view.unmount();
    ref.current = popup; marker.setLatLng([4, 102]);
    renderHook(() => useStationSearchNavigation(map, ref, trx, request));
    expect(container.dataset.stationSearchError).toBe("station-marker-coordinate-mismatch");
    expect(map.setView).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("retries delayed marker binding using layer events, once, and rejects stale queued work", async () => {
    const { map, popup, marker, open, listeners } = fixture();
    vi.mocked(map.eachLayer).mockImplementation(() => map);
    const ref = { current: popup };
    const view = renderHook(({ request }) => useStationSearchNavigation(map, ref, trx, request),
      { initialProps: { request: { stationId: trx.id, revision: 1 } as { stationId: string; revision: number } | null } });
    expect(open).not.toHaveBeenCalled();
    const retry = listeners.get("layeradd resize")!;
    act(() => retry()); view.rerender({ request: null });
    await act(async () => { await Promise.resolve(); }); expect(open).not.toHaveBeenCalled();
    vi.mocked(map.eachLayer).mockImplementation(visit => { visit(marker); return map; });
    view.rerender({ request: { stationId: trx.id, revision: 2 } });
    expect(open).toHaveBeenCalledOnce();
    act(() => listeners.get("layeradd resize")!());
    await act(async () => { await Promise.resolve(); }); expect(open).toHaveBeenCalledOnce();
  });
  it("opens a marker that becomes available after the request without a timer", async () => {
    const { map, marker, popup, open, listeners } = fixture();
    vi.mocked(map.eachLayer).mockImplementation(() => map);
    renderHook(() => useStationSearchNavigation(map, { current: popup }, trx, { stationId: trx.id, revision: 1 }));
    expect(open).not.toHaveBeenCalled();
    vi.mocked(map.eachLayer).mockImplementation(visit => { visit(marker); return map; });
    act(() => listeners.get("layeradd resize")!());
    await act(async () => { await Promise.resolve(); }); expect(open).toHaveBeenCalledOnce();
  });
  it("repeated selection reopens the native popup and a second station cannot run the old request", () => {
    const { map, popup, open } = fixture(); const ref = { current: popup };
    const view = renderHook(({ request }) => useStationSearchNavigation(map, ref, trx, request),
      { initialProps: { request: { stationId: trx.id, revision: 1 } } });
    view.rerender({ request: { stationId: trx.id, revision: 2 } }); expect(open).toHaveBeenCalledTimes(2);
    view.rerender({ request: { stationId: single.id, revision: 3 } }); expect(open).toHaveBeenCalledTimes(2);
  });
});
