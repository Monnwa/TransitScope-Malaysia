import L from "leaflet";
import { act } from "@testing-library/react";

/**
 * Test-only contract for this fixture's one synchronous measure() microtask.
 * Keep selectedRecordId/journeyVehicleId fixed during the operation.
 * Private coordinator revisions are not exposed: an unchanged public popup
 * lifecycle plus a fresh post-trigger measurement witness identifies this lease.
 */
export async function completeJourneyMeasurement({
  map, popup, trigger, drainFrames, measurementReads, verifyResult, timeoutMs = 1000,
}: {
  map: L.Map;
  popup: L.Popup;
  trigger: () => void;
  drainFrames: () => void;
  measurementReads: () => number;
  verifyResult: () => void;
  timeoutMs?: number;
}): Promise<void> {
  const element = popup.getElement(), control = map.zoomControl;
  const owner = "journey-stop-" + L.Util.stamp(popup);
  let invalidated: string | undefined;
  const fail = (reason: string): never => { throw new Error(`Journey measurement ${owner}: ${reason}`); };
  const current = () => {
    if (invalidated) fail(invalidated);
    if (!popup.options.className?.split(" ").includes("journey-stop-popup-shell")) fail("not a Journey owner");
    if (!map.hasLayer(popup) || !popup.isOpen()) fail("popup closed or replaced");
    if (!element?.isConnected || popup.getElement() !== element) fail("popup detached or DOM replaced");
    if (map.zoomControl !== control) fail("Zoom Control instance replaced");
    let otherPopup = false;
    map.eachLayer(layer => { if (layer instanceof L.Popup && layer !== popup && layer.isOpen()) otherPopup = true; });
    if (otherPopup) fail("another popup is open");
  };
  const opened = () => { invalidated = "popup lifecycle changed during measurement"; };
  const closed = (event: L.PopupEvent) => { if (event.popup === popup) invalidated = "popup closed during measurement"; };
  const removed = () => { invalidated = "popup removed during measurement"; };
  const unloaded = () => { invalidated = "map unloaded during measurement"; };
  current();
  map.on("popupopen", opened).on("popupclose", closed).on("unload", unloaded);
  popup.on("remove", removed);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Journey measurement ${owner}: no completion within ${timeoutMs}ms`)), timeoutMs);
    });
    const operation = act(async () => {
      current();
      trigger();
      drainFrames();
      current();
      const beforeMicrotask = measurementReads();
      // enqueue() registers one native microtask synchronously in trigger().
      // measure() is synchronous within it. This FIFO sentinel is queued after
      // that callback; RAF delivery above is deliberately a separate boundary.
      await new Promise<void>(resolve => queueMicrotask(resolve));
      current();
      if (measurementReads() <= beforeMicrotask) fail("no fresh measurement witness after this trigger");
      verifyResult();
    });
    await Promise.race([operation, expired]);
    current();
    verifyResult();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    map.off("popupopen", opened).off("popupclose", closed).off("unload", unloaded);
    popup.off("remove", removed);
  }
}
