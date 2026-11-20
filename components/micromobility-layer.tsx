"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { divIcon } from "leaflet";
import { LayerGroup, Marker, Pane, useMap } from "react-leaflet";
import { MICROMOBILITY_DISCLAIMER, SIMULATED_INVENTORY_DISCLAIMER, NEW_MICROMOBILITY_OPERATORS, OPERATOR_STYLE, locationLabel, micromobilityResponseSchema, type MicromobilityResponse, type MicromobilityStation } from "@/lib/micromobility";
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

export default function MicromobilityLayer({ visible, searchActive,
  searchRequest, onSearchClose, onData }: {
  visible: boolean; searchActive: boolean; searchRequest?: StationSearchRequest | null;
  onSearchClose?: (request: StationSearchRequest) => void;
  onData?: (data: MicromobilityResponse) => void;
}) {
  const [data, setData] = useState<MicromobilityResponse | null>(null);
  const layers = useMemo(() => NEW_MICROMOBILITY_OPERATORS.map(operator => ({ operator,
    stations: data?.stations.filter(station => station.operator === operator) ?? [] })), [data]);
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | undefined;
    async function load(canRetry: boolean) {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]);
      try {
        const response = await fetch("/api/micromobility/stations", { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Micromobility stations unavailable");
        const result = micromobilityResponseSchema.parse(await response.json());
        if (!signal.aborted) {
          setData(result);
          onData?.(result);
        }
      } catch {
        if (canRetry && !controller.signal.aborted) {
          retryTimer = window.setTimeout(() => void load(false), 1_000);
        }
      }
    }
    void load(true);
    return () => { controller.abort(); window.clearTimeout(retryTimer); };
  }, [onData]);

  if (!visible) return null;

  return <Pane name="micromobility-coverage" style={{ zIndex: 580 }}>
    {layers.map(({ operator, stations }) => {
      const request = searchRequest?.type === "MICROMOBILITY_STATION" && searchRequest.operator === operator ? searchRequest : null;
      const visible = searchActive
        ? stations.filter(station => showMicromobilityMarker(searchActive, station.id === request?.stationId))
        : stations;
      return visible.length > 0 && <StationLayer key={operator} operator={operator} stations={visible}
        request={request} onSearchClose={onSearchClose}/>;
    })}
  </Pane>;
}
