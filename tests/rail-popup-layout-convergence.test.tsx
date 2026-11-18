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
let nativeBase = { left: 251, top: 191.65625, bottom: 321 };
function geometry(this: Element): DOMRect {
  if (this.classList.contains("leaflet-container")) return rect(266, 215, 501, 400);
  if (this.classList.contains("recovery-station")) return rect(sourcePoint.x - 5, sourcePoint.y - 5, 10, 10);
  if (this instanceof HTMLElement && this.classList.contains("leaflet-popup")) {
    const x=Number.parseFloat(this.style.getPropertyValue("--rail-popup-x"))||0;
    const y=Number.parseFloat(this.style.getPropertyValue("--rail-popup-y"))||0;
    const left=Math.fround(nativeBase.left+x),top=Math.fround(nativeBase.top+y);
    const right=Math.fround(nativeBase.left+347+x),bottom=Math.fround(nativeBase.bottom+y);
    return rect(left,top,right-left,bottom-top);
  }
  return rect(0,0,0,0);
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
  capturedMap = undefined; sourcePoint = { x: 425, y: 334 }; nativeBase={left:251,top:191.65625,bottom:321};
  ControlledResizeObserver.all = []; ControlledMutationObserver.all = [];
  vi.stubGlobal("React", React);
  vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
  vi.stubGlobal("MutationObserver", ControlledMutationObserver);
  vi.stubGlobal("innerWidth", 1101); vi.stubGlobal("innerHeight", 830);
  svgDescriptor = Object.getOwnPropertyDescriptor(L.Browser, "svg");
  Object.defineProperty(L.Browser, "svg", { configurable: true, value: true });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(501);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(geometry);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (svgDescriptor) Object.defineProperty(L.Browser, "svg", svgDescriptor);
});


describe("Rail placement converges with browser-rounded translated rectangles", () => {
  it("does not alternate CSS writes or publication for the measured KL Sentral geometry", async () => {
    const { popup, element } = await mounted();
    act(() => { observers(element).mutation.deliver(); observers(element).mutation.deliver(); });
    const writes = vi.spyOn(element.style, "setProperty"), event = vi.fn();
    popup.on("presentationlayout", event); const before = snapshotStyle(element);
    act(() => { for(let i=0;i<24;i++) observers(element).mutation.deliver(); });
    expect(element.dataset.railPlacement).toBe("below");
    expect(writes).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled();
    expect(snapshotStyle(element)).toBe(before);
    expect(element.style.getPropertyValue("--rail-popup-y")).toBe("155.3438px");
  });

  it("reconverges after a fractional native-pan geometry change without disabling required updates", async () => {
    const { popup, element } = await mounted(), event = vi.fn();
    popup.on("presentationlayout", event);
    nativeBase = { left: 258.20001220703125, top: 201.7362518310547, bottom: 331.0799865722656 };
    sourcePoint = { x: 432.20001220703125, y: 344.08001708984375 };
    const writes = vi.spyOn(element.style, "setProperty");
    act(() => { observers(element).resize.deliver(); observers(element).mutation.deliver(); });
    expect(writes).toHaveBeenCalled(); expect(event).toHaveBeenCalled();
    writes.mockClear(); event.mockClear(); const before = snapshotStyle(element);
    act(() => { for(let i=0;i<24;i++) observers(element).mutation.deliver(); });
    expect(writes).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled(); expect(snapshotStyle(element)).toBe(before);
    expect(element.dataset.railPresentationConflict).toBeUndefined();
  });

  it("retains cleanup and rejects late deliveries after a converged popup closes", async () => {
    const { view, popup, element } = await mounted(), old = observers(element), queued = deferred(popup), event = vi.fn();
    popup.on("presentationlayout", event); act(() => { popup.close(); });
    expect(old.resize.disconnected).toBe(true); expect(old.mutation.disconnected).toBe(true);
    const before = snapshotStyle(element); sourcePoint.y += 20;
    expect(() => act(() => { for(let i=0;i<12;i++){old.resize.deliver();old.mutation.deliver();}queued.forEach(callback=>callback()); })).not.toThrow();
    expect(snapshotStyle(element)).toBe(before); expect(event).not.toHaveBeenCalled();
    view.unmount(); expect(() => act(() => old.mutation.deliver())).not.toThrow();
  });

  it("does not publish if the owner retires during the post-write rendered-box read", async () => {
    const { popup, element } = await mounted(), old = observers(element), beforeY = element.style.getPropertyValue("--rail-popup-y");
    const getBox = element.getBoundingClientRect.bind(element); let retired = false;
    vi.spyOn(element,"getBoundingClientRect").mockImplementation(() => {
      const box=getBox();
      if(!retired && element.style.getPropertyValue("--rail-popup-y")!==beforeY){retired=true;popup.close();}
      return box;
    });
    const event=vi.fn();popup.on("presentationlayout",event);sourcePoint.y+=8;
    expect(()=>act(()=>old.resize.deliver())).not.toThrow();
    expect(retired).toBe(true);expect(event).not.toHaveBeenCalled();
    const after=snapshotStyle(element);act(()=>old.mutation.deliver());expect(snapshotStyle(element)).toBe(after);
  });
});
