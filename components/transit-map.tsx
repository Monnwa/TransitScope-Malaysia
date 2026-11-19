"use client";

import "leaflet/dist/leaflet.css";
import "@/app/markers.css";
import "@/app/estimated-trains.css";
import "@/app/map-camera.css";
import L from "leaflet";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { CircleMarker, MapContainer, Marker, Pane, Polyline, Popup, TileLayer, Tooltip, useMapEvent } from "react-leaflet";
import type { RailNetwork } from "@/lib/rail-model";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { splitRoutePath } from "@/lib/route-projection";
import type { SimulatedBusJourney, SimulatedTrain } from "@/lib/simulation/vehicles";
import type { SimulatedBikeStation } from "@/lib/simulation/scenarios";
import { SIMULATED } from "@/lib/simulation/clock";
import { JourneyStopMarkers, MovingRoute } from "./journey-map-layers";
import BusVehicleMarker from "./bus-vehicle-marker";
import type { JourneyNavigation } from "./simulated-bus-panel";
import EstimatedTrainControls from "./estimated-train-controls";
import EstimatedTrainLayer from "./estimated-train-layer";
import LinkBikeLayer from "./linkbike-layer";
import BusRouteLayers from "./bus-route-layers";
import BusMapCamera from "./bus-map-camera";
import RailStationPopup from "./rail-station-popup";
import PopupControlAvoidance from "./popup-control-avoidance";
import { lightBasemap } from "@/lib/map-basemap";
import MapSearchOverlay from "./map-search-overlay";

const center: [number, number] = [3.142, 101.699];

function DismissBusOnBackground({ dismiss }: { dismiss?: () => void }) {
  useMapEvent("click", ({ originalEvent }: L.LeafletMouseEvent) => {
    const target = originalEvent.target;
    if (target instanceof Element && !target.closest(".leaflet-interactive, .leaflet-popup, .leaflet-control")) dismiss?.();
  });
  return null;
}

export default function TransitMap({ records, busRouteId, showBusRoutes, selected, onSelect, resetSignal, network, search, journey, navigation, onLocate, trains, bikes, now, onRefresh }: {
  records: TransitRecord[];
  busRouteId: string;
  showBusRoutes: boolean;
  selected?: TransitRecord;
  onSelect: (record: TransitRecord | null) => void;
  resetSignal: number;
  network: RailNetwork;
  search?: ReactNode;
  journey: SimulatedBusJourney | null;
  navigation: JourneyNavigation | null;
  onLocate: () => void;
  trains: SimulatedTrain[];
  bikes: SimulatedBikeStation[];
  now: number;
  onRefresh: () => void;
}) {
  const [cameraControlsHost, setCameraControlsHost] = useState<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
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
  const stationsAndBuses = visible.filter(record => record.position &&
    (record.mode === "Bus" ? record.recordKind === "vehicle" : record.mode !== "Shared bike" && record.recordKind !== "vehicle"))
    .sort((a, b) => Number(!!a.railLines) - Number(!!b.railLines));
  const selectedJourney = journey && selected?.id === journey.vehicle.id && visibleIds.has(journey.vehicle.id) ? journey : null;
  const emphasizedRouteId = selectedJourney?.routeId ?? busRouteId;
  const quietRail = showBusRoutes && highlighted.length === 0;
  const segments = selectedJourney && !selectedJourney.isPreview ?
    splitRoutePath(selectedJourney.path, selectedJourney.segment, selectedJourney.position) : null;
  const activeNavigation = navigation?.journeyId === selectedJourney?.journeyId ? navigation : null;
  return <section className="rail-map-group">
    <fieldset className="rail-filters"><legend>Train lines</legend>
      {network.lines.map(line => <span key={line.id} className="rail-filter-item">
        <label><input type="checkbox" aria-label={`Show ${line.name}`} checked={!hidden.includes(line.id)} onChange={() =>
          setHidden(current => current.includes(line.id) ? current.filter(id => id !== line.id) : [...current, line.id])}/><i style={{ background: line.colour }}/></label>
        <button className="line-legend" aria-pressed={highlighted.includes(line.id)} onClick={() => toggleHighlight(line.id)}>{line.name}</button>
      </span>)}
      <button className="secondary" onClick={onRefresh}>Reload train lines</button>
    </fieldset>
    <EstimatedTrainControls now={now} count={visibleTrains.length} trains={trains} lines={network.lines} onRefresh={onRefresh}/>
    <div className="linkbike-controls" ref={setLinkBikeControlsHost}>
      <span>{SIMULATED}</span>
    </div>
    <div className="map-camera-frame">
    <div className="map-camera-bar" ref={setCameraControlsHost}/>
    <div className="map-wrap" aria-label="Interactive transport map">
      <MapContainer center={center} zoom={13} scrollWheelZoom className="map">
        {search && <MapSearchOverlay>{search}</MapSearchOverlay>}
        <TileLayer {...lightBasemap}/>
        <PopupControlAvoidance selectedRecordId={selected?.id} journeyVehicleId={selectedJourney?.vehicle.id}/>
        <BusMapCamera selected={selected} vehicleVisible={visibleIds.has(selected?.id ?? "")} selectedRouteId={busRouteId}
          enabled={showBusRoutes} resetSignal={resetSignal} journey={journey} navigation={navigation}
          controlsHost={cameraControlsHost} onLocate={onLocate}/>
        <DismissBusOnBackground dismiss={journey ? () => onSelect(null) : undefined}/>
        <BusRouteLayers selectedRouteId={busRouteId} emphasizedRouteId={emphasizedRouteId} enabled={showBusRoutes}/>
        {network.lines.filter(line => !hidden.includes(line.id)).flatMap(line => line.paths.map((path, index) => {
          const active = highlighted.includes(line.id);
          const dimmed = highlighted.length > 0 && !active;
          return <Fragment key={`${line.id}:${index}`}>
            <Polyline positions={path} interactive={false} pathOptions={{ color: "#fff", weight: active ? 10 : quietRail ? 4 : 7, opacity: dimmed ? .3 : quietRail ? .6 : .95 }}/>
            <Polyline className={`rail-alignment ${line.id.replace(/[^a-zA-Z0-9]/g, "-")}`} positions={path}
              pathOptions={{ color: line.colour, weight: active ? 6 : quietRail ? 2.5 : 4, opacity: dimmed ? .3 : quietRail ? .45 : 1, dashArray: quietRail ? "2 5" : undefined }}
              eventHandlers={{ click: () => toggleHighlight(line.id) }}><Popup>{line.name}<br/>{SIMULATED}</Popup></Polyline>
          </Fragment>;
        }))}
        <Pane name="bus-journey-route" style={{ zIndex: 450 }}>
        {segments && selectedJourney && <MovingRoute path={selectedJourney.path} fallback={segments}/>}
        {selectedJourney?.isPreview && <Polyline className="selected-vehicle-route" positions={selectedJourney.path}
          pathOptions={{ color: "#2563eb", weight: 5, dashArray: "8 5" }}><Tooltip>Simulated departure preview</Tooltip></Polyline>}
        </Pane>
        <Pane name="bus-markers" style={{ zIndex: 625 }}>
        {selectedJourney && <JourneyStopMarkers key={selectedJourney.journeyId} journey={selectedJourney} navigation={activeNavigation}/>}
        {stationsAndBuses.map(record => {
          const { position } = record;
          if (!position) return null;
          if (record.recordKind === "vehicle") {
            return <BusVehicleMarker key={record.id} record={{ ...record, position }}
              active={selected?.id === record.id} subdued={!!emphasizedRouteId && record.routeId !== emphasizedRouteId} onSelect={() => onSelect(record)}/>;
          }
          const rail = ["MRT", "LRT", "Monorail", "KTM"].includes(record.mode);
          const content = <><strong>{record.name}</strong><br/>{record.lineNames?.join(" · ") || record.route}<br/>{SIMULATED}
            {record.interchange && <><br/>Interchange</>}
          </>;
          const popup = rail ? <RailStationPopup record={record} selectedRecordId={selected?.id}/> : <Popup pane="popupPane">{content}</Popup>;
          const stationColours = (record.railLines ?? []).flatMap(id => lineById.get(id)?.colour ?? []);
          const dimmed = record.railLines?.length && highlighted.length > 0 && !record.railLines.some(id => highlighted.includes(id));
          return <CircleMarker key={record.id} center={position} radius={quietRail ? record.interchange ? 6 : 4 : record.interchange ? 8 : 6}
            className="rail-station" pane="markerPane" pathOptions={{ color: stationColours[0] ?? "#2563eb",
              fillColor: stationColours[1] ?? "#fff", weight: quietRail ? 2 : 3, fillOpacity: dimmed ? .3 : quietRail ? .35 : 1, opacity: dimmed ? .3 : quietRail ? .45 : 1 }}
            eventHandlers={{ click: () => onSelect(record) }}><Tooltip>{record.name}</Tooltip>{popup}</CircleMarker>;
        })}
        </Pane>
        {/* Keep station hit targets accessible when auto-enabled trains share their coordinates. */}
        <Pane name="simulated-trains" style={{ zIndex: 590 }}>
          <EstimatedTrainLayer trains={visibleTrains} selected={selected?.id} onSelect={onSelect} highlighted={highlighted}/>
        </Pane>
        {linkBikeControlsHost && <LinkBikeLayer stations={bikes} records={visible} controlsHost={linkBikeControlsHost} onSelect={onSelect}/>}
        {userPosition && <Marker position={userPosition} icon={L.divIcon({ className: "transport-icon user-icon", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] })}><Popup>Your current location</Popup></Marker>}
      </MapContainer>
      <div className="map-legend" aria-label="Map legend">{showBusRoutes && <span><i className="bus-route-legend"/>{emphasizedRouteId ? "Bus route " + emphasizedRouteId : "Simulated Klang Valley buses: T401 · T402"}</span>}<span>Train lines and stations</span><span>◉ Interchange</span>
        <span>🚌 Bus / 🚆 Train</span><span>● Your location</span><span>○ Station / stop</span>
        {selectedJourney && <span><i className="bus-journey-stop-dot"/> Selected journey stops</span>}
        {segments && <span>Grey: route behind · Blue: route ahead</span>}
      </div>
    </div>
    </div>
  </section>;
}
