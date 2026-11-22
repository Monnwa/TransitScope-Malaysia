"use client";

import L from "leaflet";
import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import { busRouteViewport } from "@/lib/bus-map-routes";
import { cameraAnchor, cameraArea, followDecision, leafletNavigationKey, withinCameraArea } from "@/lib/map-camera";
import { validPoint, type GeoPoint } from "@/lib/route-projection";
import { visibleMapArea } from "@/lib/journey-stop-selection";
import type { Record as TransitRecord } from "@/lib/transit-data";
import type { RailLine } from "@/lib/rail-model";
import type { SimulatedBusJourney } from "@/lib/simulation/vehicles";
import type { JourneyNavigation } from "./simulated-bus-panel";
import { useBusCamera } from "./bus-camera-context";
import type { Region } from "@/lib/dashboard-region";
import { micromobilityBounds } from "@/lib/micromobility";

type Props = { selected?: TransitRecord; vehicleVisible: boolean; selectedRouteId: string; enabled: boolean;
  region?: Region; staticBusBounds?: L.LatLngBounds | null; searchActive?: boolean;
  resetSignal: number; journey: SimulatedBusJourney | null; navigation: JourneyNavigation | null;
  controlsHost: HTMLElement | null; onLocate: () => void; focusedRailRoute?: { line: RailLine } | null };

/** Sole bus camera executor. Route, focus, stop, popup and layout commands share
 * one guard. Immediate moves avoid overlapping animations and respect reduced motion. */
export default function BusMapCamera(props: Props) {
  const map = useMap();
  const { state, dispatch, guard, intentRevision } = useBusCamera();
  const latest = useRef({ props, state });
  latest.current = { props, state };
  const lastMove = useRef<{ point: GeoPoint | null; at: number }>({ point: null, at: -Infinity });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequest = useRef(0);
  const lastNavigation = useRef<JourneyNavigation | null>(null);
  const lastReset = useRef(props.resetSignal);
  const moves = useRef(0);
  const popupFrame = useRef(0);
  const popupIntent = useRef<{ popup: L.Popup; revision: number; selectionId: string | undefined } | null>(null);
  const cancelPopup = useCallback(() => {
    cancelAnimationFrame(popupFrame.current); popupFrame.current = 0; popupIntent.current = null;
  }, []);
  const currentPopup = useCallback(() => {
    const pending = popupIntent.current;
    return pending && pending.revision === intentRevision.revision && pending.selectionId === latest.current.props.selected?.id &&
      pending.popup.isOpen() && pending.popup.getElement()?.isConnected ? pending.popup : null;
  }, [intentRevision]);
  const stableView = useRef({ center: map.getCenter(), zoom: map.getZoom() });

  const position = useCallback((): GeoPoint | null => {
    const { props: current, state: camera } = latest.current;
    return current.vehicleVisible && current.selected?.id === camera.vehicleId && validPoint(current.selected.position ?? null)
      ? current.selected.position! : null;
  }, []);
  const cancelFollow = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const publish = useCallback(() => {
    const container = map.getContainer(), center = map.getCenter();
    container.dataset.cameraState = latest.current.state.mode;
    container.dataset.cameraVehicle = latest.current.state.vehicleId ?? "";
    container.dataset.cameraIntent = latest.current.state.mode === "FREE_EXPLORE" ? "manual" : latest.current.state.viewIntent;
    container.dataset.cameraLatitude = String(center.lat);
    container.dataset.cameraLongitude = String(center.lng);
    container.dataset.cameraZoom = String(map.getZoom());
    container.dataset.cameraMoves = String(moves.current);
  }, [map]);
  const recordView = useCallback(() => {
    stableView.current = { center: map.getCenter(), zoom: map.getZoom() };
    publish();
  }, [map, publish]);
  const retireStationPopups = useCallback((keepId?: string) => {
    const expectedOwner = keepId ? "rail-popup-owner-" + encodeURIComponent(keepId) : undefined;
    guard.run(() => map.eachLayer(layer => {
      if (!(layer instanceof L.Popup)) return;
      const owner = layer.options.className?.split(" ").find(name => name.startsWith("rail-popup-owner-"));
      if (owner && owner !== expectedOwner) map.closePopup(layer);
    }));
  }, [map, guard]);
  const area = useCallback(() => {
    const box = map.getContainer().getBoundingClientRect();
    const obstructions = Array.from(document.querySelectorAll(
      "header,.bus-journey,.detail,.map-camera-bar,.map-search,.leaflet-control-zoom,.leaflet-control-attribution",
    )).filter(element => getComputedStyle(element).visibility !== "hidden").map(element => element.getBoundingClientRect());
    const viewport = { width: innerWidth, height: innerHeight };
    const safe = cameraArea(box, viewport, obstructions);
    if (safe) return safe;
    // A compact mobile map can fit the 36px bus without the usual 16px inset.
    const compact = visibleMapArea(box, viewport, obstructions);
    return compact.right - compact.left >= 40 && compact.bottom - compact.top >= 40
      ? { left: compact.left - box.left, right: compact.right - box.left,
          top: compact.top - box.top, bottom: compact.bottom - box.top } : null;
  }, [map]);
  const scrollToMap = useCallback(() => {
    const frame = map.getContainer().closest(".map-camera-frame");
    frame?.scrollIntoView({ block: innerWidth <= 720 ? "start" : "center", behavior: "instant" });
  }, [map]);
  const centerPoint = useCallback((point: GeoPoint, zoom: number, popupRoom = false) => {
    if (!validPoint(point)) return false;
    const safe = area();
    if (!safe) return false;
    const popup = popupRoom ? map.getContainer().querySelector(".bus-vehicle-popup")?.closest(".leaflet-popup") : null;
    const anchor = cameraAnchor(safe, popup?.getBoundingClientRect().height ?? 0), size = map.getSize();
    const center = map.unproject(map.project(point, zoom).add(L.point(size.x / 2 - anchor.x, size.y / 2 - anchor.y)), zoom);
    if (map.getZoom() === zoom && map.getCenter().equals(center, 1e-8)) return false;
    guard.run(() => { map.stop(); map.setView(center, zoom, { animate: false }); });
    moves.current++;
    publish();
    return true;
  }, [map, area, guard, publish]);
  const overview = useCallback(() => {
    const current = latest.current.props, safe = area();
    const switchingFromPenang = current.region === "Klang Valley" && map.getCenter().lat > 4;
    if (!safe && current.region !== "Penang" && !switchingFromPenang) return;
    const size = map.getSize();
    guard.run(() => {
      map.stop();
      // A station popup must not autopan back to its old anchor during an explicit overview zoom.
      retireStationPopups();
      const fitOptions = {
        paddingTopLeft: safe ? L.point(safe.left, safe.top) : L.point(18, 55),
        paddingBottomRight: safe ? L.point(size.x - safe.right, size.y - safe.bottom) : L.point(18, 18),
        maxZoom: 14, animate: false,
      };
      if (current.region === "Penang") {
        const [southwest, northeast] = micromobilityBounds.Penang;
        map.fitBounds(current.selectedRouteId && current.staticBusBounds?.isValid()
          ? current.staticBusBounds : L.latLngBounds([L.latLng(...southwest), L.latLng(...northeast)]), fitOptions);
      } else if (current.enabled) map.fitBounds(busRouteViewport(current.selectedRouteId), fitOptions);
      else if (current.resetSignal || switchingFromPenang) map.setView([3.142, 101.699], 13, { animate: false });
    });
    publish();
  }, [map, area, guard, publish, retireStationPopups]);
  const follow = useCallback(function followLatest() {
    cancelFollow();
    if (latest.current.state.mode !== "VEHICLE_FOCUS") return;
    // Selection props can commit before the provider consumes SELECT. Wait for
    // that input rather than issuing an unrelated unavailable intent for the old ID.
    if (latest.current.props.selected && latest.current.props.selected.id !== latest.current.state.vehicleId) return;
    const point = position(), safe = area();
    if (!point) { dispatch({ type: "UNAVAILABLE" }); return; }
    if (!safe) return;
    const pixel = map.latLngToContainerPoint(point);
    const decision = followDecision(lastMove.current.point, point, withinCameraArea(pixel, safe, 24), performance.now() - lastMove.current.at);
    if (decision.wait) {
      const revision = intentRevision.revision;
      timer.current = setTimeout(() => { if (revision === intentRevision.revision) followLatest(); else cancelFollow(); }, decision.wait);
      return;
    }
    if (decision.move && centerPoint(point, map.getZoom(), true)) lastMove.current = { point, at: performance.now() };
  }, [map, cancelFollow, position, area, dispatch, centerPoint, intentRevision]);

  // Selection is observed by the provider; only explicit route/reset intent frames routes.
  useLayoutEffect(() => {
    if (lastReset.current !== props.resetSignal) { lastReset.current = props.resetSignal; scrollToMap(); }
    dispatch({ type: "ROUTE" });
  }, [dispatch, props.selectedRouteId, props.enabled, props.resetSignal, props.region, scrollToMap]);
  useEffect(() => {
    if (props.focusedRailRoute) dispatch({ type: "RAIL_ROUTE", points: props.focusedRailRoute.line.paths.flat() });
  }, [dispatch, props.focusedRailRoute]);
  useEffect(() => {
    if (!props.navigation) { lastNavigation.current = null; return; }
    if (props.navigation === lastNavigation.current) return;
    lastNavigation.current = props.navigation;
    if (!props.journey || props.navigation.journeyId !== props.journey.journeyId) return;
    if (props.navigation.sequence !== undefined) {
      const stop = props.journey.stops.find(item => item.sequence === props.navigation?.sequence);
      if (stop) dispatch({ type: "STOP", point: stop.position, id: stop.id, sequence: stop.sequence });
    } else dispatch({ type: latest.current.state.mode === "FREE_EXPLORE" ? "RETURN" : "FOCUS", available: !!position() });
  }, [dispatch, position, props.navigation, props.journey]);
  useLayoutEffect(() => {
    if (state.command.kind !== "user-location") return;
    // Keep open popups and their selections while giving the location command the viewport.
    const paused = new Set<L.Popup>();
    map.eachLayer(layer => {
      if (layer instanceof L.Popup && layer.options.autoPan) {
        layer.options.autoPan = false;
        paused.add(layer);
      }
    });
    const restore = ({ popup }: L.PopupEvent) => {
      if (paused.delete(popup)) popup.options.autoPan = true;
    };
    map.on("popupclose", restore);
    return () => {
      map.off("popupclose", restore);
      paused.forEach(popup => { popup.options.autoPan = true; });
    };
  }, [map, state.command]);
  useEffect(() => {
    if (state.request === lastRequest.current) return;
    lastRequest.current = state.request;
    cancelFollow();
    if (state.command.kind === "user-location") {
      cancelPopup();
      const { point } = state.command;
      guard.run(() => {
        map.stop();
        map.setView(point, Math.max(16, map.getZoom()), { animate: false });
      });
      recordView();
      return;
    }
    if (state.command.kind === "overview") {
      if (state.mode === "OVERVIEW" && state.viewIntent === "bus") overview();
      return;
    }
    scrollToMap();
    if (state.command.kind === "rail-route") {
      const { points } = state.command;
      guard.run(() => {
        map.stop();
        retireStationPopups();
        map.fitBounds(points, { padding: [25, 52], animate: false, maxZoom: 14 });
      });
      recordView();
    } else if (state.command.kind === "stop") {
      const command = state.command, zoom = map.getZoom() >= 16 && map.getZoom() <= 18 ? Math.round(map.getZoom()) : 17;
      centerPoint(command.point, zoom);
      Object.assign(map.getContainer().dataset, { focusedStopId: command.id, focusedSequence: String(command.sequence),
        focusedLatitude: String(command.point[0]), focusedLongitude: String(command.point[1]), focusedZoom: String(zoom) });
    } else if (state.mode === "VEHICLE_FOCUS") {
      const point = position();
      if (!point) { dispatch({ type: "UNAVAILABLE" }); return; }
      const zoom = map.getZoom() >= 16 && map.getZoom() <= 18 ? map.getZoom() : 16;
      centerPoint(point, zoom, true);
      lastMove.current = { point, at: performance.now() };
      Object.assign(map.getContainer().dataset, { focusedStopId: "", focusedSequence: "",
        focusedLatitude: String(point[0]), focusedLongitude: String(point[1]), focusedZoom: String(zoom) });
    }
  }, [state.request, state.command, state.mode, state.viewIntent, map, cancelFollow, overview, scrollToMap, position, centerPoint, dispatch,
    guard, retireStationPopups, recordView, cancelPopup]);
  useEffect(() => {
    follow();
    return cancelFollow;
  }, [follow, cancelFollow, state.mode, state.vehicleId, props.selected?.id, props.selected?.position?.[0], props.selected?.position?.[1], props.vehicleVisible]);

  useEffect(() => {
    const selected = props.selected;
    retireStationPopups(selected?.id);
    if (!selected) return;
    if (selected.mode === "Bus" && selected.recordKind === "vehicle") scrollToMap();
    else if (selected.mode !== "Shared bike" && validPoint(selected.position) && !map.getBounds().contains(selected.position!)) {
      guard.run(() => map.panTo(selected.position!, { animate: false }));
    }
  }, [props.selected?.id, state.vehicleId, map, guard, scrollToMap, retireStationPopups]);
  useEffect(() => { publish(); }, [state, publish]);

  useEffect(() => {
    const container = map.getContainer();
    let pointerIntent = false;
    const manual = () => { cancelFollow(); cancelPopup(); dispatch({ type: "MANUAL" }); guard.run(() => map.stop()); };
    const excluded = (target: EventTarget | null) => target instanceof Element && !!target.closest(".leaflet-popup,.leaflet-marker-icon,.leaflet-control-attribution,.map-search-host");
    const down = (event: PointerEvent) => { pointerIntent = !excluded(event.target); };
    const up = () => { pointerIntent = false; };
    const popupOrForm = (target: EventTarget | null) => target instanceof Element && !!target.closest(".leaflet-popup,.map-search-host,input,select,textarea");
    const wheel = (event: WheelEvent) => { if (event.deltaY && !popupOrForm(event.target) && map.scrollWheelZoom.enabled()) manual(); };
    const click = (event: MouseEvent) => { if (event.target instanceof Element && event.target.closest(".leaflet-control-zoom a")) manual(); };
    const doubleClick = (event: MouseEvent) => { if (!excluded(event.target)) manual(); };
    const key = (event: KeyboardEvent) => {
      if (!map.keyboard.enabled() || !leafletNavigationKey(event)) return;
      // The search overlay handles autocomplete keys before they reach Leaflet's document listener.
      if (event.target instanceof Element && event.target.closest(".map-search-host")) return;
      const interactive = event.target instanceof Element && event.target.closest(
        '.leaflet-popup,input,select,textarea,button,a,summary,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="button"],[role="menuitem"]',
      );
      // Leaflet listens on document while the map has focus. Preserve native
      // editing/control behavior without leaking its keys into that listener.
      if (interactive) { event.stopPropagation(); return; }
      manual();
    };
    const touch = (event: TouchEvent) => { if (event.touches.length >= 2 && !popupOrForm(event.target)) manual(); };
    const zoom = () => { if (pointerIntent && !guard.active) manual(); };
    container.addEventListener("pointerdown", down, true);
    container.addEventListener("wheel", wheel, { capture: true, passive: true });
    container.addEventListener("click", click, true);
    container.addEventListener("dblclick", doubleClick, true);
    container.addEventListener("keydown", key, true);
    container.addEventListener("touchstart", touch, { capture: true, passive: true });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    map.on("dragstart", manual).on("zoomstart", zoom).on("moveend zoomend", recordView);
    return () => {
      container.removeEventListener("pointerdown", down, true);
      container.removeEventListener("wheel", wheel, true);
      container.removeEventListener("click", click, true);
      container.removeEventListener("dblclick", doubleClick, true);
      container.removeEventListener("keydown", key, true);
      container.removeEventListener("touchstart", touch, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      map.off("dragstart", manual).off("zoomstart", zoom).off("moveend zoomend", recordView);
    };
  }, [map, guard, dispatch, cancelFollow, cancelPopup, recordView]);

  useEffect(() => {
    let frame = 0, previous = "";
    const layout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = map.getContainer().getBoundingClientRect(), sheet = document.querySelector(".bus-journey")?.getBoundingClientRect();
        const popupOpen = !!map.getContainer().querySelector(".leaflet-popup");
        const signature = [box.x, box.y, box.width, box.height, sheet?.top, sheet?.height, innerWidth, innerHeight, popupOpen].join(":");
        if (signature === previous) return;
        previous = signature;
        const { center, zoom } = stableView.current, mode = latest.current.state.mode;
        guard.run(() => { map.invalidateSize({ pan: false }); if (mode === "FREE_EXPLORE" || latest.current.state.viewIntent === "selection") {
          const restore: L.ZoomPanOptions & { reset: boolean } = { animate: false, reset: true };
          map.setView(center, zoom, restore);
        } });
        if (mode === "OVERVIEW" && latest.current.state.viewIntent === "bus") {
          const point = position();
          if (point && currentPopup()) centerPoint(point, map.getZoom(), true);
          else if (!latest.current.props.searchActive) overview();
        }
        else if (mode === "VEHICLE_FOCUS") {
          const point = position(), safe = area();
          if (point && safe && !withinCameraArea(map.latLngToContainerPoint(point), safe, 24)) centerPoint(point, map.getZoom(), true);
        }
        publish();
      });
    };
    const observer = new ResizeObserver(layout);
    const popupObserver = new MutationObserver(() => {
      if (latest.current.state.mode === "VEHICLE_FOCUS") layout();
    }), popupPane = map.getPane("popupPane");
    if (popupPane) popupObserver.observe(popupPane, { childList: true });
    [map.getContainer(), props.controlsHost, ...Array.from(document.querySelectorAll(".bus-journey,header"))].forEach(element => { if (element) observer.observe(element); });
    window.addEventListener("resize", layout);
    window.addEventListener("scroll", layout, { passive: true });
    layout();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); popupObserver.disconnect(); window.removeEventListener("resize", layout); window.removeEventListener("scroll", layout); };
  }, [map, props.controlsHost, state.vehicleId, guard, overview, position, area, centerPoint, currentPopup, publish]);

  const queuePopup = useCallback((popup: L.Popup) => {
    const content = popup.getElement()?.querySelector<HTMLElement>(".bus-vehicle-popup");
    // React-Leaflet may mount portal content after popupopen. The Popup option
    // already identifies its owner, so scheduling does not race that render.
    const owner = popup.options.className?.split(" ").find(name => name.startsWith("bus-popup-owner-"));
    if (!content && !owner) return;
    cancelPopup();
    const selectionId = owner ? decodeURIComponent(owner.slice("bus-popup-owner-".length)) : content?.dataset.vehicleId ?? latest.current.props.selected?.id;
    const pending = { popup, revision: intentRevision.revision, selectionId };
    popupIntent.current = pending;
    popupFrame.current = requestAnimationFrame(() => {
      // Cancellation may arrive after a frame was dequeued. Check this specific
      // operation, its selection/revision, and the still-open popup before moving.
      if (popupIntent.current !== pending) return;
      popupFrame.current = 0;
      const active = currentPopup();
      if (!active?.getElement()?.querySelector(".bus-vehicle-popup")) return;
      const point = position(), safe = area();
      if (!point || !safe) return;
      const box = active.getElement()!.getBoundingClientRect(), mapBox = map.getContainer().getBoundingClientRect();
      if (!withinCameraArea(map.latLngToContainerPoint(point), safe) || box.top < mapBox.top + safe.top || box.bottom > mapBox.top + safe.bottom) centerPoint(point, map.getZoom(), true);
    });
  }, [cancelPopup, intentRevision, currentPopup, position, area, map, centerPoint]);
  useLayoutEffect(() => {
    const pending = popupIntent.current, action = intentRevision.action;
    // A marker click opens its popup before React commits that same vehicle's
    // selection. Reissue only that matching selection's one-shot positioning;
    // manual, route and explicit camera commands can never adopt old popup work.
    if (pending && !currentPopup() && action?.type === "SELECT" && action.recordId === pending.selectionId &&
      state.selectionId === pending.selectionId && props.selected?.id === pending.selectionId && pending.popup.isOpen()) queuePopup(pending.popup);
  }, [state.selectionId, props.selected?.id, currentPopup, queuePopup, intentRevision]);
  useEffect(() => {
    const popupOpen = (event: L.PopupEvent) => {
      cancelPopup();
      if (event.popup.getElement()?.querySelector(".journey-stop-popup")) { cancelFollow(); dispatch({ type: "MANUAL" }); return; }
      queuePopup(event.popup);
    };
    map.on("popupopen", popupOpen).on("popupclose", cancelPopup);
    return () => { cancelPopup(); map.off("popupopen", popupOpen).off("popupclose", cancelPopup); };
  }, [map, cancelFollow, cancelPopup, dispatch, queuePopup]);

  const available = !!position();
  const status = state.vehicleId && !available ? "Selected bus unavailable — view kept" : state.mode === "VEHICLE_FOCUS"
    ? "Vehicle focus · following " + (props.selected?.name ?? "selected bus") : state.mode === "FREE_EXPLORE"
      ? "Free exploration" + (state.vehicleId ? " · following paused" : "") : state.viewIntent === "selection" ? "Selected station view" : "Overview · simulated T401 / T402";
  return props.controlsHost ? createPortal(<div className="map-camera-controls" role="group" aria-label="Map camera">
    <p className="map-camera-status" role="status">{status}</p>
    <button type="button" onClick={() => dispatch({ type: "OVERVIEW" })}>Overview</button>
    {state.vehicleId && <button type="button" className={state.mode === "FREE_EXPLORE" ? "camera-return" : ""}
      disabled={state.mode === "VEHICLE_FOCUS" && available} onClick={props.onLocate}>
      {state.mode === "FREE_EXPLORE" ? "Return to Vehicle" : state.mode === "VEHICLE_FOCUS" ? "Following vehicle" : "Locate bus"}
    </button>}
  </div>, props.controlsHost) : null;
}
