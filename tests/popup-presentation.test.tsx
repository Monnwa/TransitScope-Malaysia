import React, { useState } from "react";
import L from "leaflet";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransitMap from "@/components/transit-map";
import { completeJourneyMeasurement } from "./helpers/journey-measurement";
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
function Harness({ now = time, initialId = first }: { now?: number; initialId?: string | null }) {
  const [id, setId] = useState(initialId);
  const snapshot = simulationSnapshot(now);
  const selected = snapshot.records.find(record => record.id === id);
  const journey = id?.startsWith("bus:") ? busJourney(id, now) : null;
  return <BusCameraProvider selectedVehicleId={id?.startsWith("bus:") ? id : null} selectedRecordId={id}>
    <Capture/>
    <TransitMap records={snapshot.records} busRouteId="" showBusRoutes selected={selected}
      onSelect={record => setId(record?.id ?? null)} resetSignal={0} railLines={railNetwork.lines} showSharedBike
      journey={journey ?? null} navigation={null} onLocate={() => {}} trains={snapshot.trains}
      bikes={snapshot.linkBike.stations} now={now} onRefresh={() => {}}/>
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
    const zoom = this.classList.contains("leaflet-control-zoom");
    const bottom = this.parentElement?.classList.contains("leaflet-bottom"), right = this.parentElement?.classList.contains("leaflet-right");
    // Browser-measured Rail bounds include the shell's CSS translate once.
    const rail = popup && this.classList.contains("rail-station-popup-shell");
    const shiftX = rail ? Number.parseFloat(this.style.getPropertyValue("--rail-popup-x") || "0") : 0;
    const shiftY = rail ? Number.parseFloat(this.style.getPropertyValue("--rail-popup-y") || "0") : 0;
    const left = (map ? 0 : zoom ? right ? 642 : 10 : 100) + shiftX;
    const top = (map ? 100 : zoom ? bottom ? 398 : 110 : 150) + shiftY;
    const width = map ? 700 : zoom ? 48 : popup ? 200 : 0, height = map ? 400 : zoom ? 92 : popup ? 100 : 0;
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


describe("K.5D popup presentation with actual React-Leaflet layers", () => {
  it.each([[-30, 36], [660, -166]])("contains a bus at base x=%s without a camera command", async (base, expected) => {
    render(<Harness/>); const map = await mounted(), marker = vehicle(map);
    const popup = await open(marker, ".bus-vehicle-popup"); drain();
    act(() => camera.dispatch({ type: "MANUAL" })); drain();
    const element = popup.getElement()!;
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
      const left = base + Number.parseFloat(element.style.getPropertyValue("--bus-popup-shift") || "0");
      return { x: left, y: 180, left, top: 180, right: left + 200, bottom: 280, width: 200, height: 100, toJSON() {} };
    });
    const before = { center: map.getCenter(), zoom: map.getZoom(), mode: camera.state.mode };
    const move = vi.spyOn(map, "setView"), pan = vi.spyOn(map, "panBy");
    act(() => popup.fire("contentupdate")); drain();
    expect(Number.parseFloat(element.style.getPropertyValue("--bus-popup-shift"))).toBe(expected);
    expect(element.getBoundingClientRect().left).toBeGreaterThanOrEqual(6);
    expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(694);
    expect(move).not.toHaveBeenCalled(); expect(pan).not.toHaveBeenCalled();
    expect({ center: map.getCenter(), zoom: map.getZoom(), mode: camera.state.mode }).toEqual(before);
    expect(popup.options.autoPan).toBe(false);
    act(() => marker.closePopup()); drain();
    expect(element.style.getPropertyValue("--bus-popup-shift")).toBe("");
    expect(element.style.getPropertyValue("--bus-popup-max-content")).toBe("");
  });

  it("rejects dequeued bus work after close, replacement and unmount", async () => {
    const view = render(<Harness/>); const map = await mounted(), firstMarker = vehicle(map);
    const popup = await open(firstMarker, ".bus-vehicle-popup"); drain();
    act(() => popup.fire("contentupdate")); const old = [...frames.values()];
    const replacement = await open(vehicle(map, "Bus T402-01"), ".bus-vehicle-popup");
    const newer = replacement.getElement()!;
    const style = newer.getAttribute("style");
    act(() => old.forEach(callback => callback(performance.now())));
    expect(newer.getAttribute("style")).toBe(style);
    drain(); act(() => replacement.fire("contentupdate"));
    const pending = [...frames.values()]; view.unmount();
    act(() => pending.forEach(callback => callback(performance.now())));
    expect(frames.size).toBe(0);
  });

  it("relocates one existing zoom control and ignores stale close events", async () => {
    vi.stubGlobal("innerWidth", 700);
    const view = render(<Harness/>); const map = await mounted(), zoom = map.zoomControl;
    const pins = layers(map).filter(layer => layer instanceof L.Marker &&
      String(layer.options.icon?.options.className).includes("bus-journey-stop")) as L.Marker[];
    const position = (popup: L.Popup) => vi.spyOn(popup.getElement()!, "getBoundingClientRect").mockReturnValue({
      x: 20, y: 150, left: 20, top: 150, right: 300, bottom: 255, width: 280, height: 105, toJSON() {},
    });
    const firstPopup = await open(pins[0], ".journey-stop-popup"), firstGeometry = position(firstPopup);
    const before = { center: map.getCenter(), zoom: map.getZoom(), mode: camera.state.mode };
    const move = vi.spyOn(map, "setView"), pan = vi.spyOn(map, "panBy");
    await completeJourneyMeasurement({ map, popup: firstPopup, trigger: () => { map.fire("move"); },
      drainFrames: drain, measurementReads: () => firstGeometry.mock.calls.length,
      verifyResult: () => expect(zoom.getPosition()).toBe("bottomleft") });
    expect(zoom.getPosition()).toBe("bottomleft");
    expect(document.querySelectorAll(".leaflet-control-zoom")).toHaveLength(1);
    expect(map.zoomControl).toBe(zoom);
    expect(move).not.toHaveBeenCalled(); expect(pan).not.toHaveBeenCalled();
    expect({ center: map.getCenter(), zoom: map.getZoom(), mode: camera.state.mode }).toEqual(before);
    const replacement = await open(pins[1], ".journey-stop-popup"), replacementGeometry = position(replacement);
    expect(replacement).not.toBe(firstPopup);
    await completeJourneyMeasurement({ map, popup: replacement, trigger: () => { map.fire("move"); },
      drainFrames: drain, measurementReads: () => replacementGeometry.mock.calls.length,
      verifyResult: () => expect(zoom.getPosition()).toBe("bottomleft") });
    expect(zoom.getPosition()).toBe("bottomleft");
    await act(async () => { map.fire("popupclose", { popup: firstPopup }); drain(); });
    expect(zoom.getPosition()).toBe("bottomleft");
    const positions = vi.spyOn(zoom, "setPosition");
    vi.stubGlobal("innerWidth", 1101);
    await completeJourneyMeasurement({ map, popup: replacement, trigger: () => { window.dispatchEvent(new Event("resize")); },
      drainFrames: drain, measurementReads: () => positions.mock.calls.length,
      verifyResult: () => expect(zoom.getPosition()).toBe("topleft") });
    expect(zoom.getPosition()).toBe("topleft");
    vi.stubGlobal("innerWidth", 700);
    await completeJourneyMeasurement({ map, popup: replacement, trigger: () => { window.dispatchEvent(new Event("resize")); },
      drainFrames: drain, measurementReads: () => replacementGeometry.mock.calls.length,
      verifyResult: () => expect(zoom.getPosition()).toBe("bottomleft") });
    expect(zoom.getPosition()).toBe("bottomleft");
    await act(async () => { pins[1].closePopup(); drain(); }); expect(zoom.getPosition()).toBe("topleft");
    const reopened = await open(pins[0], ".journey-stop-popup");
    await completeJourneyMeasurement({ map, popup: reopened, trigger: () => { map.fire("move"); },
      drainFrames: drain, measurementReads: () => firstGeometry.mock.calls.length,
      verifyResult: () => expect(zoom.getPosition()).toBe("bottomleft") });
    await act(async () => { view.unmount(); }); expect(zoom.getPosition()).toBe("topleft");
    expect(frames.size).toBe(0);
  });

  it("reports no safe zoom corner without hiding controls or moving the camera", async () => {
    vi.stubGlobal("innerWidth", 700);
    render(<Harness/>); const map = await mounted(), zoom = map.zoomControl, original = zoom.getPosition();
    const pin = layers(map).find(layer => layer instanceof L.Marker &&
      String(layer.options.icon?.options.className).includes("bus-journey-stop")) as L.Marker;
    const popup = await open(pin, ".journey-stop-popup"); drain();
    const geometry = vi.spyOn(popup.getElement()!, "getBoundingClientRect").mockReturnValue({x:0,y:100,left:0,top:100,right:700,bottom:500,width:700,height:400,toJSON(){}});
    const element = map.zoomControl.getContainer()!;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({x:10,y:110,left:10,top:110,right:58,bottom:202,width:48,height:92,toJSON(){}});
    const move = vi.spyOn(map, "setView"), pan = vi.spyOn(map, "panBy");
    const before = { center: map.getCenter(), zoom: map.getZoom(), mode: camera.state.mode };
    const conflict = vi.fn();
    const owner = "journey-stop-" + L.Util.stamp(popup);
    map.on("popupcontrolconflict", conflict);
    expect(map.getContainer().dataset.journeyZoomConflict).toBeUndefined();
    expect(map.getContainer().dataset.popupControlConflict).toBeUndefined();
    await completeJourneyMeasurement({ map, popup, trigger: () => { map.fire("move"); },
      drainFrames: drain, measurementReads: () => geometry.mock.calls.length,
      verifyResult: () => {
        expect(map.getContainer().dataset.journeyZoomConflict).toBe("no-safe-corner");
        expect(conflict).toHaveBeenCalledTimes(1);
        expect(conflict).toHaveBeenCalledWith(expect.objectContaining({ owner, reason: "no-safe-corner" }));
      } });
    expect(map.getContainer().dataset.journeyZoomConflict).toBe("no-safe-corner");
    expect(document.querySelectorAll(".leaflet-control-zoom")).toHaveLength(1);
    expect(map.zoomControl).toBe(zoom);
    const currentControl = zoom.getContainer()!;
    expect(currentControl.isConnected).toBe(true);
    expect(getComputedStyle(currentControl).display).not.toBe("none");
    expect(getComputedStyle(currentControl).visibility).not.toBe("hidden");
    expect(map.getContainer().dataset.popupControlConflict).toBe("no-safe-corner");
    expect(move).not.toHaveBeenCalled(); expect(pan).not.toHaveBeenCalled();
    expect({ center: map.getCenter(), zoom: map.getZoom(), mode: camera.state.mode }).toEqual(before);
    await act(async () => { pin.closePopup(); drain(); });
    expect(map.getContainer().dataset.journeyZoomConflict).toBeUndefined();
    expect(map.getContainer().dataset.popupControlConflict).toBeUndefined();
    expect(zoom.getPosition()).toBe(original);
    expect(map.zoomControl).toBe(zoom);
    expect(document.querySelectorAll(".leaflet-control-zoom")).toHaveLength(1);
    map.off("popupcontrolconflict", conflict);
  });

  it("limits the content gutter wrapper to rail popups, leaving LinkBike distinct", async () => {
    const view = render(<Harness initialId={null}/>); const map = await mounted();
    const rail = layers(map).find(layer => layer instanceof L.CircleMarker && layer.options.className === "rail-station") as L.CircleMarker;
    const popup = await open(rail, ".rail-station-popup"); standardPane(map, popup);
    expect(popup.getElement()?.querySelector(".rail-station-popup")).toHaveTextContent("SIMULATED");
    expect(view.queryByRole("checkbox", { name: "Show LinkBike stations" })).toBeNull();
    drain();
    const bike = layers(map).find(layer => layer instanceof L.Marker && String(layer.options.icon?.options.className).includes("linkbike")) as L.Marker;
    expect(bike).toBeDefined();
    act(() => { bike.openPopup(); }); drain();
    expect(bike.getPopup()?.getElement()?.querySelector(".rail-station-popup")).toBeNull();
    view.unmount();
  });
});
