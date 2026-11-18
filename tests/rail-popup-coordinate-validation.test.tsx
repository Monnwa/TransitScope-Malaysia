import React from "react";
import L from "leaflet";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircleMarker, MapContainer, useMap } from "react-leaflet";
import type { Record as TransitRecord } from "@/lib/transit-data";
import RailStationPopup from "@/components/rail-station-popup";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a mounted test value");
  return value;
}
function station(id: string, position: [number, number] = [3.15, 101.71]): TransitRecord {
  return { id, name: id, mode: "MRT", operator: "SIMULATED", route: "Test rail",
    station: id, position, reportedAt: null, status: "Station available",
    dataMode: "SIMULATED", source: "Local unit fixture" };
}
const a = station("rail-recovery-a"), b = station("rail-recovery-b", [3.16, 101.72]);
let capturedMap: L.Map | undefined;
let svgDescriptor: PropertyDescriptor | undefined;
let sourcePoint = { x: 350, y: 300 };

class ControlledResizeObserver implements ResizeObserver {
  static all: ControlledResizeObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: ResizeObserverCallback) { ControlledResizeObserver.all.push(this); }
  observe(target: Element) { this.targets.add(target); this.disconnected = false; }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); this.disconnected = true; }
  deliver() { this.callback([], this); } // Deliberately deliver an already-dequeued callback, too.
}
class ControlledMutationObserver implements MutationObserver {
  static all: ControlledMutationObserver[] = [];
  readonly targets = new Set<Node>();
  disconnected = false;
  constructor(readonly callback: MutationCallback) { ControlledMutationObserver.all.push(this); }
  observe(target: Node) { this.targets.add(target); this.disconnected = false; }
  disconnect() { this.targets.clear(); this.disconnected = true; }
  takeRecords(): MutationRecord[] { return []; }
  deliver() { this.callback([], this); }
}
function Capture() { capturedMap = useMap(); return null; }
function Harness({ selected = a.id, records = [a, b] }: {
  selected?: string; records?: TransitRecord[];
}) {
  return <MapContainer center={[3.15, 101.71]} zoom={13} fadeAnimation={false}
    zoomAnimation={false} markerZoomAnimation={false}>
    <Capture/>
    {records.map(record => record.position && <CircleMarker key={record.id}
      center={record.position} className="recovery-station">
      <RailStationPopup record={record} selectedRecordId={selected}/>
    </CircleMarker>)}
  </MapContainer>;
}
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width,
    bottom: top + height, toJSON() { return {}; } };
}
function geometry(this: Element): DOMRect {
  if (this.classList.contains("leaflet-container")) return rect(0, 100, 700, 400);
  if (this.classList.contains("recovery-station")) return rect(sourcePoint.x - 5, sourcePoint.y - 5, 10, 10);
  if (this instanceof HTMLElement && this.classList.contains("leaflet-popup")) {
    const x = Number.parseFloat(this.style.getPropertyValue("--rail-popup-x")) || 0;
    const y = Number.parseFloat(this.style.getPropertyValue("--rail-popup-y")) || 0;
    return rect(100 + x, 150 + y, 200, 100);
  }
  return rect(0, 0, 0, 0);
}
async function mounted(record = a, selected = record.id) {
  const view = render(<Harness selected={selected}/>);
  await waitFor(() => expect(capturedMap).toBeDefined());
  const map = required(capturedMap);
  const marker = findMarker(map, record);
  act(() => { marker.openPopup(); });
  const popup = required(marker.getPopup());
  await waitFor(() => expect(popup.getElement()?.querySelector(".rail-station-popup")).not.toBeNull());
  await waitFor(() => expect(required(popup.getElement()).style.getPropertyValue("--rail-popup-x")).not.toBe(""));
  return { view, map, marker, popup, element: required(popup.getElement()) };
}
function findMarker(map: L.Map, record: TransitRecord): L.CircleMarker {
  let found: L.CircleMarker | undefined;
  map.eachLayer(layer => {
    if (layer instanceof L.CircleMarker && record.position &&
        layer.getLatLng().lat === record.position[0] && layer.getLatLng().lng === record.position[1]) found = layer;
  });
  return required(found);
}
function observers(element: HTMLElement) {
  return {
    resize: required(ControlledResizeObserver.all.find(observer => observer.targets.has(element))),
    mutation: required(ControlledMutationObserver.all.find(observer => observer.targets.has(element))),
  };
}
function snapshotStyle(element: HTMLElement) { return element.getAttribute("style"); }
function deferred(popup: L.Popup) {
  const callbacks: VoidFunction[] = [];
  const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation(callback => callbacks.push(callback));
  act(() => { popup.fire("contentupdate"); });
  spy.mockRestore();
  return callbacks;
}
function faultPoint(lat: number, lng: number) {
  return Object.assign(L.latLng(3.15, 101.71), { lat, lng });
}
beforeEach(() => {
  capturedMap = undefined; sourcePoint = { x: 350, y: 300 };
  ControlledResizeObserver.all = []; ControlledMutationObserver.all = [];
  vi.stubGlobal("React", React);
  vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
  vi.stubGlobal("MutationObserver", ControlledMutationObserver);
  vi.stubGlobal("innerWidth", 1101); vi.stubGlobal("innerHeight", 830);
  svgDescriptor = Object.getOwnPropertyDescriptor(L.Browser, "svg");
  Object.defineProperty(L.Browser, "svg", { configurable: true, value: true });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(geometry);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (svgDescriptor) Object.defineProperty(L.Browser, "svg", svgDescriptor);
});


describe("Approved Rail native-coordinate contract after a valid native open", () => {
  const invalidInputs: { name: string; value: unknown; reason: string }[] = [
    { name: "undefined", value: undefined, reason: "unavailable-native-anchor" },
    { name: "null", value: null, reason: "unavailable-native-anchor" },
    ...[
      ["missing latitude", { lng: 101.71 }], ["missing longitude", { lat: 3.15 }],
      ["string latitude", { lat: "3.15", lng: 101.71 }], ["string longitude", { lat: 3.15, lng: "101.71" }],
      ["boolean latitude", { lat: true, lng: 101.71 }], ["primitive", 7],
      ["NaN latitude", { lat: NaN, lng: 101.71 }], ["NaN longitude", { lat: 3.15, lng: NaN }],
      ["positive infinite latitude", { lat: Infinity, lng: 101.71 }], ["negative infinite latitude", { lat: -Infinity, lng: 101.71 }],
      ["positive infinite longitude", { lat: 3.15, lng: Infinity }], ["negative infinite longitude", { lat: 3.15, lng: -Infinity }],
      ["latitude above range", { lat: 90.001, lng: 101.71 }], ["latitude below range", { lat: -90.001, lng: 101.71 }],
      ["longitude above range", { lat: 3.15, lng: 180.001 }], ["longitude below range", { lat: 3.15, lng: -180.001 }],
    ].map(([name, value]) => ({ name: String(name), value, reason: "invalid-native-anchor" })),
  ];
  for (const { name, value, reason } of invalidInputs) {
    it("rejects " + name + " without projection, placement or successful publication", async () => {
      const { map, popup, element } = await mounted();
      const read = vi.fn(() => value);
      Object.defineProperty(popup, "getLatLng", { configurable: true, value: read });
      const project = vi.spyOn(map, "latLngToContainerPoint"), writes = vi.spyOn(element.style, "setProperty");
      const event = vi.fn(), diagnostic = vi.fn();
      popup.on("presentationlayout", event); map.on("railpresentationconflict", diagnostic);
      const pan = vi.spyOn(map, "panBy"), view = vi.spyOn(map, "setView"), fit = vi.spyOn(map, "fitBounds");
      const before = snapshotStyle(element); sourcePoint.x += 20;
      act(() => observers(element).resize.deliver());
      expect(read).toHaveBeenCalledTimes(1); expect(project).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled(); expect(snapshotStyle(element)).toBe(before);
      expect(event).not.toHaveBeenCalled(); expect(element.dataset.railPresentationConflict).toBe(reason);
      expect(diagnostic).toHaveBeenCalledTimes(1);
      expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ owner: "rail-popup-owner-" + a.id, reason, generation: expect.any(Number) }));
      act(() => observers(element).resize.deliver());
      expect(diagnostic).toHaveBeenCalledTimes(1);
      expect(pan).not.toHaveBeenCalled(); expect(view).not.toHaveBeenCalled(); expect(fit).not.toHaveBeenCalled();
    });
  }

  for (const [name, lat, lng] of [
    ["ordinary", 3.15, 101.71], ["latitude minimum", -90, 101.71], ["latitude maximum", 90, 101.71],
    ["longitude minimum", 3.15, -180], ["longitude maximum", 3.15, 180],
  ] as const) {
    it("projects the exact valid native anchor at " + name + " once without substitution", async () => {
      const { map, popup, marker, element } = await mounted(), native = L.latLng(lat, lng);
      const read = vi.spyOn(popup, "getLatLng").mockReturnValue(native), project = vi.spyOn(map, "latLngToContainerPoint");
      const markerRead = vi.spyOn(marker, "getLatLng"), event = vi.fn();
      popup.on("presentationlayout", event); sourcePoint.x += 20;
      act(() => observers(element).resize.deliver());
      expect(read).toHaveBeenCalledTimes(1); expect(project).toHaveBeenCalledExactlyOnceWith(native);
      expect(markerRead).not.toHaveBeenCalled(); expect(event).toHaveBeenCalledTimes(1);
      expect(element.dataset.railPresentationConflict).toBeUndefined();
      act(() => observers(element).resize.deliver());
      expect(event).toHaveBeenCalledTimes(1);
    });
  }

  const invalidOutputs: { name: string; value: unknown }[] = [
    { name: "missing", value: undefined }, { name: "null", value: null },
    { name: "missing x", value: { y: 1 } }, { name: "missing y", value: { x: 1 } },
    { name: "string x", value: { x: "1", y: 1 } }, { name: "string y", value: { x: 1, y: "1" } },
    { name: "NaN x", value: { x: NaN, y: 1 } }, { name: "NaN y", value: { x: 1, y: NaN } },
    { name: "infinite x", value: { x: Infinity, y: 1 } }, { name: "negative infinite x", value: { x: -Infinity, y: 1 } },
    { name: "infinite y", value: { x: 1, y: Infinity } }, { name: "negative infinite y", value: { x: 1, y: -Infinity } },
    { name: "primitive output", value: 3 },
  ];
  for (const { name, value } of invalidOutputs) {
    it("rejects " + name + " projection before placement writes and layout publication", async () => {
      const { map, popup, element } = await mounted();
      const project = vi.fn(() => value);
      Object.defineProperty(map, "latLngToContainerPoint", { configurable: true, value: project });
      const event = vi.fn(), diagnostic = vi.fn(), writes = vi.spyOn(element.style, "setProperty");
      popup.on("presentationlayout", event); map.on("railpresentationconflict", diagnostic);
      const before = snapshotStyle(element); sourcePoint.x += 20;
      act(() => observers(element).resize.deliver());
      expect(project).toHaveBeenCalledTimes(1); expect(writes).not.toHaveBeenCalled();
      expect(snapshotStyle(element)).toBe(before); expect(event).not.toHaveBeenCalled();
      expect(element.dataset.railPresentationConflict).toBe("invalid-projection");
      expect(diagnostic).toHaveBeenCalledTimes(1);
      act(() => observers(element).resize.deliver()); expect(diagnostic).toHaveBeenCalledTimes(1);
    });
  }

  it("recovers from deferred native input using only a later valid native anchor", async () => {
    const { map, popup, element } = await mounted(), native = required(popup.getLatLng());
    const read = vi.spyOn(popup, "getLatLng").mockReturnValue(undefined), event = vi.fn();
    const project = vi.spyOn(map, "latLngToContainerPoint"); popup.on("presentationlayout", event);
    act(() => observers(element).resize.deliver());
    expect(project).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled();
    read.mockReturnValue(native); sourcePoint.x += 20;
    act(() => observers(element).resize.deliver());
    expect(project).toHaveBeenCalledWith(native); expect(event).toHaveBeenCalledTimes(1);
    expect(element.dataset.railPresentationConflict).toBeUndefined();
  });

  it("rejects invalid source context before reading or projecting a native coordinate", async () => {
    const { map, popup, marker, element } = await mounted();
    vi.spyOn(marker, "getPopup").mockReturnValue(new L.Popup());
    const read = vi.spyOn(popup, "getLatLng"), project = vi.spyOn(map, "latLngToContainerPoint");
    const event = vi.fn(); popup.on("presentationlayout", event);
    act(() => observers(element).resize.deliver());
    expect(read).not.toHaveBeenCalled(); expect(project).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled(); expect(element.dataset.railPresentationConflict).toBe("source-context-mismatch");
  });

  it("does not project or diagnose after a native getter retires its owner", async () => {
    const { map, popup, element } = await mounted(), native = popup.getLatLng(), old = observers(element);
    vi.spyOn(popup, "getLatLng").mockImplementation(() => { popup.close(); return native; });
    const project = vi.spyOn(map, "latLngToContainerPoint"), event = vi.fn(), diagnostic = vi.fn();
    popup.on("presentationlayout", event); map.on("railpresentationconflict", diagnostic);
    const before = snapshotStyle(element);
    act(() => old.resize.deliver());
    expect(project).not.toHaveBeenCalled(); expect(snapshotStyle(element)).toBe(before);
    expect(event).not.toHaveBeenCalled(); expect(diagnostic).not.toHaveBeenCalled();
  });

  it("does not write or publish after projection retires its owner", async () => {
    const { map, popup, element } = await mounted(), project = map.latLngToContainerPoint.bind(map), old = observers(element);
    vi.spyOn(map, "latLngToContainerPoint").mockImplementation(anchor => { popup.close(); return project(anchor); });
    const writes = vi.spyOn(element.style, "setProperty"), event = vi.fn(), diagnostic = vi.fn();
    popup.on("presentationlayout", event); map.on("railpresentationconflict", diagnostic);
    const before = snapshotStyle(element); sourcePoint.x += 20;
    act(() => old.resize.deliver());
    expect(writes).not.toHaveBeenCalled(); expect(snapshotStyle(element)).toBe(before);
    expect(event).not.toHaveBeenCalled(); expect(diagnostic).not.toHaveBeenCalled();
  });

  it("stops subsequent CSS writes and layout publication when a write retires its owner", async () => {
    const { popup, element } = await mounted(), set = element.style.setProperty.bind(element.style);
    const writes = vi.spyOn(element.style, "setProperty").mockImplementation((name, value, priority) => {
      set(name, value, priority); popup.close();
    });
    const event = vi.fn(); popup.on("presentationlayout", event); sourcePoint.x += 20;
    act(() => observers(element).resize.deliver());
    expect(writes).toHaveBeenCalledTimes(1); expect(event).not.toHaveBeenCalled();
  });

  it("rejects disconnected popup work without reading native data or emitting a diagnostic", async () => {
    const { popup, element, map } = await mounted(), old = observers(element);
    const read = vi.spyOn(popup, "getLatLng"), event = vi.fn(), diagnostic = vi.fn();
    popup.on("presentationlayout", event); map.on("railpresentationconflict", diagnostic);
    const before = snapshotStyle(element); element.remove();
    act(() => old.resize.deliver());
    expect(read).not.toHaveBeenCalled(); expect(snapshotStyle(element)).toBe(before);
    expect(event).not.toHaveBeenCalled(); expect(diagnostic).not.toHaveBeenCalled();
  });
});
