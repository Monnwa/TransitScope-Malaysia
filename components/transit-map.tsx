"use client";

import "leaflet/dist/leaflet.css";
import "@/app/markers.css";
import "@/app/estimated-trains.css";
import "@/app/map-camera.css";
import L from "leaflet";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CircleMarker, MapContainer, Marker, Pane, Polyline, Popup, TileLayer, Tooltip, useMapEvent } from "react-leaflet";
import type { RailLine } from "@/lib/rail-model";
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
import MicromobilityLayer from "./micromobility-layer";
import BusRouteLayers from "./bus-route-layers";
import BusMapCamera from "./bus-map-camera";
import RailStationPopup from "./rail-station-popup";
import PopupControlAvoidance from "./popup-control-avoidance";
import { lightBasemap } from "@/lib/map-basemap";
import MapSearchOverlay from "./map-search-overlay";
import type { StationSearchRequest } from "@/lib/station-search";
import type { MicromobilityResponse } from "@/lib/micromobility";
import SearchableStationPopup from "./searchable-station-popup";
import { stationRailLines } from "@/lib/rail-route-style";
import RailRouteLayers from "./rail-route-layers";

const center: [number, number] = [3.142, 101.699];

function DismissSelectionOnBackground({ dismiss }: { dismiss?: () => void }) {
  useMapEvent("click", ({ originalEvent }: L.LeafletMouseEvent) => {
    const target = originalEvent.target;
    if (originalEvent.composedPath?.().some(node => node instanceof Element && node.classList.contains("map-search-host"))) return;
    if (target instanceof Element && !target.closest(".leaflet-interactive, .leaflet-popup, .leaflet-control")) dismiss?.();
  });
  return null;
}

export default function TransitMap({ records, busRouteId, showBusRoutes, showSharedBike, selected, onSelect, resetSignal, railLines, search, stationSearch,
  searchActive = false, onSearchPopupClose, onMicromobilityData, journey, navigation, onLocate, trains, bikes, now, onRefresh }: {
  records: TransitRecord[];
  busRouteId: string;
  showBusRoutes: boolean;
  showSharedBike: boolean;
  selected?: TransitRecord;
  onSelect: (record: TransitRecord | null) => void;
  resetSignal: number;
  railLines: RailLine[];
  search?: ReactNode;
  stationSearch?: StationSearchRequest | null;
  searchActive?: boolean;
  onSearchPopupClose?: (request: StationSearchRequest) => void;
  onMicromobilityData?: (data: MicromobilityResponse) => void;
  journey: SimulatedBusJourney | null;
  navigation: JourneyNavigation | null;
  onLocate: () => void;
  trains: SimulatedTrain[];
  bikes: SimulatedBikeStation[];
  now: number;
  onRefresh: () => void;
}) {
  const [cameraControlsHost, setCameraControlsHost] = useState<HTMLDivElement | null>(null);
  const [routeHighlight, setRouteHighlight] = useState<string[]>([]);
  const lineById = useMemo(() => new Map(railLines.map(line => [line.id, line])), [railLines]);
  const stationLines = useMemo(() => stationRailLines(selected, railLines), [selected, railLines]);
  const highlighted = useMemo(() => stationLines.length ? stationLines : routeHighlight.filter(id => lineById.has(id)),
    [stationLines, routeHighlight, lineById]);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const railRequest = stationSearch && (!stationSearch.type || stationSearch.type === "RAIL_STATION") ? stationSearch : null;
  const busRequest = showBusRoutes && stationSearch?.type === "BUS_STOP" ? stationSearch : null;
  const micromobilityRequest = showSharedBike && stationSearch?.type === "MICROMOBILITY_STATION" ? stationSearch : null;
  useEffect(() => {
    setRouteHighlight([]);
  }, [stationLines, selected?.id]);
  useEffect(() => {
    if (!resetSignal) return;
    setRouteHighlight([]);
  }, [resetSignal]);
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(result => setUserPosition([result.coords.latitude, result.coords.longitude]), () => undefined,
      { maximumAge: 60_000, timeout: 10_000 });
  }, []);

  const toggleHighlight = useCallback((id: string) => setRouteHighlight(current => current.length === 1 && current[0] === id ? [] : [id]), []);
  const mapRecords = railRequest && selected?.id === railRequest.stationId && stationLines.length && !records.some(record => record.id === selected.id)
    ? [...records, selected] : records;
  const visibleIds = new Set(mapRecords.map(record => record.id));
  const visibleTrains = trains.filter(train => visibleIds.has(train.id));
  const stationsAndBuses = mapRecords.filter(record => record.position &&
    (record.mode === "Bus" ? record.recordKind === "vehicle" : record.mode !== "Shared bike" && record.recordKind !== "vehicle"))
    .sort((a, b) => Number(!!a.railLines) - Number(!!b.railLines));
  const selectedJourney = journey && selected?.id === journey.vehicle.id && visibleIds.has(journey.vehicle.id) ? journey : null;
  const emphasizedRouteId = selectedJourney?.routeId ?? busRouteId;
  const quietRail = showBusRoutes && highlighted.length === 0;
  const railModes = [...new Set(railLines.map(line => line.mode))];
  const segments = selectedJourney && !selectedJourney.isPreview ?
    splitRoutePath(selectedJourney.path, selectedJourney.segment, selectedJourney.position) : null;
  const activeNavigation = navigation?.journeyId === selectedJourney?.journeyId ? navigation : null;
  return <section className="rail-map-group">
    <EstimatedTrainControls now={now} count={visibleTrains.length} trains={trains} lines={railLines} onRefresh={onRefresh}/>
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
        <DismissSelectionOnBackground dismiss={selected || stationSearch ? () => onSelect(null) : undefined}/>
        <BusRouteLayers selectedRouteId={busRouteId} emphasizedRouteId={emphasizedRouteId} enabled={showBusRoutes}/>
        <RailRouteLayers lines={railLines} highlighted={highlighted} stationLines={stationLines}
          quietRail={quietRail} onHighlight={toggleHighlight}/>
        <Pane name="bus-journey-route" style={{ zIndex: 450 }}>
        {segments && selectedJourney && <MovingRoute path={selectedJourney.path} fallback={segments}/>}
        {selectedJourney?.isPreview && <Polyline className="selected-vehicle-route" positions={selectedJourney.path}
          pathOptions={{ color: "#2563eb", weight: 5, dashArray: "8 5" }}><Tooltip>Simulated departure preview</Tooltip></Polyline>}
        </Pane>
        {showBusRoutes && !busRequest && <Pane name="bus-stops" style={{ zIndex: 440 }}>
          {mapRecords.map(record => record.mode === "Bus" && record.recordKind === "stop" && record.position &&
            <CircleMarker key={record.id} center={record.position} radius={3} className="bus-network-stop"
              pathOptions={{ color: "#617b99", fillColor: "#fff", fillOpacity: 1, weight: 1.5 }}
              eventHandlers={{ click: () => onSelect(record) }}>
              <Tooltip>{record.name}</Tooltip>
              <Popup><strong>{record.name}</strong><br/>Route {record.routeId} · {SIMULATED}</Popup>
            </CircleMarker>)}
        </Pane>}
        <Pane name="bus-markers" style={{ zIndex: 625 }}>
        {selectedJourney && <JourneyStopMarkers key={selectedJourney.journeyId} journey={selectedJourney} navigation={activeNavigation}/>}
        {busRequest && <CircleMarker key={busRequest.stationId} center={busRequest.stop.position} radius={7}
          className="bus-search-stop" pathOptions={{ color: "#fff", fillColor: "#2563eb", fillOpacity: 1, weight: 2 }}>
          <Tooltip>{busRequest.stop.name}</Tooltip>
          <SearchableStationPopup id={busRequest.stationId} position={busRequest.stop.position} request={busRequest}
            contentSelector=".journey-stop-popup" onSearchClose={onSearchPopupClose} pane="popupPane"
            className="journey-stop-popup-shell bus-search-popup" maxWidth={245} minWidth={170} maxHeight={165} autoPan={false}>
            <div className="journey-stop-popup" aria-label="Bus stop details">
              <strong>{busRequest.stop.name}</strong>
              <span>Bus stop · {busRequest.stop.sourceId}</span>
              <span>{busRequest.stop.feed}{busRequest.stop.area && ` · ${busRequest.stop.area}`}</span>
              {busRequest.stop.routes.length > 0 && <span>Routes · {busRequest.stop.routes.map(route => route.name).join(", ")}</span>}
              <span>{busRequest.stop.simulatedPosition ? "Simulation map position" : "Static GTFS"}</span>
            </div>
          </SearchableStationPopup>
        </CircleMarker>}
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
          const popup = rail ? <RailStationPopup record={record} selectedRecordId={selected?.id} searchRequest={railRequest}/> : <Popup pane="popupPane">{content}</Popup>;
          const stationColours = (record.railLines ?? []).flatMap(id => lineById.get(id)?.colour ?? []);
          const dimmed = record.railLines?.length && highlighted.length > 0 && !record.railLines.some(id => highlighted.includes(id));
          return <CircleMarker key={record.id} center={position} radius={quietRail ? record.interchange ? 6 : 4 : record.interchange ? 8 : 6}
            className="rail-station" pane="markerPane" pathOptions={{ color: stationColours[0] ?? "#2563eb",
              fillColor: stationColours[1] ?? "#fff", weight: quietRail ? 2 : 3, fillOpacity: dimmed ? .3 : quietRail ? .35 : 1, opacity: dimmed ? .3 : quietRail ? .45 : 1 }}
            eventHandlers={{ click: () => onSelect(record), popupclose: () => { if (rail && selected?.id === record.id) onSelect(null); } }}><Tooltip>{record.name}</Tooltip>{popup}</CircleMarker>;
        })}
        </Pane>
        {/* Keep station hit targets accessible when auto-enabled trains share their coordinates. */}
        <Pane name="simulated-trains" style={{ zIndex: 590 }}>
          <EstimatedTrainLayer trains={visibleTrains} selected={selected?.id} onSelect={onSelect} highlighted={highlighted}/>
        </Pane>
        <MicromobilityLayer visible={showSharedBike} searchActive={searchActive} searchRequest={micromobilityRequest}
          onSearchClose={onSearchPopupClose} onData={onMicromobilityData}/>
        {showSharedBike && <LinkBikeLayer stations={bikes} records={mapRecords}
          onSelect={onSelect} searchActive={searchActive} searchRequest={micromobilityRequest}
          onSearchClose={onSearchPopupClose}/>}
        {userPosition && <Marker position={userPosition} icon={L.divIcon({ className: "transport-icon user-icon", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] })}><Popup>Your current location</Popup></Marker>}
      </MapContainer>
      <div className="map-legend" aria-label="Map legend">
        {showBusRoutes && <span><i className="bus-route-legend"/>{emphasizedRouteId ? "Bus route " + emphasizedRouteId : "Simulated Klang Valley buses: T401 · T402"}</span>}
        {railModes.length > 0 && <><span>{railModes.length === 4 ? "Train" : railModes.join(" · ")} lines and stations</span><span>◉ Interchange</span></>}
        {(showBusRoutes || railModes.length > 0) && <span>{showBusRoutes && "🚌 Bus"}{showBusRoutes && railModes.length > 0 && " / "}{railModes.length > 0 && "🚆 Train"}</span>}
        <span>● Your location</span>{(showBusRoutes || railLines.length > 0) && <span>○ Station / stop</span>}
        {selectedJourney && <span><i className="bus-journey-stop-dot"/> Selected journey stops</span>}
        {segments && <span>Grey: route behind · Blue: route ahead</span>}
      </div>
    </div>
    </div>
  </section>;
}
