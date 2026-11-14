"use client";

import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { groupEstimatedTrains } from "@/lib/train-position-display";
import type { SimulatedTrain } from "@/lib/simulation/vehicles";

const icon = (colour: string, count: number, selected: boolean) => L.divIcon({
  className: `estimated-train-icon ${selected ? "estimated-train-selected" : ""}`,
  html: `<span style="--train-colour:${colour}" aria-hidden="true">🚆<b>${count > 1 ? count : "~"}</b></span>`,
  iconSize: [30, 34], iconAnchor: [15, 17],
});

export default function EstimatedTrainLayer({ trains, selected, onSelect, highlighted }: {
  trains: SimulatedTrain[]; selected?: string; onSelect: (train: SimulatedTrain) => void; highlighted: string[];
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const groups = useMemo(() => groupEstimatedTrains(trains, train => map.latLngToContainerPoint(train.position), selected ?? null), [trains, map, zoom, selected]);
  const selectedPosition = trains.find(train => train.id === selected)?.position;
  useEffect(() => {
    if (selectedPosition && !map.getBounds().contains(selectedPosition)) map.panTo(selectedPosition, { animate: false });
  }, [selected, map]);

  return <>{groups.map(({ members, anchor }) => {
    const active = members.some(train => train.id === selected);
    const dimmed = highlighted.length > 0 && !members.some(train => highlighted.includes(train.lineId));
    const title = members.length > 1 ? `${members.length} simulated trains nearby` : `${anchor.name} towards ${anchor.destination}`;
    return <Marker key={members.map(train => train.id).sort().join("|")} title={title} position={anchor.position}
      icon={icon(anchor.colour, members.length, active)} opacity={dimmed ? .4 : 1} zIndexOffset={active ? 1300 : 800}
      eventHandlers={{ click: () => { if (members.length === 1) onSelect(anchor); } }}>
      <Tooltip>{title} · SIMULATED</Tooltip>
      <Popup autoPan={false} maxHeight={180} maxWidth={270}>
        <div className="estimated-train-popup"><strong>SIMULATED</strong>
          {members.map(train => <button type="button" key={train.id} onClick={() => onSelect(train)}>
            {train.name}<br/>{train.lineName}<br/>Towards {train.destination}{train.nextStation && <><br/>Next {train.nextStation.name}</>}
          </button>)}
        </div>
      </Popup>
    </Marker>;
  })}</>;
}
