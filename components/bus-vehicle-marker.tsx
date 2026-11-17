"use client";

import L from "leaflet";
import React, { useEffect, useMemo, useRef } from "react";
import { Marker, Popup, Tooltip } from "react-leaflet";
import { SIMULATED } from "@/lib/simulation/clock";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { busMarkerGraphic } from "./bus-marker-graphic";

export default function BusVehicleMarker({ record, active, onSelect }: {
  record: TransitRecord & { position: NonNullable<TransitRecord["position"]> };
  active: boolean;
  onSelect: () => void;
}) {
  const marker = useRef<L.Marker>(null);
  const icon = useMemo(() => L.divIcon({
    className: `transport-icon vehicle-icon bus-vehicle-icon${active ? " vehicle-selected" : ""}`,
    html: busMarkerGraphic,
    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -15],
  }), [active]);

  useEffect(() => {
    if (!active) marker.current?.closePopup();
  }, [active]);

  return <Marker ref={marker} position={record.position} title={record.name} icon={icon}
    zIndexOffset={active ? 1100 : 250} eventHandlers={{ click: onSelect }}>
    <Popup><div className="bus-vehicle-popup"><strong>{record.name}</strong><br/>{record.route}<br/>{SIMULATED}
      <br/>{record.status} · {record.speed} km/h</div></Popup>
    <Tooltip>{record.name} · {SIMULATED}</Tooltip>
  </Marker>;
}
