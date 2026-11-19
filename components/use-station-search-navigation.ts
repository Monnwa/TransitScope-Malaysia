"use client";

import L from "leaflet";
import { useEffect, useRef, type RefObject } from "react";
import { cameraAnchor, cameraArea } from "@/lib/map-camera";
import { validPoint } from "@/lib/route-projection";
import type { StationSearchRequest } from "@/lib/station-search";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { useOptionalBusCamera } from "./bus-camera-context";

/** Reuse the bound native popup. Layer events retry late markers; cleanup retires old requests. */
export default function useStationSearchNavigation(map: L.Map, popupRef: RefObject<L.Popup | null>,
  record: TransitRecord, request?: StationSearchRequest | null) {
  const camera = useOptionalBusCamera();
  const guard = camera?.guard;
  const latestRequest = useRef(request); latestRequest.current = request;
  const contentReady = useRef<() => void>(() => {});
  useEffect(() => {
    if (!request || request.stationId !== record.id || !validPoint(record.position)) return;
    let retired = false, opened = false, fitted = false;
    const point = record.position!;
    const container = map.getContainer();
    const report = (reason: string) => {
      container.dataset.stationSearchError = reason;
      map.fire("stationsearcherror", { stationId: record.id, reason });
    };
    const run = (operation: () => void) => guard ? guard.run(operation) : operation();
    const focus = (popupHeight = 0) => {
      const box = container.getBoundingClientRect();
      const obstructions = Array.from(document.querySelectorAll("header,.map-search,.map-legend,.leaflet-control-zoom,.leaflet-control-attribution"))
        .filter(element => getComputedStyle(element).visibility !== "hidden").map(element => element.getBoundingClientRect());
      const safe = cameraArea(box, { width: innerWidth, height: innerHeight }, obstructions);
      if (!safe) { report("station-viewport-unavailable"); return false; }
      // Match the existing stop camera's scale and account for the real portal content height.
      const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() >= 16 ? map.getZoom() : 17));
      const anchor = cameraAnchor(safe, popupHeight), size = map.getSize();
      const center = map.unproject(map.project(point, zoom).add(L.point(size.x / 2 - anchor.x, size.y / 2 - anchor.y)), zoom);
      run(() => { map.stop(); map.setView(center, zoom, { animate: false }); });
      return true;
    };
    function attempt() {
      if (retired || opened || latestRequest.current !== request) return;
      const popup = popupRef.current;
      if (!popup) { report("popup-unavailable"); return; }
      const sources: L.CircleMarker[] = [];
      map.eachLayer(layer => {
        if (layer instanceof L.CircleMarker && layer.getPopup() === popup) sources.push(layer);
      });
      if (sources.length !== 1) { report("station-marker-unavailable"); return; }
      const source = sources[0], position = source.getLatLng();
      if (!validPoint([position.lat, position.lng]) || !position.equals(L.latLng(point), 1e-9)) {
        report("station-marker-coordinate-mismatch"); return;
      }
      container.closest(".map-camera-frame")?.scrollIntoView({ block: innerWidth <= 720 ? "start" : "center", behavior: "instant" });
      run(() => {
        map.stop();
        map.closePopup();
      });
      if (!focus()) return;
      opened = true;
      contentReady.current = () => {
        if (retired || fitted || latestRequest.current !== request || !map.hasLayer(source) || source.getPopup() !== popup || !popup.isOpen()) return;
        const element = popup.getElement(), native = popup.getLatLng();
        if (!element?.isConnected || !element.querySelector(".rail-station-popup") || !native ||
          !validPoint([native.lat, native.lng]) || !native.equals(L.latLng(point), 1e-9) || !source.getLatLng().equals(native, 1e-9)) return;
        const height = element.getBoundingClientRect().height;
        if (!Number.isFinite(height) || height <= 0) return;
        fitted = true; // Retire before moving: the layout effect can synchronously re-enter.
        focus(height);
      };
      run(() => {
        source.openPopup();
      });
      const native = popup.getLatLng();
      if (!native || !validPoint([native.lat, native.lng]) || !native.equals(position, 1e-9)) {
        source.closePopup(); report("station-popup-anchor-mismatch"); return;
      }
      delete container.dataset.stationSearchError;
      container.dataset.stationSearchId = record.id;
    }
    const retry = () => queueMicrotask(() => { if (!retired) attempt(); });
    map.on("layeradd resize", retry);
    attempt();
    return () => { retired = true; contentReady.current = () => {}; map.off("layeradd resize", retry); };
  }, [map, popupRef, record.id, record.position, request, guard]);
  return contentReady;
}
