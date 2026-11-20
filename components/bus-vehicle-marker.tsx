"use client";

import L from "leaflet";
import React, { useEffect, useMemo, useRef } from "react";
import { Marker, Popup, Tooltip } from "react-leaflet";
import { SIMULATED } from "@/lib/simulation/clock";
import { brtSunway } from "@/lib/expanded-services";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { busMarkerGraphic } from "./bus-marker-graphic";
import { useOptionalBusCamera } from "./bus-camera-context";
import { useBusPopupPresentation } from "./bus-popup-presentation";

export default function BusVehicleMarker({ record, active, subdued = false, onSelect }: {
  record: TransitRecord & { position: NonNullable<TransitRecord["position"]> };
  active: boolean;
  subdued?: boolean;
  onSelect: () => void;
}) {
  const camera = useOptionalBusCamera();
  const marker = useRef<L.Marker>(null);
  const popup = useRef<L.Popup>(null);
  const owner = "bus-popup-owner-" + encodeURIComponent(record.id);
  const isBrt = record.routeId === brtSunway.id;
  useBusPopupPresentation(popup, marker, owner);
  const icon = useMemo(() => L.divIcon({
    className: `transport-icon vehicle-icon bus-vehicle-icon${isBrt ? " brt-vehicle-icon" : ""}${active ? " vehicle-selected" : ""}`,
    html: busMarkerGraphic,
    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -15],
  }), [active, isBrt]);

  useEffect(() => {
    if (!active) marker.current?.closePopup();
  }, [active]);

  return <Marker ref={marker} position={record.position} title={record.name} icon={icon}
    opacity={subdued && !active ? .45 : 1} zIndexOffset={active ? 1100 : 250} eventHandlers={{ click: onSelect }}>
    <Popup ref={popup} pane="popupPane" className={owner} autoPan={camera ? false : undefined}><div className="bus-vehicle-popup" data-vehicle-id={record.id}><strong>{record.name}</strong><br/>{isBrt ? brtSunway.name : record.route}<br/>{SIMULATED}
      <br/>{record.status} · {record.speed} km/h</div></Popup>
    <Tooltip>{record.name} · {SIMULATED}</Tooltip>
  </Marker>;
}
