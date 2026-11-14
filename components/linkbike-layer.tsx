"use client";

import { createPortal } from "react-dom";
import { divIcon } from "leaflet";
import { LayerGroup, Marker, Popup, useMap } from "react-leaflet";
import type { SimulatedBikeStation } from "@/lib/simulation/scenarios";
import type { Record as TransitRecord } from "@/lib/transit-data";
import "@/app/linkbike.css";

const icon = divIcon({ className: "linkbike-marker", html: "<span aria-hidden='true'>B</span>", iconSize: [28, 28], iconAnchor: [14, 14] });

export default function LinkBikeLayer({ stations, records, controlsHost, onSelect }: {
  stations: SimulatedBikeStation[]; records: TransitRecord[]; controlsHost: HTMLElement; onSelect: (record: TransitRecord) => void;
}) {
  const map = useMap();
  const visible = stations.flatMap(station => {
    const record = records.find(item => item.id === station.station_id);
    return record?.position ? [{ record, station, position: record.position }] : [];
  });
  return <LayerGroup>
    {createPortal(<div className="linkbike-map-status">
      <span role="status">{visible.length} simulated LinkBike stations on the map</span>
      {visible.length > 0 && <button type="button" className="secondary" onClick={() =>
        map.fitBounds(visible.map(item => item.position), { padding: [28, 28], maxZoom: 15, animate: false })
      }>Zoom to LinkBike stations</button>}
    </div>, controlsHost)}
    {visible.map(({ record, station, position }) => <Marker key={station.station_id} position={position} icon={icon}
      title={`LinkBike: ${station.station_name}`} eventHandlers={{ click: () => onSelect(record) }}>
      <Popup maxWidth={245} minWidth={180}><section className="linkbike-popup" aria-label="LinkBike station details">
        <h3>{station.station_name}</h3>
        <p>{station.data_status}</p>
        <dl>
          <dt>Available bicycles</dt><dd>{station.available_bikes}</dd>
          <dt>Total docks</dt><dd>{station.total_docks}</dd>
        </dl>
      </section></Popup>
    </Marker>)}
  </LayerGroup>;
}
