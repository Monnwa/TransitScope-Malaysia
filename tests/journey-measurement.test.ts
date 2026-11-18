import L from "leaflet";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeJourneyMeasurement } from "./helpers/journey-measurement";

const maps: L.Map[] = [];
afterEach(() => { maps.forEach(map => map.remove()); maps.length = 0; document.body.replaceChildren(); vi.restoreAllMocks(); });

function fixture() {
  const element = document.createElement("div");
  document.body.append(element);
  const map = L.map(element).setView([0, 0], 10);
  maps.push(map);
  const popup = L.popup({ className: "journey-stop-popup-shell", autoPan: false })
    .setLatLng([0, 0]).setContent('<div class="journey-stop-popup">Journey</div>').openOn(map);
  let reads = 0;
  const verifyResult = vi.fn();
  return { map, popup, verifyResult, measurementReads: () => reads, drainFrames: vi.fn(),
    measure: () => { reads++; }, };
}

describe("current Journey measurement completion contract", () => {
  it("requires fresh deferred evidence even if the expected result already existed", async () => {
    const f = fixture(); f.measure();
    await expect(completeJourneyMeasurement({ ...f, trigger: () => {} })).rejects.toThrow("no fresh measurement witness");
    expect(f.verifyResult).not.toHaveBeenCalled();
  });
  it("accepts the same current popup after native measurement, independently of RAF", async () => {
    const f = fixture();
    await completeJourneyMeasurement({ ...f, trigger: () => queueMicrotask(f.measure) });
    expect(f.drainFrames).toHaveBeenCalledOnce();
    expect(f.verifyResult).toHaveBeenCalledTimes(2);
  });
  it("does not accept a witness produced only while draining RAF", async () => {
    const f = fixture();
    await expect(completeJourneyMeasurement({ ...f, trigger: () => {}, drainFrames: f.measure }))
      .rejects.toThrow("no fresh measurement witness");
    expect(f.verifyResult).not.toHaveBeenCalled();
  });
  it("rejects a closed popup before registering work", async () => {
    const f = fixture(); f.map.closePopup(f.popup);
    await expect(completeJourneyMeasurement({ ...f, trigger: f.measure })).rejects.toThrow("closed or replaced");
    expect(f.verifyResult).not.toHaveBeenCalled();
  });
  it("rejects a replacement even if later callbacks produce a witness", async () => {
    const f = fixture();
    await expect(completeJourneyMeasurement({ ...f, trigger: () => queueMicrotask(() => {
      L.popup({ className: "journey-stop-popup-shell", autoPan: false }).setLatLng([0, 0]).setContent("new").openOn(f.map);
      f.measure();
    }) })).rejects.toThrow(/closed|removed|lifecycle changed/);
    expect(f.verifyResult).not.toHaveBeenCalled();
  });
  it("rejects close and reopen of the same popup instance", async () => {
    const f = fixture();
    await expect(completeJourneyMeasurement({ ...f, trigger: () => queueMicrotask(() => {
      f.map.closePopup(f.popup); f.popup.openOn(f.map); f.measure();
    }) })).rejects.toThrow(/closed|removed|lifecycle changed/);
    expect(f.verifyResult).not.toHaveBeenCalled();
  });
  it("rejects detached popup DOM", async () => {
    const f = fixture();
    await expect(completeJourneyMeasurement({ ...f, trigger: () => queueMicrotask(() => {
      f.popup.getElement()?.remove(); f.measure();
    }) })).rejects.toThrow("detached");
    expect(f.verifyResult).not.toHaveBeenCalled();
  });
  it("preserves postcondition failures and removes its listeners on failure", async () => {
    const f = fixture();
    const open = vi.spyOn(f.map, "off"), removed = vi.spyOn(f.popup, "off");
    await expect(completeJourneyMeasurement({ ...f, trigger: () => queueMicrotask(f.measure),
      verifyResult: () => { throw new Error("wrong owner/result"); } })).rejects.toThrow("wrong owner/result");
    expect(open).toHaveBeenCalledWith("popupopen", expect.any(Function));
    expect(open).toHaveBeenCalledWith("popupclose", expect.any(Function));
    expect(removed).toHaveBeenCalledWith("remove", expect.any(Function));
  });
});
