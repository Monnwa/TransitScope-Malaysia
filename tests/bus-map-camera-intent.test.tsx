import React from "react";
import L from "leaflet";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BusMapCamera from "@/components/bus-map-camera";
import { BusCameraProvider, useBusCamera } from "@/components/bus-camera-context";
import { busRecords } from "@/lib/simulation/vehicles";
import { railNetwork } from "@/lib/simulation/network";
import { busRouteViewport } from "@/lib/bus-map-routes";
import type { Record as TransitRecord } from "@/lib/transit-data";

const holder = vi.hoisted(() => ({ map: null as L.Map | null }));
vi.mock("react-leaflet", () => ({ useMap: () => holder.map }));
let context: ReturnType<typeof useBusCamera>;
function Capture() { context = useBusCamera(); return null; }
const start = Date.parse("2026-11-14T04:00:00Z");
const bus = busRecords(start).find(item => item.id === "bus:T401:01")!;
let map: L.Map, container: HTMLDivElement, frames: Map<number, FrameRequestCallback>, nextFrame: number;
let selected: TransitRecord | undefined, route: string, reset: number;
let view: ReturnType<typeof render>;
const cameraView = () => ({ center: map.getCenter(), zoom: map.getZoom() });
function tree() {
  return <BusCameraProvider selectedVehicleId={selected?.mode === "Bus" ? selected.id : null} selectedRecordId={selected?.id ?? null}>
    <Capture/><BusMapCamera selected={selected} vehicleVisible={!!selected} selectedRouteId={route} enabled resetSignal={reset}
      journey={null} navigation={null} controlsHost={null} onLocate={() => {}}/>
  </BusCameraProvider>;
}
function update(record: TransitRecord | undefined = selected) { selected = record; view.rerender(tree()); }
function drain() {
  for (let count = 0; frames.size && count < 20; count++) {
    const batch = [...frames]; frames.clear();
    act(() => { batch.forEach(([, callback]) => callback(performance.now())); });
  }
  expect(frames.size).toBe(0);
}
function dispatch(action: Parameters<typeof context.dispatch>[0]) { act(() => context.dispatch(action)); }
function focus() { dispatch({ type: "RETURN", available: true }); drain(); expect(context.state.mode).toBe("VEHICLE_FOCUS"); }
function key(key: string, keyCode: number, options: KeyboardEventInit = {}, target: HTMLElement = container) {
  act(() => { container.focus(); target.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode, which: keyCode, bubbles: true, ...options })); });
}
function moveManually() {
  act(() => { map.fire("dragstart"); map.setView([3.3, 101.8], map.getZoom(), { animate: false }); });
}
function popup(vehicle = bus) {
  const popup = L.popup({ autoPan: false, closeButton: false }).setLatLng(vehicle.position!).setContent('<div class="bus-vehicle-popup" data-vehicle-id="' + vehicle.id + '">Bus</div>');
  act(() => { popup.openOn(map); });
  // JSDOM does not perform layout. Force a measurable popup above the usable map.
  vi.spyOn(popup.getElement()!, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300, toJSON() {} });
  return popup;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  nextFrame = 0; frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1265); vi.stubGlobal("innerHeight", 720);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
  container = document.createElement("div"); document.body.appendChild(container);
  Object.defineProperties(container, { clientWidth: { value: 700 }, clientHeight: { value: 400 } });
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ x: 0, y: 100, left: 0, top: 100, right: 700, bottom: 500, width: 700, height: 400, toJSON() {} });
  map = L.map(container, { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false, zoomControl: false, attributionControl: false }).setView([3.142, 101.699], 13);
  const panBy = map.panBy.bind(map);
  vi.spyOn(map, "panBy").mockImplementation((offset, options) => panBy(offset, { ...options, animate: false }));
  holder.map = map; selected = bus; route = ""; reset = 0;
  view = render(tree()); drain(); focus();
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); map.remove(); container.remove(); holder.map = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("F1 explicit station versus bus overview intent", () => {
  it.each(["Tanjung Malim", "Rawang"])("keeps %s selected after all layout and scroll frames", name => {
    const station = railNetwork.stations.find(item => item.name === name)!;
    update(station); drain();
    // Leaflet panTo rounds projected pixels (about 1.3m here); reject any route-scale drift.
    expect(map.getCenter().distanceTo(station.position!)).toBeLessThan(2);
    expect(context.state).toMatchObject({ mode: "OVERVIEW", viewIntent: "selection", selectionId: station.id, vehicleId: null });
    act(() => window.dispatchEvent(new Event("scroll"))); drain();
    expect(map.getCenter().distanceTo(station.position!)).toBeLessThan(1);
  });
  it("keeps newer manual exploration after selecting a rail station", () => {
    update(railNetwork.stations.find(item => item.name === "Tanjung Malim")!);
    moveManually(); const manual = cameraView(); drain();
    expect(cameraView()).toEqual(manual); expect(context.state.mode).toBe("FREE_EXPLORE");
  });
  it("ordinary bus clear still fits the bus network", () => {
    selected = undefined; update(); drain();
    expect(context.state).toMatchObject({ mode: "OVERVIEW", viewIntent: "bus", vehicleId: null });
    expect(busRouteViewport("").every(point => map.getBounds().contains(point))).toBe(true);
  });
  it("explicit Overview supersedes station intent even when the station remains selected", () => {
    update(railNetwork.stations.find(item => item.name === "Tanjung Malim")!); drain();
    dispatch({ type: "OVERVIEW" }); drain();
    expect(context.state.viewIntent).toBe("bus");
    expect(busRouteViewport("").every(point => map.getBounds().contains(point))).toBe(true);
    act(() => window.dispatchEvent(new Event("resize"))); drain();
    expect(busRouteViewport("").every(point => map.getBounds().contains(point))).toBe(true);
  });
  it("route selection, clearing and reset retain explicit bus overview", () => {
    for (const next of ["T402", "T401", ""]) {
      route = next; selected = undefined; update(); drain();
      expect(context.state).toMatchObject({ mode: "OVERVIEW", viewIntent: "bus" });
      expect(busRouteViewport(next).every(point => map.getBounds().contains(point))).toBe(true);
    }
    update(bus); focus(); reset++; update(); drain();
    expect(context.state.mode).toBe("OVERVIEW");
    expect(busRouteViewport("").every(point => map.getBounds().contains(point))).toBe(true);
  });
});

describe("F2 installed Leaflet keyboard navigation", () => {
  it.each([
    ["Shift+Minus", "_", 189, true, -3], ["Minus", "-", 189, false, -1],
    ["Shift+Plus", "+", 187, true, 3], ["numpad plus", "+", 107, false, 1],
    ["numpad minus", "-", 109, false, -1], ["locale equals", "=", 61, false, 1], ["locale plus", "+", 171, false, 1],
    ["locale minus", "ß", 173, false, -1], ["locale zoom key", "^", 54, true, -3],
  ] as const)("%s suspends focus and blocks the next vehicle update until Return", (_label, value, code, shift, delta) => {
    // Allow both zoom directions to execute rather than testing a max-zoom no-op.
    act(() => context.guard.run(() => map.setZoom(15, { animate: false })));
    key(value, code, { shiftKey: shift }); drain();
    expect(map.getZoom()).toBe(15 + delta); expect(context.state.mode).toBe("FREE_EXPLORE");
    const manual = cameraView(); update({ ...bus, position: [3.4, 101.9] }); drain();
    expect(cameraView()).toEqual(manual); expect(context.state.mode).toBe("FREE_EXPLORE");
    dispatch({ type: "RETURN", available: true }); drain(); expect(context.state.mode).toBe("VEHICLE_FOCUS");
    expect(cameraView()).not.toEqual(manual);
  });
  it.each([["ArrowLeft", 37], ["ArrowRight", 39], ["ArrowUp", 38], ["ArrowDown", 40]] as const)("%s panning suspends focus", (value, code) => {
    const before = cameraView(); key(value, code); drain();
    expect(context.state.mode).toBe("FREE_EXPLORE"); expect(cameraView()).not.toEqual(before);
  });
  it.each(["input", "textarea", "select", "contenteditable", "button"])("does not hijack keyboard input in %s", kind => {
    const target = document.createElement(kind === "contenteditable" ? "div" : kind);
    if (kind === "contenteditable") target.setAttribute("contenteditable", "true");
    container.appendChild(target); const before = cameraView();
    key("_", 189, { shiftKey: true }, target); drain();
    expect(cameraView()).toEqual(before); expect(context.state.mode).toBe("VEHICLE_FOCUS");
  });
  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])("ignores modified shortcuts %j", modifiers => {
    const before = cameraView(); key("-", 189, modifiers); drain();
    expect(cameraView()).toEqual(before); expect(context.state.mode).toBe("VEHICLE_FOCUS");
  });
  it("does not suspend for unrelated keys or key strings Leaflet does not recognize", () => {
    const before = cameraView(); key("x", 88); key("-", 0); drain();
    expect(cameraView()).toEqual(before); expect(context.state.mode).toBe("VEHICLE_FOCUS");
  });
});

describe("F3 superseded popup work", () => {
  it("manual drag before popup RAF wins", () => {
    popup(); moveManually(); const manual = cameraView(); drain();
    expect(cameraView()).toEqual(manual); expect(context.state.mode).toBe("FREE_EXPLORE");
  });
  it("wheel before popup RAF invalidates its adjustment", () => {
    popup(); act(() => { container.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, bubbles: true })); map.setView([3.3, 101.8], 15, { animate: false }); });
    const manual = cameraView(); drain(); expect(cameraView()).toEqual(manual); expect(context.state.mode).toBe("FREE_EXPLORE");
  });
  it("another vehicle selection supersedes old popup work", () => {
    popup(); const before = cameraView(); update(busRecords(start).find(item => item.id === "bus:T402:01")!); drain();
    expect(cameraView()).toEqual(before); expect(context.state).toMatchObject({ mode: "FREE_EXPLORE", vehicleId: "bus:T402:01" });
  });
  it("closing a popup before RAF prevents its adjustment", () => {
    const layer = popup(), before = cameraView(); act(() => map.closePopup(layer)); drain(); expect(cameraView()).toEqual(before);
  });
  it("an unsuperseded open popup still receives its one-shot adjustment", () => {
    popup(); const before = cameraView(); drain(); expect(cameraView()).not.toEqual(before);
    const adjusted = cameraView(); drain(); expect(cameraView()).toEqual(adjusted); expect(context.state.mode).toBe("VEHICLE_FOCUS");
  });
  it.each(["OVERVIEW", "ROUTE", "STOP"] as const)("%s supersedes old popup work", type => {
    popup(); dispatch(type === "STOP" ? { type, point: [3.25, 101.75], id: "stop", sequence: 1 } : { type });
    const explicit = cameraView(); drain(); expect(cameraView()).toEqual(explicit);
    expect(context.state.mode).toBe(type === "STOP" ? "FREE_EXPLORE" : "OVERVIEW");
  });
  it("popup ownership survives React-Leaflet portal content mounting after popupopen", () => {
    const layer = L.popup({ autoPan: false, className: "bus-popup-owner-" + encodeURIComponent(bus.id) }).setLatLng(bus.position!).setContent("loading");
    act(() => { layer.openOn(map); });
    layer.setContent('<div class="bus-vehicle-popup" data-vehicle-id="' + bus.id + '">Bus</div>');
    vi.spyOn(layer.getElement()!, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300, toJSON() {} });
    const before = cameraView(); drain(); expect(cameraView()).not.toEqual(before);
  });
  it("the marker popup opened with a matching new selection still positions once", () => {
    const next = busRecords(start).find(item => item.id === "bus:T402:01")!;
    popup(next); update(next); const before = cameraView(); drain();
    expect(cameraView()).not.toEqual(before); expect(context.state.mode).toBe("FREE_EXPLORE");
  });
  it("a dequeued old callback cannot act on a replacement popup", () => {
    popup(); const old = [...frames.values()].at(-1)!;
    popup(); const before = cameraView(); act(() => old(performance.now()));
    expect(cameraView()).toEqual(before); drain(); expect(cameraView()).not.toEqual(before);
  });
  it("new manual input also supersedes a popup opened during a selection commit", () => {
    const next = busRecords(start).find(item => item.id === "bus:T402:01")!;
    popup(next); update(next); moveManually(); const manual = cameraView(); drain();
    expect(cameraView()).toEqual(manual); expect(context.state.mode).toBe("FREE_EXPLORE");
  });
  it("manual input cancels an already scheduled trailing follow", () => {
    vi.spyOn(performance, "now").mockReturnValue(0); focus();
    update({ ...bus, position: [3.4, 101.9] });
    moveManually(); const manual = cameraView(); act(() => vi.advanceTimersByTime(2000)); drain();
    expect(cameraView()).toEqual(manual); expect(context.state.mode).toBe("FREE_EXPLORE");
  });
  it("unmount cancels popup RAF and issues no later command", () => {
    popup(); const command = vi.spyOn(map, "setView"); view.unmount(); drain(); expect(command).not.toHaveBeenCalled();
  });
  it("shared manual intent used by LinkBike supersedes pending popup work", () => {
    popup(); dispatch({ type: "MANUAL" });
    act(() => context.guard.run(() => map.fitBounds([[5.4, 100.3], [5.42, 100.32]], { animate: false })));
    const bike = cameraView(); drain(); expect(cameraView()).toEqual(bike); expect(context.state.mode).toBe("FREE_EXPLORE");
  });
});
