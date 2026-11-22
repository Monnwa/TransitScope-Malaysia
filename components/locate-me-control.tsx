"use client";

import React, { useState } from "react";
import { formatNearbyDistance, poorLocationAccuracy, type UserLocation } from "@/lib/nearby-transit";
import { useBusCamera } from "./bus-camera-context";
import DashboardIcon from "./dashboard-icon";
import type { useNearbyLocation } from "./nearby-public-transport";
import "@/app/locate-me.css";

export default function LocateMeControl({ location, state, requestLocation }: ReturnType<typeof useNearbyLocation>) {
  const { dispatch, intentRevision } = useBusCamera();
  const [activated, setActivated] = useState(false);

  const loading = state.status === "loading";
  function locate() {
    if (loading) return;
    setActivated(true);
    const focus = (fix: UserLocation) => dispatch({ type: "USER_LOCATION", point: fix.position });
    if (location) focus(location);
    if (!location || activated) {
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

  return <div className="map-locate leaflet-control">
    <div className="map-locate-status" role="status">{message}</div>
    <button type="button" className="map-locate-button" aria-label="Locate me" title="Locate Me"
      aria-disabled={loading} onClick={event => {
        // The spinner replaces the clicked icon before Leaflet can inspect its parent controls.
        event.stopPropagation();
        locate();
      }}>
      {loading ? <span aria-hidden="true" className="map-locate-spinner"/> : <DashboardIcon name="locate"/>}
    </button>
  </div>;
}
