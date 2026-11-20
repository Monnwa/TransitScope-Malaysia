"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { brtSunway } from "@/lib/expanded-services";
import {
  formatNearbyDistance, formatRecommendationDistance, NEARBY_INITIAL_COUNT, NEARBY_RADIUS_M,
  poorLocationAccuracy, rankNearbyTransit, type NearbyCandidate, type UserLocation,
} from "@/lib/nearby-transit";
import { validPoint, type GeoPoint } from "@/lib/route-projection";
import "@/app/nearby-transit.css";

type LocationState =
  | { status: "idle" | "loading" | "ready" }
  | { status: "error"; message: string; retry: boolean };

const unavailable = "Your location is unavailable. Try moving outdoors or near a window, then retry.";

export function useNearbyLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [state, setState] = useState<LocationState>({ status: "idle" });
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);

  function requestLocation() {
    const request = ++revision.current;
    const fail = (message: string, retry = true) => {
      if (request === revision.current) setState({ status: "error", message, retry });
    };
    if (!window.isSecureContext) {
      fail("Location requires a secure connection (HTTPS).", false);
      return;
    }
    if (!navigator.geolocation) {
      fail("This browser does not support location access.", false);
      return;
    }
    setState({ status: "loading" });
    try {
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        if (request !== revision.current) return;
        const position: GeoPoint = [coords.latitude, coords.longitude];
        if (!validPoint(position) || !Number.isFinite(coords.accuracy) || coords.accuracy < 0) {
          fail(unavailable);
          return;
        }
        setLocation({ position, accuracyM: coords.accuracy });
        setState({ status: "ready" });
      }, error => {
        if (error.code === 1) fail("Location access was denied. Allow location in your browser’s site settings, then retry.");
        else if (error.code === 3) fail("Finding your location took too long. Retry Location to try again.");
        else fail(unavailable);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
    } catch {
      fail(unavailable);
    }
  }
  return { location, state, requestLocation };
}

export default function NearbyPublicTransport({ candidates, location, state, requestLocation, busCoverage, routeColours,
  radiusM = NEARBY_RADIUS_M, selectedId, onSelect, onClear }: ReturnType<typeof useNearbyLocation> & {
  candidates: readonly NearbyCandidate[];
  busCoverage: "loading" | "partial" | "ready";
  routeColours: ReadonlyMap<string, string>;
  radiusM?: number;
  selectedId?: string;
  onSelect: (candidate: NearbyCandidate) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const recommendations = useMemo(() => location ? rankNearbyTransit(candidates, location.position, radiusM) : [],
    [candidates, location, radiusM]);
  const status = state.status === "idle" ? "Enable location to find nearby stations and bus stops."
    : state.status === "loading" ? (location ? "Refreshing location… Showing results for your last location." : "Finding your location…")
    : state.status === "error" ? state.message + (location ? " Showing results for your last location." : "")
    : "Location available. Distances are straight-line estimates.";
  const action = state.status === "idle" ? "Enable Location" : state.status === "error" ? "Retry Location" : "Refresh Location";
  const count = recommendations.length;
  const radius = formatNearbyDistance(radiusM);

  return <section id="nearby-transit" className="panel nearby-transit" aria-labelledby="nearby-transit-heading" tabIndex={-1}>
    <div className="nearby-heading">
      <div><h2 id="nearby-transit-heading">Nearby Public Transport</h2><p role="status">{status}</p></div>
      {state.status !== "loading" && (state.status !== "error" || state.retry) &&
        <button type="button" className="secondary nearby-location-action" onClick={() => {
          setExpanded(false);
          requestLocation();
        }}>{action}</button>}
    </div>
    {selectedId && <button type="button" className="secondary nearby-clear" onClick={onClear}>Clear selection</button>}
    {location && <>
      <p className="nearby-summary" aria-live="polite">{count} {count === 1 ? "location" : "locations"} within {radius}</p>
      {busCoverage !== "ready" && <p className="nearby-data-note">{busCoverage === "loading"
        ? "Loading published bus stops…" : "Some published bus feeds are unavailable. Bus stop coverage is limited."}</p>}
      {poorLocationAccuracy(location.accuracyM) && <p className="nearby-accuracy" role="status">
        Location accuracy is low (about {formatNearbyDistance(location.accuracyM)}). Nearby results with similar distances may be equally close.
      </p>}
      {count === 0 ? <p className="nearby-empty">{busCoverage === "loading"
        ? `No locations found within ${radius} so far.` : `No public transport locations found within ${radius}.`}</p> :
        <ol className="nearby-results">
          {recommendations.slice(0, expanded ? undefined : NEARBY_INITIAL_COUNT).map(({ candidate, metres }) => {
            const kind = candidate.type === "BUS_STOP" ? "Bus stop" : candidate.record.mode === "Bus" ? "BRT stop" : "Rail station";
            const isSelected = candidate.id === selectedId;
            return <li key={candidate.id} className="nearby-result" data-selected={isSelected}>
              <span aria-hidden="true" className="nearby-type-icon">{kind === "Rail station" ? "🚆" : "🚌"}</span>
              <div className="nearby-result-copy">
                <h3>{candidate.name}</h3>
                <p>{kind}{candidate.type === "RAIL_STATION" && candidate.record.interchange && " · Interchange"}</p>
                <ul className="nearby-routes" aria-label="Routes">
                  {candidate.routes.map(route => <li key={route.id}>
                    <i aria-hidden="true" className="mode-dot" style={{ backgroundColor: routeColours.get(route.id) ??
                      (route.id === brtSunway.id ? brtSunway.colour : "#2563eb") }}/>{route.name}
                  </li>)}
                </ul>
              </div>
              <strong className="nearby-distance">{formatRecommendationDistance(metres, location.accuracyM)}</strong>
              <button type="button" className="secondary nearby-view" aria-label={`View on Map: ${candidate.name}`}
                aria-current={isSelected ? "true" : undefined} onClick={() => onSelect(candidate)}>View on Map</button>
            </li>;
          })}
        </ol>}
      {count > NEARBY_INITIAL_COUNT && <button type="button" className="secondary nearby-more"
        aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show Less" : "Show More"}</button>}
    </>}
  </section>;
}
