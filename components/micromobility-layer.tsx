"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { divIcon } from "leaflet";
import { LayerGroup, Marker, Pane, useMap } from "react-leaflet";
import { MICROMOBILITY_DISCLAIMER, SIMULATED_INVENTORY_DISCLAIMER, NEW_MICROMOBILITY_OPERATORS, OPERATOR_STYLE, locationLabel, micromobilityResponseSchema, stationCounts, type MicromobilityOperator, type MicromobilityResponse, type MicromobilityStation } from "@/lib/micromobility";
import { useOptionalBusCamera } from "./bus-camera-context";
import SearchableStationPopup from "./searchable-station-popup";
import { showMicromobilityMarker, type StationSearchRequest } from "@/lib/station-search";
import "@/app/micromobility.css";

// Stable icons avoid replacing marker DOM on the dashboard's one-second clock.
const icons = new Map(NEW_MICROMOBILITY_OPERATORS.flatMap(operator => (["SYNTHETIC", "SOURCE_VERIFIED"] as const).map(origin => {
  const style = OPERATOR_STYLE[operator];
  return [`${operator}:${origin}`, divIcon({ className: `micromobility-marker micromobility-${operator.toLowerCase()} ${origin === "SYNTHETIC" ? "synthetic" : "source-backed"}`,
    html: `<span aria-hidden="true">${style.letter}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] })] as const;
})));

const StationLayer = memo(function StationLayer({ operator, stations, request, onSearchClose }: {
  operator: typeof NEW_MICROMOBILITY_OPERATORS[number]; stations: MicromobilityStation[];
  request: StationSearchRequest | null; onSearchClose?: (request: StationSearchRequest) => void;
}) {
  const style = OPERATOR_STYLE[operator];
  const map = useMap();
  const camera = useOptionalBusCamera();
  return <LayerGroup>{stations.map(station => <Marker key={station.id} position={[station.latitude, station.longitude]} autoPanOnFocus={false}
    title={station.name} icon={icons.get(`${operator}:${station.dataOrigin}`)}>
    <SearchableStationPopup id={station.id} position={[station.latitude, station.longitude]} request={request}
      contentSelector=".micromobility-popup" onSearchClose={onSearchClose}
      pane="popupPane" className="micromobility-popup-shell" maxWidth={240} minWidth={160} maxHeight={180} autoPan={false}
      eventHandlers={{ add: event => {
        if (request) return;
        camera?.dispatch({ type: "MANUAL" });
        const popup = event.target;
        requestAnimationFrame(() => {
          if (!popup.isOpen()) return;
          // Fit once after the portal commits, using the existing camera guard.
          // An immediate pan records a stable view before scroll/layout recovery.
          popup.update();
          const element = popup.getElement();
          if (!element) return;
          const p = element.getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
          const dx = p.left < m.left + 12 ? p.left - m.left - 12 : Math.max(0, p.right - m.right + 12);
          const dy = p.top < m.top + 120 ? p.top - m.top - 120 : Math.max(0, p.bottom - m.bottom + 12);
          const fit = () => { map.stop(); map.panBy([dx, dy], { animate: false }); };
          if (camera) camera.guard.run(fit); else fit();
        });
      } }}><section className="micromobility-popup" aria-label={`${style.name} location details`}>
      <h3>{station.name}</h3>
      {station.simulatedInventory && <div className="micromobility-inventory">
        <dl aria-label="Simulated inventory"><dt>Available bicycles</dt><dd>{station.simulatedInventory.availableBicycles}</dd>
          <dt>Total docks</dt><dd>{station.simulatedInventory.totalDocks}</dd></dl>
        <p className="micromobility-classification">SIMULATED INVENTORY</p><p>{SIMULATED_INVENTORY_DISCLAIMER}</p>
      </div>}
      <p className="micromobility-classification">{locationLabel(station)}</p>
      <dl><dt>Operator</dt><dd>{style.name}</dd><dt>Area / state</dt><dd>{station.area} · {station.state}</dd>
        <dt>Data origin</dt><dd>{station.dataOrigin}</dd><dt>Verification</dt><dd>{station.verificationStatus}</dd>
        <dt>Operation</dt><dd>Unverified</dd><dt>Live availability</dt><dd>Not available</dd></dl>
      {station.sourceUrl && <p><a href={station.sourceUrl} target="_blank" rel="noopener noreferrer">{station.sourceName}</a><br/>{station.sourceDescription}</p>}
      <p>{station.notes}</p><p>{MICROMOBILITY_DISCLAIMER}</p>
    </section></SearchableStationPopup>
  </Marker>)}</LayerGroup>;
});

export default function MicromobilityLayer({ controlsHost, linkBikeVisible, onLinkBikeVisibilityChange, searchActive,
  searchRequest, onSearchClose, onData }: {
  controlsHost: HTMLElement; linkBikeVisible: boolean; onLinkBikeVisibilityChange: (visible: boolean) => void;
  searchActive: boolean; searchRequest?: StationSearchRequest | null;
  onSearchClose?: (request: StationSearchRequest) => void;
  onData?: (data: MicromobilityResponse) => void;
}) {
  const map = useMap();
  const camera = useOptionalBusCamera();
  const [data, setData] = useState<MicromobilityResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState<MicromobilityOperator[]>([]);
  const layers = useMemo(() => NEW_MICROMOBILITY_OPERATORS.map(operator => ({ operator,
    stations: data?.stations.filter(station => station.operator === operator) ?? [] })), [data]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    let active = true;
    setError(false);
    fetch("/api/micromobility/stations", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Unavailable");
      const result = micromobilityResponseSchema.parse(await response.json());
      if (active) {
        setData(result);
        onData?.(result);
      }
    }).catch(() => { if (active) setError(true); }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt, onData]);

  function zoom(stations: MicromobilityStation[]) {
    if (!stations.length) return;
    camera?.dispatch({ type: "MANUAL" });
    const fit = () => map.fitBounds(stations.map(s => [s.latitude, s.longitude] as [number, number]), { padding: [28, 28], maxZoom: 15, animate: false });
    if (camera) camera.guard.run(fit); else fit();
  }
  const counts = stationCounts(data?.stations ?? []);
  return <>
    {createPortal(<fieldset className="micromobility-controls"><legend>Micromobility coverage · SIMULATED</legend>
      <div className="micromobility-operators">{counts.map(({ operator, total, sourceBacked, synthetic }) => {
        const style = OPERATOR_STYLE[operator];
        return <div key={operator} className="micromobility-operator">
          <label><input type="checkbox" aria-label={`Show ${style.name}`} checked={operator === "LINKBIKE" ? linkBikeVisible : !hidden.includes(operator)}
            onChange={event => operator === "LINKBIKE" ? onLinkBikeVisibilityChange(event.target.checked) :
              setHidden(current => event.target.checked ? current.filter(id => id !== operator) : [...current, operator])}/>
            <i style={{ background: style.colour }}/>{style.name}: {data ? total : "…"}</label>
          <small>{data ? `${sourceBacked} source-backed · ${synthetic} synthetic` : "Loading locations…"}</small>
          {operator !== "LINKBIKE" && <button type="button" className="secondary" disabled={!total || searchActive} onClick={() => zoom(data?.stations.filter(s => s.operator === operator) ?? [])}>Zoom to {style.name}</button>}
        </div>;
      })}</div>
      <p role="status">{error ? "New operator locations unavailable. LinkBike remains independent." : data ?
        `${data.stations.length} coverage locations · ${data.stations.filter(s => s.dataOrigin === "SOURCE_VERIFIED").length} source-backed (approximate positions) · ${data.stations.filter(s => s.dataOrigin === "SYNTHETIC").length} synthetic` : "Loading micromobility coverage…"}</p>
      {error && <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry micromobility locations</button>}
      <p>Dashed markers: synthetic · Solid markers: source-backed. Live vehicle availability: Not available.</p>
      <p>{MICROMOBILITY_DISCLAIMER}</p>
    </fieldset>, controlsHost)}
    <Pane name="micromobility-coverage" style={{ zIndex: 580 }}>
      {layers.map(({ operator, stations }) => {
        const request = searchRequest?.type === "MICROMOBILITY_STATION" && searchRequest.operator === operator ? searchRequest : null;
        const visible = searchActive ? stations.filter(station => showMicromobilityMarker(
          !hidden.includes(operator), true, station.id === request?.stationId)) : !hidden.includes(operator) ? stations : [];
        return visible.length > 0 && <StationLayer key={operator} operator={operator} stations={visible}
          request={request} onSearchClose={onSearchClose}/>;
      })}
    </Pane>
  </>;
}
