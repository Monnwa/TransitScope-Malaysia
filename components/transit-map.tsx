"use client";

import "leaflet/dist/leaflet.css";
import "@/app/markers.css";
import "@/app/estimated-trains.css";
import "@/app/map-camera.css";
import L from "leaflet";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
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
import { railRouteStyle, stationRailLines } from "@/lib/rail-route-style";
import RailRouteLayers from "./rail-route-layers";
import RouteIndicators from "./route-indicators";
import { brtSunway, expandedServiceById } from "@/lib/expanded-services";
import type { UserLocation } from "@/lib/nearby-transit";

const center: [number, number] = [3.142, 101.699];
const userIcon = L.divIcon({ className: "transport-icon user-icon", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] });

function DismissSelectionOnBackground({ dismiss }: { dismiss?: () => void }) {
  useMapEvent("click", ({ originalEvent }: L.LeafletMouseEvent) => {
    const target = originalEvent.target;
    if (originalEvent.composedPath?.().some(node => node instanceof Element && node.classList.contains("map-search-host"))) return;
    if (target instanceof Element && !target.closest(".leaflet-interactive, .leaflet-popup, .leaflet-control")) dismiss?.();
  });
  return null;
}

export default function TransitMap({ records, busRouteId, showBusRoutes, showSharedBike, selected, onSelect, resetSignal, railLines, search, stationSearch,
  searchActive = false, onSearchPopupClose, onMicromobilityData, journey, navigation, onLocate, trains, bikes, now, onRefresh, userLocation }: {
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
  userLocation?: UserLocation | null;
}) {
  const [cameraControlsHost, setCameraControlsHost] = useState<HTMLDivElement | null>(null);
  const [routeHighlight, setRouteHighlight] = useState<string[]>([]);
  const [focusedRoute, setFocusedRoute] = useState<{ line: RailLine } | null>(null);
  const lineById = useMemo(() => new Map(railLines.map(line => [line.id, line])), [railLines]);
  const stationLines = useMemo(() => stationRailLines(selected, railLines), [selected, railLines]);
  const highlighted = useMemo(() => stationLines.length ? stationLines : routeHighlight.filter(id => lineById.has(id)),
    [stationLines, routeHighlight, lineById]);
  const railRequest = stationSearch && (!stationSearch.type || stationSearch.type === "RAIL_STATION") ? stationSearch : null;
  const busRequest = stationSearch?.type === "BUS_STOP" && (showBusRoutes || stationSearch.alert || stationSearch.nearby) ? stationSearch : null;
  const nearbyBusRoutes = useMemo(() => [
    ...(busRequest?.nearby ? busRequest.stop.routes.flatMap(route => [route.id, route.name]) : []),
    ...(railRequest?.nearby && selected?.railLines?.includes(brtSunway.id) ? [brtSunway.id] : []),
  ], [busRequest, railRequest, selected]);
  const micromobilityRequest = showSharedBike && stationSearch?.type === "MICROMOBILITY_STATION" ? stationSearch : null;
  useEffect(() => {
    setRouteHighlight([]);
  }, [stationLines, selected?.id]);
  useEffect(() => {
    if (!resetSignal) return;
    setRouteHighlight([]);
  }, [resetSignal]);
  const toggleHighlight = useCallback((id: string) => setRouteHighlight(current => current.length === 1 && current[0] === id ? [] : [id]), []);
  const alertTargets = stationSearch?.alert?.targets;
  const alertRailIds = new Set(alertTargets?.flatMap(target => target.type === "RAIL_STATION" ? [target.id] : []));
  const alertBusTargets = alertTargets?.flatMap(target => target.type === "BUS_STOP" ? [target.stop] : []) ?? [];
  const replacedBusStops = busRequest?.nearby && busRequest.stop.id.startsWith("bus-stop:rapid-bus-mrtfeeder:")
    ? [busRequest.stop] : alertBusTargets;
  const revealedRail = alertTargets?.flatMap(target => target.type === "RAIL_STATION" ? [target.record] : []) ??
    (railRequest && selected?.id === railRequest.stationId && (railRequest.nearby || stationLines.length || selected.stationProvenance?.length) ? [selected] : []);
  const mapRecords = revealedRail.length ? [...records, ...revealedRail.filter(station =>
    !records.some(record => record.id === station.id))] : records;
  const visibleIds = new Set(mapRecords.map(record => record.id));
  const visibleTrains = trains.filter(train => visibleIds.has(train.id));
  const busVehicles = mapRecords.filter(record => record.mode === "Bus" && record.recordKind === "vehicle" && record.position);
  const networkStations = mapRecords.filter(record => record.position && record.recordKind !== "vehicle" &&
    (record.mode === "Bus" ? record.railLines?.length : record.mode !== "Shared bike"));
  const selectedJourney = journey && selected?.id === journey.vehicle.id && visibleIds.has(journey.vehicle.id) ? journey : null;
  const emphasizedRouteId = selectedJourney?.routeId ?? busRouteId;
  function busMarker(record: TransitRecord) {
    if (!record.position) return null;
    return <BusVehicleMarker key={record.id} record={{ ...record, position: record.position }}
      active={selected?.id === record.id} subdued={!!emphasizedRouteId && record.routeId !== emphasizedRouteId} onSelect={() => onSelect(record)}/>;
  }
  const brtVisible = showBusRoutes && (!busRouteId || busRouteId === brtSunway.id) || nearbyBusRoutes.includes(brtSunway.id);
  const quietRail = showBusRoutes && highlighted.length === 0;
  const segments = selectedJourney && !selectedJourney.isPreview ?
    splitRoutePath(selectedJourney.path, selectedJourney.segment, selectedJourney.position) : null;
  const activeNavigation = navigation?.journeyId === selectedJourney?.journeyId ? navigation : null;
  return <section className="rail-map-group">
    <EstimatedTrainControls now={now} count={visibleTrains.length} trains={trains} lines={railLines} onRefresh={onRefresh}/>
    <div className="map-camera-frame">
    <div className="map-camera-bar" ref={setCameraControlsHost}/>
    <div className="map-wrap" aria-label="Interactive transport map" data-alert-navigation={stationSearch?.alert ? "active" : undefined}
      style={{ "--rail-opacity-duration": `${railRouteStyle.transitionMs}ms` } as CSSProperties}>
      <MapContainer center={center} zoom={13} scrollWheelZoom className="map">
        {search && <MapSearchOverlay>{search}</MapSearchOverlay>}
        <TileLayer {...lightBasemap}/>
        <PopupControlAvoidance selectedRecordId={selected?.id} journeyVehicleId={selectedJourney?.vehicle.id}/>
        <BusMapCamera selected={selected} vehicleVisible={visibleIds.has(selected?.id ?? "")} selectedRouteId={busRouteId}
          enabled={showBusRoutes} resetSignal={resetSignal} journey={journey} navigation={navigation}
          controlsHost={cameraControlsHost} onLocate={onLocate} focusedRailRoute={focusedRoute}/>
        <DismissSelectionOnBackground dismiss={selected || stationSearch ? () => onSelect(null) : undefined}/>
        <BusRouteLayers selectedRouteId={busRouteId} emphasizedRouteId={emphasizedRouteId} enabled={showBusRoutes} revealedRouteIds={nearbyBusRoutes}/>
        <RailRouteLayers lines={railLines} highlighted={highlighted} stationLines={stationLines} onHighlight={toggleHighlight}/>
        <Pane name="bus-journey-route" style={{ zIndex: 450 }}>
        {segments && selectedJourney && <MovingRoute path={selectedJourney.path} fallback={segments}
          activeColour={selectedJourney.routeId === brtSunway.id ? brtSunway.colour : undefined}/>}
        {selectedJourney?.isPreview && <Polyline className="selected-vehicle-route" positions={selectedJourney.path}
          pathOptions={{ color: selectedJourney.routeId === brtSunway.id ? brtSunway.colour : "#2563eb", weight: 5, dashArray: "8 5" }}>
          <Tooltip>Simulated departure preview</Tooltip></Polyline>}
        </Pane>
        {showBusRoutes && (!busRequest || busRequest.alert || busRequest.nearby) && <Pane name="bus-stops" style={{ zIndex: 440 }}>
          {mapRecords.map(record => record.mode === "Bus" && record.recordKind === "stop" && !record.railLines?.length && record.position &&
            !replacedBusStops.some(stop => record.stopRefs?.some(ref => ref.endsWith(`:${stop.sourceId}`)) &&
              stop.routes.some(route => route.id === record.routeId)) &&
            <CircleMarker key={record.id} center={record.position} radius={3} className="bus-network-stop"
              pathOptions={{ color: "#617b99", fillColor: "#fff", fillOpacity: 1, weight: 1.5 }}
              eventHandlers={{ click: () => onSelect(record) }}>
              <Tooltip>{record.name}</Tooltip>
              <Popup><strong>{record.name}</strong><br/>Route {record.routeId} · {SIMULATED}</Popup>
            </CircleMarker>)}
        </Pane>}
        <Pane name="brt-vehicles" style={{ zIndex: 595 }}>
          {busVehicles.filter(record => record.routeId === brtSunway.id).map(busMarker)}
        </Pane>
        <Pane name="bus-markers" style={{ zIndex: 625 }}>
        {busVehicles.filter(record => record.routeId !== brtSunway.id).map(busMarker)}
        {selectedJourney && <JourneyStopMarkers key={selectedJourney.journeyId} journey={selectedJourney} navigation={activeNavigation}/>}
        {alertBusTargets.filter(stop => stop.id !== busRequest?.stationId).map(stop => <CircleMarker key={stop.id}
          center={stop.position} radius={7} className="bus-alert-stop"
          pathOptions={{ color: "#1666d8", fillColor: "#fff", fillOpacity: 1, weight: 4 }}>
          <Tooltip>{stop.name}</Tooltip>
        </CircleMarker>)}
        {busRequest && <CircleMarker key={busRequest.stationId} center={busRequest.stop.position} radius={busRequest.nearby ? 9 : 7}
          className="bus-search-stop"
          pathOptions={{ color: busRequest.nearby ? "#1666d8" : "#fff", fillColor: busRequest.nearby ? "#fff" : "#2563eb", fillOpacity: 1, weight: busRequest.nearby ? 4 : 2 }}>
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
        {networkStations.map(record => {
          const { position } = record;
          if (!position) return null;
          const networkStation = Boolean(record.railLines?.length);
          const brtOnly = record.mode === "Bus";
          const content = <><strong>{record.name}</strong><br/>{record.lineNames?.join(" · ") || record.route}<br/>{SIMULATED}
            {record.interchange && <><br/>Interchange</>}
          </>;
          const popup = networkStation ? <RailStationPopup record={record} selectedRecordId={selected?.id} searchRequest={railRequest}/> : <Popup pane="popupPane">{content}</Popup>;
          const stationColours = (record.railLines ?? []).flatMap(id => (brtVisible && id === brtSunway.id ? brtSunway.colour : lineById.get(id)?.colour) ?? []);
          const dimmed = record.railLines?.length && highlighted.length > 0 && !record.railLines.some(id => highlighted.includes(id));
          const affected = alertRailIds.has(record.id);
          const nearbySelected = railRequest?.nearby && railRequest.stationId === record.id;
          const searchSelected = record.stationProvenance?.length && railRequest?.stationId === record.id;
          return <CircleMarker key={record.id} center={position} radius={affected || nearbySelected || searchSelected ? 9 : quietRail ? record.interchange ? 6 : 4 : record.interchange ? 8 : 6}
            className={brtOnly ? "brt-station" : "rail-station"}
            pane="markerPane" pathOptions={affected || nearbySelected
              ? { color: "#1666d8", fillColor: "#fff", weight: 4, fillOpacity: 1, opacity: 1 }
              : { color: stationColours[0] ?? expandedServiceById.get(record.stationProvenance?.[0]?.routeId ?? "")?.colour ?? "#2563eb",
                fillColor: stationColours[1] ?? "#fff", weight: searchSelected ? 4 : quietRail ? 2 : 3,
                fillOpacity: searchSelected || brtOnly ? 1 : dimmed ? .3 : quietRail ? .35 : 1,
                opacity: searchSelected || brtOnly ? 1 : dimmed ? .3 : quietRail ? .45 : 1 }}
            eventHandlers={{
              click: () => { if (!nearbySelected) onSelect(record); },
              popupclose: () => {
                if (nearbySelected) onSearchPopupClose?.(railRequest);
                else if (networkStation && selected?.id === record.id) onSelect(null);
              },
            }}><Tooltip>{record.name}</Tooltip>{popup}</CircleMarker>;
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
        {userLocation && <Marker position={userLocation.position} icon={userIcon} interactive={false} keyboard={false}/>}
      </MapContainer>
    </div>
    </div>
    <RouteIndicators lines={railLines} showBrt={brtVisible} onFocus={line => { onSelect(null); setFocusedRoute({ line }); }}/>
  </section>;
}
