"use client";

import L from "leaflet";
import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import { formatNearbyDistance, poorLocationAccuracy, type UserLocation } from "@/lib/nearby-transit";
import { useBusCamera } from "./bus-camera-context";
import DashboardIcon from "./dashboard-icon";
import type { useNearbyLocation } from "./nearby-public-transport";
import "@/app/locate-me.css";

export default function LocateMeControl({ location, state, requestLocation }: ReturnType<typeof useNearbyLocation>) {
  const map = useMap();
  const { dispatch, intentRevision } = useBusCamera();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [activated, setActivated] = useState(false);
  const usedControl = useRef(false);

  useLayoutEffect(() => {
    const container = L.DomUtil.create("div", "map-locate leaflet-control");
    const control = new L.Control({ position: "topright" });
    control.onAdd = () => container;
    L.DomEvent.disableClickPropagation(container);
    control.addTo(map);
    setHost(container);
    return () => { control.remove(); L.DomEvent.off(container); };
  }, [map]);

  const loading = state.status === "loading";
  function locate() {
    if (loading) return;
    const refresh = usedControl.current;
    usedControl.current = true;
    setActivated(true);
    const focus = (fix: UserLocation) => dispatch({ type: "USER_LOCATION", point: fix.position });
    if (location) focus(location);
    if (!location || refresh) {
      const revision = intentRevision.revision;
      requestLocation(fix => {
        if (intentRevision.revision === revision) focus(fix);
      });
    }
  }

  const message = !activated ? ""
    : loading ? (location ? "Refreshing your location…" : "Finding your location…")
    : state.status === "error" ? state.message + (location ? " Showing your last known location." : "")
    : location && poorLocationAccuracy(location.accuracyM)
      ? `Location accuracy is low (about ${formatNearbyDistance(location.accuracyM)}).`
      : "";

  return host && createPortal(<>
    <div className="map-locate-status" role="status">{message}</div>
    <button type="button" className="map-locate-button" aria-label="Locate me" title="Locate Me"
      aria-disabled={loading} onClick={event => {
        // The spinner replaces the clicked icon before Leaflet can inspect its parent controls.
        event.stopPropagation();
        locate();
      }}>
      {loading ? <span aria-hidden="true" className="map-locate-spinner"/> : <DashboardIcon name="locate"/>}
    </button>
  </>, host);
}
