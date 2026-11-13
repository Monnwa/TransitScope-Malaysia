"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { divIcon } from "leaflet";
import { LayerGroup, Marker, Popup, useMap } from "react-leaflet";
import {
  LINKBIKE_CONSUMER, LINKBIKE_PORTAL, LINKBIKE_REFRESH_SECONDS, type LinkBikeResponse, type LinkBikeStation,
} from "@/lib/linkbike-data";

const icon = divIcon({ className: "linkbike-marker", html: "<span aria-hidden='true'>B</span>", iconSize: [28, 28], iconAnchor: [14, 14] });

function StationDetails({ station }: { station: LinkBikeStation }) {
  return <section className="linkbike-popup" aria-label="LinkBike station details">
    <h3>{station.station_name}</h3>
    <p>Experimental · Unverified station candidate</p>
    <dl>
      <dt>Available bike</dt><dd>{station.available_bikes}</dd>
      <dt>Total docks</dt><dd>{station.total_docks}</dd>
    </dl>
    {station.validation_warnings.map(warning => <p key={warning}>{warning}</p>)}
    <p>Counts from the <a href={LINKBIKE_PORTAL}>LinkBike Maintenance Portal</a>. Location from the <a href={LINKBIKE_CONSUMER}>LinkBike station map data</a>.</p>
  </section>;
}

export default function LinkBikeLayer({ controlsHost }: { controlsHost: HTMLElement }) {
  const map = useMap();
  const [payload, setPayload] = useState<LinkBikeResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let visible = document.visibilityState === "visible";

    function schedule(delay: number) {
      if (timer !== undefined || inFlight || !visible || controller.signal.aborted) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, delay);
    }

    async function refresh() {
      if (inFlight || document.visibilityState !== "visible" || controller.signal.aborted) return;
      inFlight = true;
      let seconds = LINKBIKE_REFRESH_SECONDS;
      try {
        const response = await fetch("/api/micromobility/linkbike", { signal: controller.signal, cache: "no-store" });
        const data = await response.json() as LinkBikeResponse;
        if (controller.signal.aborted) return;
        if (Number.isInteger(data.refresh_seconds) && data.refresh_seconds >= 60 && data.refresh_seconds <= 3600) {
          seconds = data.refresh_seconds;
        }
        if (!response.ok || data.status !== "UNVERIFIED") throw new Error("LinkBike unavailable.");
        setPayload(data);
        setError(false);
      } catch {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(true);
      } finally {
        inFlight = false;
        schedule(seconds * 1000);
      }
    }

    function onVisibilityChange() {
      const nextVisible = document.visibilityState === "visible";
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (visible) {
        schedule(0);
      } else {
        clearTimeout(timer);
        timer = undefined;
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(0);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const located = (payload?.stations ?? []).flatMap(station =>
    station.coordinate_status === "VALIDATED_CANDIDATE" && station.latitude !== null && station.longitude !== null ?
      [{ station, position: [station.latitude, station.longitude] as [number, number] }] : []);
  const status = error ? "LinkBike information unavailable." : !payload ? "Loading LinkBike station candidates…" :
    !located.length ? "No LinkBike station coordinates passed validation." :
      `${located.length} LinkBike station ${located.length === 1 ? "candidate" : "candidates"} on the map`;
  return <LayerGroup>
    {createPortal(<div className="linkbike-map-status">
      <span role="status">{status}</span>
      {located.length > 0 && <button type="button" className="secondary" onClick={() =>
        map.fitBounds(located.map(row => row.position), { padding: [28, 28], maxZoom: 15, animate: false })
      }>Zoom to LinkBike stations</button>}
    </div>, controlsHost)}
    {located.map(({ station, position }) => <Marker key={station.station_id} position={position} icon={icon}
      title={`LinkBike candidate: ${station.station_name}`} alt={`LinkBike candidate: ${station.station_name}`}>
      <Popup maxWidth={245} minWidth={180}><StationDetails station={station}/></Popup>
    </Marker>)}
  </LayerGroup>;
}
