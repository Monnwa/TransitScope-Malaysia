"use client";

import { createPortal } from "react-dom";
import { divIcon } from "leaflet";
import { LayerGroup, Marker, useMap } from "react-leaflet";
import { bikeRecords, type SimulatedBikeStation } from "@/lib/simulation/scenarios";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { showMicromobilityMarker, type StationSearchRequest } from "@/lib/station-search";
import "@/app/linkbike.css";
import { useOptionalBusCamera } from "./bus-camera-context";
import SearchableStationPopup from "./searchable-station-popup";

const icon = divIcon({ className: "linkbike-marker", html: "<span aria-hidden='true'>B</span>", iconSize: [28, 28], iconAnchor: [14, 14] });

export default function LinkBikeLayer({ stations, records, controlsHost, onSelect, searchActive,
  searchRequest, onSearchClose }: {
  stations: SimulatedBikeStation[]; records: TransitRecord[]; controlsHost: HTMLElement; onSelect: (record: TransitRecord) => void;
  searchActive: boolean; searchRequest?: StationSearchRequest | null;
  onSearchClose?: (request: StationSearchRequest) => void;
}) {
  const map = useMap();
  const camera = useOptionalBusCamera();
  const request = searchRequest?.type === "MICROMOBILITY_STATION" && searchRequest.operator === "LINKBIKE" ? searchRequest : null;
  const visible = stations.flatMap(station => {
    const selected = station.station_id === request?.stationId;
    if (!showMicromobilityMarker(searchActive, selected)) return [];
    const record = records.find(item => item.id === station.station_id) ?? (selected ? bikeRecords([station])[0] : undefined);
    return record?.position ? [{ record, station, position: record.position }] : [];
  });
  return <LayerGroup>
    {createPortal(<div className="linkbike-map-status">
      <span role="status">{visible.length} simulated LinkBike stations on the map</span>
      {visible.length > 0 && <button type="button" className="secondary" onClick={() => {
        camera?.dispatch({ type: "MANUAL" });
        const fit = () => map.fitBounds(visible.map(item => item.position), { padding: [28, 28], maxZoom: 15, animate: false });
        if (camera) camera.guard.run(fit); else fit();
      }}>Zoom to LinkBike stations</button>}
    </div>, controlsHost)}
    {visible.map(({ record, station, position }) => <Marker key={station.station_id} position={position} icon={icon}
      title={`LinkBike: ${station.station_name}`} eventHandlers={{ click: () => { if (!request) onSelect(record); } }}>
      <SearchableStationPopup id={station.station_id} position={position} request={request}
        contentSelector=".linkbike-popup" onSearchClose={onSearchClose} maxWidth={245} minWidth={180}>
      <section className="linkbike-popup" aria-label="LinkBike station details">
        <h3>{station.station_name}</h3>
        <p>{station.data_status}</p>
        <dl>
          <dt>Available bicycles</dt><dd>{station.available_bikes}</dd>
          <dt>Total docks</dt><dd>{station.total_docks}</dd>
        </dl>
      </section></SearchableStationPopup>
    </Marker>)}
  </LayerGroup>;
}
