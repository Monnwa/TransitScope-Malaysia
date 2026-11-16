"use client";

import "leaflet/dist/leaflet.css";
import "@/app/markers.css";
import "@/app/estimated-trains.css";
import L from "leaflet";
import { Fragment, useEffect, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { RailNetwork } from "@/lib/rail-model";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { splitRoutePath } from "@/lib/route-projection";
import type { SimulatedBusJourney, SimulatedTrain } from "@/lib/simulation/vehicles";
import type { SimulatedBikeStation } from "@/lib/simulation/scenarios";
import { SIMULATED } from "@/lib/simulation/clock";
import { JourneyMapNavigation, JourneyStopMarker, MovingRoute } from "./journey-map-layers";
import type { BusMapJourney } from "./bus-journey-panel";
import type { JourneyNavigation } from "./simulated-bus-panel";
import EstimatedTrainControls from "./estimated-train-controls";
import EstimatedTrainLayer from "./estimated-train-layer";
import LinkBikeLayer from "./linkbike-layer";

const center: [number, number] = [3.142, 101.699];

function busIcon(record: TransitRecord, selected: boolean) {
  return L.divIcon({
    className: `transport-icon vehicle-icon ${selected ? "vehicle-selected" : ""}`,
    html: `<span style="--marker:#2563eb" aria-hidden="true"><i class="vehicle-glyph" style="transform:rotate(${(record.bearing ?? 0) - 90}deg)">🚌</i></span>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
}

function MapView({ signal, selected }: { signal: number; selected?: TransitRecord }) {
  const map = useMap();
  useEffect(() => { if (signal) map.setView(center, 13); }, [signal, map]);
  useEffect(() => {
    if (!selected?.position || selected.mode === "Shared bike") return;
    if (!map.getBounds().contains(selected.position)) map.panTo(selected.position, { animate: false });
    if (selected.mode === "Bus" && selected.recordKind === "vehicle") {
      map.getContainer().scrollIntoView({ block: window.innerWidth <= 720 ? "start" : "center", behavior: "instant" });
    }
  }, [selected?.id, map]);
  return null;
}

export default function TransitMap({ records, selected, onSelect, resetSignal, network, journey, navigation, trains, bikes, now, onRefresh }: {
  records: TransitRecord[];
  selected?: TransitRecord;
  onSelect: (record: TransitRecord) => void;
  resetSignal: number;
  network: RailNetwork;
  journey: SimulatedBusJourney | null;
  navigation: JourneyNavigation | null;
  trains: SimulatedTrain[];
  bikes: SimulatedBikeStation[];
  now: number;
  onRefresh: () => void;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [showTrains, setShowTrains] = useState(false);
  const [showLinkBike, setShowLinkBike] = useState(false);
  const [linkBikeControlsHost, setLinkBikeControlsHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const lines = selected?.railLines;
    if (lines?.length) {
      setHighlighted(lines);
      setHidden(current => current.filter(id => !lines.includes(id)));
    }
  }, [selected?.id]);
  useEffect(() => {
    if (!resetSignal) return;
    setHidden([]);
    setHighlighted([]);
  }, [resetSignal]);
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(result => setUserPosition([result.coords.latitude, result.coords.longitude]), () => undefined,
      { maximumAge: 60_000, timeout: 10_000 });
  }, []);

  const lineById = new Map(network.lines.map(line => [line.id, line]));
  const toggleHighlight = (id: string) => setHighlighted(current => current.length === 1 && current[0] === id ? [] : [id]);
  const visible = records.filter(record => !record.railLines?.length || record.railLines.some(id => !hidden.includes(id)));
  const visibleIds = new Set(visible.map(record => record.id));
  const visibleTrains = trains.filter(train => visibleIds.has(train.id));
  const stopsAndBuses = visible.filter(record => record.position && record.mode !== "Shared bike" &&
    (record.recordKind !== "vehicle" || record.mode === "Bus")).sort((a, b) => Number(!!a.railLines) - Number(!!b.railLines));
  const selectedJourney = journey && visibleIds.has(journey.vehicle.id) ? journey : null;
  const segments = selectedJourney && !selectedJourney.isPreview ?
    splitRoutePath(selectedJourney.path, selectedJourney.segment, selectedJourney.position) : null;
  const activeNavigation = navigation?.journeyId === selectedJourney?.journeyId ? navigation : null;
  const selectedStop = selectedJourney?.stops.find(stop => stop.sequence === activeNavigation?.sequence);
  const mapJourney: BusMapJourney | null = selectedJourney ? {
    vehicleId: selectedJourney.vehicle.id, path: selectedJourney.path, tripId: selectedJourney.journeyId,
    navigation: activeNavigation?.action, locate: activeNavigation && !selectedStop ? activeNavigation.action : undefined,
    selectedStop: selectedStop ? { ...selectedStop, key: `${selectedJourney.journeyId}:${selectedStop.id}`, journeyKey: selectedJourney.journeyId,
      vehicleId: selectedJourney.vehicle.id, routeName: selectedJourney.routeId, confidence: SIMULATED } : null,
    lastSeen: { position: selectedJourney.position, timestamp: selectedJourney.vehicle.reportedAt, available: true, name: selectedJourney.vehicle.name },
  } : null;

  return <section className="rail-map-group">
    <fieldset className="rail-filters"><legend>Train lines</legend>
      {network.lines.map(line => <span key={line.id} className="rail-filter-item">
        <label><input type="checkbox" aria-label={`Show ${line.name}`} checked={!hidden.includes(line.id)} onChange={() =>
          setHidden(current => current.includes(line.id) ? current.filter(id => id !== line.id) : [...current, line.id])}/><i style={{ background: line.colour }}/></label>
        <button className="line-legend" aria-pressed={highlighted.includes(line.id)} onClick={() => toggleHighlight(line.id)}>{line.name}</button>
      </span>)}
      <button className="secondary" onClick={onRefresh}>Reload train lines</button>
    </fieldset>
    <EstimatedTrainControls enabled={showTrains} onToggle={setShowTrains} now={now} count={visibleTrains.length} trains={trains} lines={network.lines} onRefresh={onRefresh}/>
    <div className="linkbike-controls">
      <label><input type="checkbox" checked={showLinkBike} onChange={event => setShowLinkBike(event.target.checked)}/>Show LinkBike stations</label>
      <span>{SIMULATED}</span><div ref={setLinkBikeControlsHost}/>
    </div>
    <div className="map-wrap" aria-label="Interactive transport map">
      <MapContainer center={center} zoom={13} scrollWheelZoom className="map">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
        <MapView signal={resetSignal} selected={selected}/>
        <JourneyMapNavigation journey={mapJourney}/>
        {network.lines.filter(line => !hidden.includes(line.id)).flatMap(line => line.paths.map((path, index) => {
          const active = highlighted.includes(line.id);
          const dimmed = highlighted.length > 0 && !active;
          return <Fragment key={`${line.id}:${index}`}>
            <Polyline positions={path} interactive={false} pathOptions={{ color: "#fff", weight: active ? 10 : 7, opacity: dimmed ? .3 : .95 }}/>
            <Polyline className={`rail-alignment ${line.id.replace(/[^a-zA-Z0-9]/g, "-")}`} positions={path}
              pathOptions={{ color: line.colour, weight: active ? 6 : 4, opacity: dimmed ? .3 : 1 }}
              eventHandlers={{ click: () => toggleHighlight(line.id) }}><Popup>{line.name}<br/>{SIMULATED}</Popup></Polyline>
          </Fragment>;
        }))}
        {segments && selectedJourney && <MovingRoute path={selectedJourney.path} fallback={segments}/>}
        {selectedJourney?.isPreview && <Polyline className="selected-vehicle-route" positions={selectedJourney.path}
          pathOptions={{ color: "#2563eb", weight: 5, dashArray: "8 5" }}><Tooltip>Simulated departure preview</Tooltip></Polyline>}
        {mapJourney && <JourneyStopMarker journey={mapJourney}/>}
        {stopsAndBuses.map(record => {
          const active = selected?.id === record.id;
          const popup = <Popup><strong>{record.name}</strong><br/>{record.lineNames?.join(" · ") || record.route}<br/>{SIMULATED}
            {record.interchange && <><br/>Interchange</>}
            {record.recordKind === "vehicle" && <><br/>{record.status} · {record.speed} km/h</>}
          </Popup>;
          if (record.recordKind === "vehicle") {
            return <Marker key={record.id} position={record.position!} title={record.name} icon={busIcon(record, active)}
              zIndexOffset={active ? 1100 : 0} eventHandlers={{ click: () => onSelect(record) }}>{popup}<Tooltip>{record.name} · {SIMULATED}</Tooltip></Marker>;
          }
          const stationColours = (record.railLines ?? []).flatMap(id => lineById.get(id)?.colour ?? []);
          const dimmed = record.railLines?.length && highlighted.length > 0 && !record.railLines.some(id => highlighted.includes(id));
          return <CircleMarker key={record.id} center={record.position!} radius={record.interchange ? 8 : 6}
            className="rail-station" pane="markerPane" pathOptions={{ color: stationColours[0] ?? "#2563eb",
              fillColor: stationColours[1] ?? "#fff", weight: 3, fillOpacity: dimmed ? .3 : 1, opacity: dimmed ? .3 : 1 }}
            eventHandlers={{ click: () => onSelect(record) }}><Tooltip>{record.name}</Tooltip>{popup}</CircleMarker>;
        })}
        {showTrains && <EstimatedTrainLayer trains={visibleTrains} selected={selected?.id} onSelect={onSelect} highlighted={highlighted}/>}
        {showLinkBike && linkBikeControlsHost && <LinkBikeLayer stations={bikes} records={visible} controlsHost={linkBikeControlsHost} onSelect={onSelect}/>}
        {userPosition && <Marker position={userPosition} icon={L.divIcon({ className: "transport-icon user-icon", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] })}><Popup>Your current location</Popup></Marker>}
      </MapContainer>
      <div className="map-legend" aria-label="Map legend"><span>Train lines and stations</span><span>◉ Interchange</span>
        <span>🚌 Bus / 🚆 Train</span><span>● Your location</span><span>○ Station / stop</span>
        {segments && <span>Grey: route behind · Blue: route ahead</span>}
      </div>
    </div>
  </section>;
}
