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

describe("Rail popup recovery with real React-Leaflet bindings", () => {
  it("registers its callbacks only against the actual non-null bound popup", async () => {
    const registered: L.Popup[] = [];
    const original = L.Popup.prototype.on;
    vi.spyOn(L.Popup.prototype, "on").mockImplementation(function (this: L.Popup, ...args: Parameters<L.Popup["on"]>) {
      registered.push(this);
      return original.apply(this, args);
    });
    const { popup, marker } = await mounted();
    expect(registered).toContain(popup);
    expect(marker.getPopup()).toBe(popup);
    expect(popup.options.pane).toBe("popupPane");
    expect(popup.options.autoPan).toBe(true);
  });

  it("lets the current owner place and emit a changed-only notification without moving the map", async () => {
    const { map, popup, element } = await mounted();
    const { resize } = observers(element), event = vi.fn();
    popup.on("presentationlayout", event);
    const pan = vi.spyOn(map, "panBy"), setView = vi.spyOn(map, "setView"), fit = vi.spyOn(map, "fitBounds");
    sourcePoint.x += 30;
    act(() => resize.deliver());
    expect(element.style.getPropertyValue("--rail-popup-x")).toBe("180px");
    expect(event).toHaveBeenCalledTimes(1);
    act(() => resize.deliver());
    expect(event).toHaveBeenCalledTimes(1);
    expect(pan).not.toHaveBeenCalled(); expect(setView).not.toHaveBeenCalled(); expect(fit).not.toHaveBeenCalled();
  });

  it("disconnects observers and rejects dequeued work after close and ref cleanup", async () => {
    const { view, popup, element } = await mounted();
    const old = observers(element), queued = deferred(popup), event = vi.fn();
    popup.on("presentationlayout", event);
    act(() => { popup.close(); });
    expect(old.resize.disconnected).toBe(true); expect(old.mutation.disconnected).toBe(true);
    const before = snapshotStyle(element);
    sourcePoint.x += 50;
    expect(() => act(() => { old.resize.deliver(); old.mutation.deliver(); queued.forEach(callback => callback()); })).not.toThrow();
    expect(snapshotStyle(element)).toBe(before); expect(event).not.toHaveBeenCalled();
    view.unmount();
    expect(() => act(() => { old.resize.deliver(); queued.forEach(callback => callback()); })).not.toThrow();
    expect(event).not.toHaveBeenCalled();
  });

  it("rejects stale generations after reopening the same popup", async () => {
    const { marker, popup, element } = await mounted(), old = observers(element), queued = deferred(popup);
    act(() => { marker.closePopup(); marker.openPopup(); });
    await waitFor(() => expect(observers(element).resize).not.toBe(old.resize));
    const event = vi.fn(); popup.on("presentationlayout", event);
    const before = snapshotStyle(element); sourcePoint.x += 25;
    act(() => { old.resize.deliver(); old.mutation.deliver(); queued.forEach(callback => callback()); });
    expect(snapshotStyle(element)).toBe(before); expect(event).not.toHaveBeenCalled();
    act(() => observers(element).resize.deliver());
    expect(event).toHaveBeenCalledTimes(1);
  });

  it("prevents an old popup callback from modifying or notifying a replacement owner", async () => {
    const { view, map, popup, element } = await mounted(), old = observers(element), queued = deferred(popup);
    const nextMarker = findMarker(map, b);
    view.rerender(<Harness selected={b.id}/>);
    act(() => { nextMarker.openPopup(); });
    const replacement = required(nextMarker.getPopup());
    await waitFor(() => expect(replacement.getElement()?.querySelector(".rail-station-popup")).not.toBeNull());
    const next = required(replacement.getElement()), before = snapshotStyle(next);
    const oldEvent = vi.fn(), newEvent = vi.fn();
    popup.on("presentationlayout", oldEvent); replacement.on("presentationlayout", newEvent);
    sourcePoint.x += 25;
    act(() => { old.resize.deliver(); old.mutation.deliver(); queued.forEach(callback => callback()); });
    expect(snapshotStyle(next)).toBe(before); expect(oldEvent).not.toHaveBeenCalled(); expect(newEvent).not.toHaveBeenCalled();
    act(() => observers(next).resize.deliver());
    expect(newEvent).toHaveBeenCalledTimes(1);
  });

  it("retires a confirmed owner on selection change without a stale notification", async () => {
    const { view, popup, element } = await mounted(), old = observers(element), event = vi.fn();
    popup.on("presentationlayout", event);
    view.rerender(<Harness selected={b.id}/>);
    const before = snapshotStyle(element); sourcePoint.x += 20;
    act(() => old.resize.deliver());
    expect(old.resize.disconnected).toBe(true); expect(snapshotStyle(element)).toBe(before);
    expect(event).not.toHaveBeenCalled();
  });
});

describe("Rail coordinate validation before projection or placement writes", () => {
  it("reads a valid native anchor once and uses it for projection", async () => {
    const { map, popup, element } = await mounted(), native = popup.getLatLng();
    const read = vi.spyOn(popup, "getLatLng"), project = vi.spyOn(map, "latLngToContainerPoint");
    act(() => observers(element).resize.deliver());
    expect(read).toHaveBeenCalledTimes(1); expect(project).toHaveBeenCalledWith(native);
    expect(element.dataset.railPresentationConflict).toBeUndefined();
  });

  for (const [name, lat, lng] of [
    ["NaN latitude", NaN, 101.71], ["infinite longitude", 3.15, Infinity],
    ["latitude over range", 91, 101.71], ["latitude under range", -91, 101.71],
    ["longitude over range", 3.15, 181], ["longitude under range", 3.15, -181],
  ] as const) {
    it("rejects " + name + " without projecting, writing placement, or notifying layout", async () => {
      const { map, popup, element } = await mounted(), event = vi.fn();
      vi.spyOn(popup, "getLatLng").mockReturnValue(faultPoint(lat, lng));
      const project = vi.spyOn(map, "latLngToContainerPoint"), writes = vi.spyOn(element.style, "setProperty");
      const conflict = vi.fn(); map.on("railpresentationconflict", conflict); popup.on("presentationlayout", event);
      const before = snapshotStyle(element);
      act(() => observers(element).resize.deliver());
      expect(project).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
      expect(snapshotStyle(element)).toBe(before); expect(event).not.toHaveBeenCalled();
      expect(element.dataset.railPresentationConflict).toBe("invalid-native-anchor");
      expect(conflict).toHaveBeenCalledWith(expect.objectContaining({ owner: "rail-popup-owner-" + a.id, reason: "invalid-native-anchor" }));
    });
  }

  it("does not substitute record.position when the native anchor and current binding are missing", async () => {
    const { map, popup, marker, element } = await mounted();
    vi.spyOn(popup, "getLatLng").mockReturnValue(undefined);
    vi.spyOn(marker, "getPopup").mockReturnValue(undefined);
    const project = vi.spyOn(map, "latLngToContainerPoint"), writes = vi.spyOn(element.style, "setProperty");
    act(() => observers(element).resize.deliver());
    expect(project).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    expect(element.dataset.railPresentationConflict).toBe("source-context-mismatch");
  });

  it("accepts a missing-native-anchor fallback only from the bound, mapped, record-consistent CircleMarker", async () => {
    const { map, popup, marker, element } = await mounted(), anchor = marker.getLatLng();
    vi.spyOn(popup, "getLatLng").mockReturnValue(undefined);
    const project = vi.spyOn(map, "latLngToContainerPoint"), event = vi.fn(); popup.on("presentationlayout", event);
    sourcePoint.x += 20;
    act(() => observers(element).resize.deliver());
    expect(map.hasLayer(marker)).toBe(true); expect(marker.getPopup()).toBe(popup);
    expect(project).toHaveBeenCalledWith(anchor); expect(event).toHaveBeenCalledTimes(1);
    expect(element.dataset.railPresentationConflict).toBeUndefined();
  });

  it("rejects a stale CircleMarker binding even when the native anchor is valid", async () => {
    const { map, popup, marker, element } = await mounted();
    vi.spyOn(marker, "getPopup").mockReturnValue(new L.Popup());
    const project = vi.spyOn(map, "latLngToContainerPoint"), writes = vi.spyOn(element.style, "setProperty");
    act(() => observers(element).resize.deliver());
    expect(project).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    expect(element.dataset.railPresentationConflict).toBe("source-context-mismatch");
  });

  it("rejects a source outside current map membership", async () => {
    const { map, marker, element } = await mounted();
    const hasLayer = map.hasLayer.bind(map);
    vi.spyOn(map, "hasLayer").mockImplementation(layer => layer === marker ? false : hasLayer(layer));
    const project = vi.spyOn(map, "latLngToContainerPoint"), writes = vi.spyOn(element.style, "setProperty");
    act(() => observers(element).resize.deliver());
    expect(project).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    expect(element.dataset.railPresentationConflict).toBe("source-context-mismatch");
  });

  it("rejects a fallback inconsistent with the current station record", async () => {
    const { map, popup, marker, element } = await mounted();
    vi.spyOn(popup, "getLatLng").mockReturnValue(undefined);
    vi.spyOn(marker, "getLatLng").mockReturnValue(L.latLng(4, 102));
    const project = vi.spyOn(map, "latLngToContainerPoint"), writes = vi.spyOn(element.style, "setProperty");
    act(() => observers(element).resize.deliver());
    expect(project).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    expect(element.dataset.railPresentationConflict).toBe("source-record-mismatch");
  });

  it("rejects a native anchor inconsistent with the current source", async () => {
    const { map, popup, element } = await mounted();
    vi.spyOn(popup, "getLatLng").mockReturnValue(L.latLng(4, 102));
    const project = vi.spyOn(map, "latLngToContainerPoint"), writes = vi.spyOn(element.style, "setProperty");
    act(() => observers(element).resize.deliver());
    expect(project).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    expect(element.dataset.railPresentationConflict).toBe("anchor-source-mismatch");
  });

  it("rejects nonfinite projection before any placement write", async () => {
    const { map, element } = await mounted();
    vi.spyOn(map, "latLngToContainerPoint").mockReturnValue(L.point(NaN, Infinity));
    const writes = vi.spyOn(element.style, "setProperty");
    act(() => observers(element).resize.deliver());
    expect(writes).not.toHaveBeenCalled();
    expect(element.dataset.railPresentationConflict).toBe("invalid-projection");
  });
});

