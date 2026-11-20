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
  record: Pick<TransitRecord, "id" | "position">, request?: StationSearchRequest | null,
  contentSelector = ".rail-station-popup") {
  const camera = useOptionalBusCamera();
  const guard = camera?.guard, dispatch = camera?.dispatch;
  const latestRequest = useRef(request); latestRequest.current = request;
  const contentReady = useRef<() => void>(() => {});
  const id = record.id, latitude = record.position?.[0], longitude = record.position?.[1];
  useEffect(() => {
    const point = latitude !== undefined && longitude !== undefined ? [latitude, longitude] as [number, number] : null;
    if (!request || request.stationId !== id || !validPoint(point)) return;
    const anchorPoint = point;
    const intent = request;
    let retired = false, opened = false, fitted = false;
    let scrollStarted = false, frame = 0, previousLayout = "";
    let restoreAutoPan: (() => void) | undefined;
    const container = map.getContainer();
    const report = (reason: string) => {
      container.dataset.stationSearchError = reason;
      map.fire("stationsearcherror", { stationId: id, reason });
    };
    const run = (operation: () => void) => guard ? guard.run(operation) : operation();
    const focus = (popupHeight = 0) => {
      const box = container.getBoundingClientRect();
      const obstructions = Array.from(document.querySelectorAll("header,.map-search,.map-legend,.leaflet-control-zoom,.leaflet-control-attribution"))
        .filter(element => getComputedStyle(element).visibility !== "hidden").map(element => element.getBoundingClientRect());
      const safe = cameraArea(box, { width: innerWidth, height: innerHeight }, obstructions);
      if (!safe) { report("station-viewport-unavailable"); return false; }
      const size = map.getSize();
      if (intent.alert && intent.alert.targets.length > 1) {
        const bounds = L.latLngBounds(intent.alert.targets.map(target => L.latLng(target.position)));
        run(() => {
          map.stop();
          map.fitBounds(bounds, { animate: false, maxZoom: 17,
            paddingTopLeft: [safe.left + 14, safe.top + 14],
            paddingBottomRight: [size.x - safe.right + 14, size.y - safe.bottom + 14] });
        });
        return true;
      }
      // Match the existing stop camera's scale and account for the real portal content height.
      const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), intent.alert || map.getZoom() < 16 ? 17 : map.getZoom()));
      const anchor = cameraAnchor(safe, popupHeight);
      const center = map.unproject(map.project(anchorPoint, zoom).add(L.point(size.x / 2 - anchor.x, size.y / 2 - anchor.y)), zoom);
      run(() => { map.stop(); map.setView(center, zoom, { animate: false }); });
      return true;
    };

    function nextFrame() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; attempt(); });
    }

    function alertViewportReady() {
      const box = container.getBoundingClientRect();
      const header = container.closest("main")?.querySelector("header");
      const stickyBottom = header && getComputedStyle(header).position === "sticky" ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      const visibleHeight = Math.min(innerHeight, box.bottom) - Math.max(stickyBottom, box.top);
      const inView = box.width > 0 && box.height > 0 && visibleHeight >= Math.min(box.height, innerHeight - stickyBottom) * .9;
      if (!scrollStarted) {
        scrollStarted = true;
        if (!inView) container.closest(".map-camera-frame")?.scrollIntoView({ block: innerWidth <= 720 ? "start" : "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
      const layout = inView ? [box.top, box.left, box.width, box.height].join(":") : "";
      const stable = Boolean(layout) && layout === previousLayout;
      previousLayout = layout;
      if (!stable) { nextFrame(); return false; }
      const size = map.getSize();
      if (size.x !== container.clientWidth || size.y !== container.clientHeight) run(() => map.invalidateSize({ pan: false }));
      return true;
    }

    function attempt() {
      if (retired || opened || latestRequest.current !== request) return;
      const popup = popupRef.current;
      if (!popup) { report("popup-unavailable"); return; }
      const sources: (L.CircleMarker | L.Marker)[] = [];
      map.eachLayer(layer => {
        if ((layer instanceof L.CircleMarker || intent.type === "MICROMOBILITY_STATION" && layer instanceof L.Marker) &&
          layer.getPopup() === popup) sources.push(layer);
      });
      if (sources.length !== 1) { report("station-marker-unavailable"); return; }
      const source = sources[0], position = source.getLatLng();
      if (!validPoint([position.lat, position.lng]) || !position.equals(L.latLng(anchorPoint), 1e-9)) {
        report("station-marker-coordinate-mismatch"); return;
      }
      if (intent.alert && !alertViewportReady()) return;
      if (intent.alert && !restoreAutoPan) {
        const previousAutoPan = popup.options.autoPan;
        popup.options.autoPan = false;
        restoreAutoPan = () => { popup.options.autoPan = previousAutoPan; };
      }
      if (intent.type === "BUS_STOP" || intent.type === "MICROMOBILITY_STATION") dispatch?.({ type: "MANUAL" });
      if (!intent.alert) container.closest(".map-camera-frame")?.scrollIntoView({ block: innerWidth <= 720 ? "start" : "center", behavior: "instant" });
      run(() => {
        map.stop();
        if (!popup.isOpen()) map.closePopup();
      });
      if (!focus()) return;
      opened = true;
      contentReady.current = () => {
        if (retired || fitted || latestRequest.current !== request || !map.hasLayer(source) || source.getPopup() !== popup || !popup.isOpen()) return;
        const element = popup.getElement(), native = popup.getLatLng();
        if (!element?.isConnected || !element.querySelector(contentSelector) || !native ||
          !validPoint([native.lat, native.lng]) || !native.equals(L.latLng(anchorPoint), 1e-9) || !source.getLatLng().equals(native, 1e-9)) return;
        const height = element.getBoundingClientRect().height;
        if (!Number.isFinite(height) || height <= 0) return;
        fitted = true; // Retire before moving: the layout effect can synchronously re-enter.
        if (!intent.alert || intent.alert.targets.length === 1) focus(height);
        if (intent.alert || intent.nearby) {
          const focusTarget = element.querySelector<HTMLElement>(".leaflet-popup-close-button") ?? container;
          focusTarget.focus({ preventScroll: true });
          intent.alert?.onResult(true);
        }
      };
      run(() => {
        source.openPopup();
      });
      const native = popup.getLatLng();
      if (!native || !validPoint([native.lat, native.lng]) || !native.equals(position, 1e-9)) {
        source.closePopup(); report("station-popup-anchor-mismatch"); return;
      }
      delete container.dataset.stationSearchError;
      container.dataset.stationSearchId = id;
      container.dataset.stationSearchType = intent.type ?? "RAIL_STATION";
      if (intent.type === "MICROMOBILITY_STATION") container.dataset.stationSearchOperator = intent.operator;
      else delete container.dataset.stationSearchOperator;
      if (intent.alert || intent.nearby) contentReady.current();
    }
    const retry = () => queueMicrotask(() => { if (!retired) attempt(); });
    map.on("layeradd resize", retry);
    attempt();
    return () => {
      retired = true;
      cancelAnimationFrame(frame);
      restoreAutoPan?.();
      contentReady.current = () => {};
      map.off("layeradd resize", retry);
      if (intent.nearby && opened) {
        const popup = popupRef.current;
        if (latestRequest.current?.stationId !== id && popup?.isOpen()) popup.close();
      }
    };
  }, [map, popupRef, id, latitude, longitude, request, guard, dispatch, contentSelector]);
  return contentReady;
}
