import React, { useState } from "react";
import L from "leaflet";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransitMap from "@/components/transit-map";
import { BusCameraProvider, useBusCamera } from "@/components/bus-camera-context";
import { simulationSnapshot } from "@/lib/simulation";
import { railNetwork } from "@/lib/simulation/network";
import { busJourney } from "@/lib/simulation/vehicles";

const time = Date.parse("2026-11-17T09:41:25Z");
const first = "bus:T401:01";
let camera: ReturnType<typeof useBusCamera>;
const maps = new Set<L.Map>();
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let svgDescriptor: PropertyDescriptor | undefined;

function Capture() { camera = useBusCamera(); return null; }
function Harness({ now = time, initialId = first, empty = false }: { now?: number; initialId?: string | null; empty?: boolean }) {
  const [id, setId] = useState(initialId);
  const snapshot = simulationSnapshot(now);
  const selected = snapshot.records.find(record => record.id === id);
  const journey = id?.startsWith("bus:") ? busJourney(id, now) : null;
  return <BusCameraProvider selectedVehicleId={id?.startsWith("bus:") ? id : null} selectedRecordId={id}>
    <Capture/>
    <TransitMap records={empty ? [] : snapshot.records} busRouteId="" showBusRoutes selected={selected}
      onSelect={record => setId(record?.id ?? null)} resetSignal={0} network={railNetwork}
      journey={journey ?? null} navigation={null} onLocate={() => {}} trains={empty ? [] : snapshot.trains}
      bikes={empty ? [] : snapshot.linkBike.stations} now={now} onRefresh={() => {}}/>
  </BusCameraProvider>;
}
function drain() {
  for (let count = 0; frames.size && count < 20; count++) {
    const batch = [...frames]; frames.clear();
    act(() => batch.forEach(([, callback]) => callback(performance.now())));
  }
  expect(frames.size).toBe(0);
}
async function mounted() {
  await waitFor(() => expect(document.querySelectorAll(".bus-vehicle-icon")).toHaveLength(4));
  drain();
  return [...maps].at(-1)!;
}
function layers(map: L.Map) { const values: L.Layer[] = []; map.eachLayer(layer => values.push(layer)); return values; }
function vehicle(map: L.Map, title = "Bus T401-01") {
  const layer = layers(map).find(layer => layer instanceof L.Marker && layer.options.title === title);
  expect(layer).toBeInstanceOf(L.Marker); return layer as L.Marker;
}
async function open(marker: L.Layer & { getPopup(): L.Popup | undefined }, content: string) {
  act(() => { marker.fire("click"); });
  const popup = marker.getPopup()!;
  await waitFor(() => expect(popup.getElement()?.querySelector(content)).not.toBeNull());
  return popup;
}
function standardPane(map: L.Map, popup: L.Popup) {
  expect(popup.options.pane).toBe("popupPane");
  expect(popup.getElement()?.parentElement).toBe(map.getPane("popupPane"));
}
beforeEach(() => {
  // The repository Vitest transform uses classic JSX; provide React without mocking React-Leaflet.
  vi.stubGlobal("React", React);
  maps.clear(); frames = new Map(); nextFrame = 0;
  svgDescriptor = Object.getOwnPropertyDescriptor(L.Browser, "svg");
  Object.defineProperty(L.Browser, "svg", { configurable: true, value: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const map = this.classList.contains("leaflet-container");
    const popup = this.classList.contains("leaflet-popup");
    // Rail CSS translation is already part of browser-measured bounds.
    const rail = popup && this.classList.contains("rail-station-popup-shell");
    const shiftX = rail ? Number.parseFloat(this.style.getPropertyValue("--rail-popup-x") || "0") : 0;
    const shiftY = rail ? Number.parseFloat(this.style.getPropertyValue("--rail-popup-y") || "0") : 0;
    const left = (map ? 0 : 100) + shiftX, top = (map ? 100 : 150) + shiftY;
    const width = map ? 700 : popup ? 200 : 0, height = map ? 400 : popup ? 100 : 0;
    return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() {} };
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  const add = L.Map.prototype.addLayer;
  vi.spyOn(L.Map.prototype, "addLayer").mockImplementation(function (this: L.Map, layer: L.Layer) { maps.add(this); return add.call(this, layer); });
});
afterEach(() => {
  cleanup(); frames.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (svgDescriptor) Object.defineProperty(L.Browser, "svg", svgDescriptor);
});

describe("actual React-Leaflet popup pane integration", () => {
  it("renders trains and LinkBike stations immediately without visibility checkboxes", async () => {
    const view = render(<Harness initialId={null}/>);
    const map = await mounted();
    await waitFor(() => expect(document.querySelectorAll(".linkbike-marker")).toHaveLength(27));
    expect(document.querySelectorAll(".estimated-train-icon").length).toBeGreaterThan(0);
    const train = layers(map).find(layer => layer instanceof L.Marker && String(layer.options.icon?.options.className).includes("estimated-train")) as L.Marker;
    expect(train.options.pane).toBe("simulated-trains");
    expect(train.getPopup()?.options.pane).toBe("popupPane");
    expect(view.queryByRole("checkbox", { name: "Show simulated train positions" })).toBeNull();
    expect(view.queryByRole("checkbox", { name: "Show LinkBike stations" })).toBeNull();
    expect(view.getByRole("button", { name: "Refresh train positions" })).toBeVisible();
    expect(view.getByRole("button", { name: "Zoom to LinkBike stations" })).toBeVisible();
    expect(document.querySelector(".linkbike-controls")).toHaveTextContent("SIMULATED");
  });

  it("keeps the enabled layers honest when no train or bike data is available", async () => {
    const view = render(<Harness initialId={null} empty/>);
    await waitFor(() => expect(document.querySelector(".linkbike-map-status")).toHaveTextContent("0 simulated LinkBike stations"));
    drain();
    expect(view.getByRole("region", { name: "Simulated train positions" })).toHaveTextContent("0 simulated trains displayed");
    expect(document.querySelectorAll(".estimated-train-icon,.linkbike-marker")).toHaveLength(0);
    expect(view.queryByRole("button", { name: "Zoom to LinkBike stations" })).toBeNull();
    expect(document.querySelector(".linkbike-controls")).toHaveTextContent("SIMULATED");
  });

  it("binds the vehicle popup to its original marker while escaping inherited bus pane", async () => {
    render(<Harness/>); const map = await mounted(), marker = vehicle(map);
    expect(marker.options.pane).toBe("bus-markers");
    const popup = await open(marker, ".bus-vehicle-popup");
    standardPane(map, popup);
    expect(marker.getElement()?.parentElement).toBe(map.getPane("bus-markers"));
    expect(popup.options.autoPan).toBe(false);
    expect(popup.options.className).toBe("bus-popup-owner-" + encodeURIComponent(first));
    expect(popup.getElement()?.querySelector(".bus-vehicle-popup")).toHaveAttribute("data-vehicle-id", first);
    expect(popup.getElement()).toHaveTextContent("SIMULATED");
    expect(marker.getPopup()).toBe(popup);
  });
  it("keeps journey-stop markers in bus pane and their popup in standard pane", async () => {
    render(<Harness/>); const map = await mounted();
    const marker = layers(map).find(layer => layer instanceof L.Marker &&
      String(layer.options.icon?.options.className).includes("bus-journey-stop")) as L.Marker;
    expect(marker).toBeDefined(); expect(marker.options.pane).toBe("bus-markers");
    const popup = await open(marker, ".journey-stop-popup");
    standardPane(map, popup);
    expect(marker.getElement()?.parentElement).toBe(map.getPane("bus-markers"));
    expect(popup.options.closeOnClick).toBe(false);
    expect(popup.options.minWidth).toBe(170); expect(popup.options.maxWidth).toBe(245);
    expect(popup.options.autoPan).toBe(true);
  });
  it("keeps rail station renderer in markerPane but its popup in popupPane", async () => {
    render(<Harness initialId={null}/>); const map = await mounted();
    const marker = layers(map).find(layer => layer instanceof L.CircleMarker && layer.options.className === "rail-station") as L.CircleMarker;
    expect(marker).toBeDefined(); expect(marker.options.pane).toBe("markerPane");
    const popup = await open(marker, ".leaflet-popup-content strong");
    standardPane(map, popup);
    expect(map.getPane("markerPane")?.contains(marker.getElement()!)).toBe(true);
    expect(popup.getElement()).toHaveTextContent("SIMULATED");
    expect(camera.state.viewIntent).toBe("selection");
  });
  it("closes, reopens and replaces owned vehicle popup without changing bindings", async () => {
    render(<Harness/>); const map = await mounted(), marker = vehicle(map), other = vehicle(map, "Bus T402-01");
    const popup = await open(marker, ".bus-vehicle-popup"); drain();
    act(() => marker.closePopup());
    expect(popup.isOpen()).toBe(false);
    await open(marker, ".bus-vehicle-popup");
    const replacement = await open(other, ".bus-vehicle-popup"); drain();
    expect(popup.isOpen()).toBe(false);
    expect(replacement.isOpen()).toBe(true); standardPane(map, replacement);
    expect(camera.state.vehicleId).toBe("bus:T402:01");
    expect(replacement.getElement()?.querySelector(".bus-vehicle-popup")).toHaveAttribute("data-vehicle-id", "bus:T402:01");
    expect(marker.getPopup()).toBe(popup); expect(other.getPopup()).toBe(replacement);
  });
  it("updates actual portal content in FREE_EXPLORE without native Leaflet auto-pan", async () => {
    const view = render(<Harness/>); const map = await mounted(), marker = vehicle(map);
    const popup = await open(marker, ".bus-vehicle-popup"); drain();
    act(() => camera.dispatch({ type: "MANUAL" })); drain();
    const before = map.getCenter(), zoom = map.getZoom();
    const pan = vi.spyOn(map, "panBy"), update = vi.spyOn(popup, "update");
    view.rerender(<Harness now={time + 5000}/>);
    await waitFor(() => expect(update).toHaveBeenCalled()); drain();
    expect(popup.options.autoPan).toBe(false);
    expect(pan).not.toHaveBeenCalled();
    expect(map.getCenter()).toEqual(before); expect(map.getZoom()).toBe(zoom);
    expect(camera.state.mode).toBe("FREE_EXPLORE"); standardPane(map, popup);
  });
  it("cancels pending actual-popup work on close and on unmount, then remounts cleanly", async () => {
    const view = render(<Harness/>); const map = await mounted(), marker = vehicle(map);
    const popup = await open(marker, ".bus-vehicle-popup");
    const dequeued = [...frames.values()];
    act(() => marker.closePopup()); const move = vi.spyOn(map, "setView");
    act(() => dequeued.forEach(callback => callback(performance.now()))); drain();
    expect(move).not.toHaveBeenCalled(); expect(popup.isOpen()).toBe(false);
    await open(marker, ".bus-vehicle-popup");
    const pending = [...frames.values()];
    view.unmount(); move.mockClear();
    act(() => pending.forEach(callback => callback(performance.now())));
    expect(move).not.toHaveBeenCalled();
    expect(document.querySelector(".leaflet-container")).toBeNull();
    expect(marker.getPopup()).toBeNull();
    render(<Harness/>); const freshMap = await mounted(), freshMarker = vehicle(freshMap);
    const freshPopup = await open(freshMarker, ".bus-vehicle-popup");
    expect(freshMap).not.toBe(map); expect(freshPopup).not.toBe(popup);
    standardPane(freshMap, freshPopup);
  });
});
