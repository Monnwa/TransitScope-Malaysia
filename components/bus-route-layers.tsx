"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Pane, Polyline, useMap, useMapEvents } from "react-leaflet";
import { busMapRoutes } from "@/lib/bus-map-routes";

/** Memoized K.2B visual layers. All camera commands belong to BusMapCamera. */
function BusRouteLayers({ selectedRouteId, emphasizedRouteId, enabled }: {
  selectedRouteId: string;
  emphasizedRouteId: string;
  enabled: boolean;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const events = useMemo(() => ({ zoomend: () => setZoom(map.getZoom()) }), [map]);
  useMapEvents(events);
  useEffect(() => {
    const container = map.getContainer();
    container.dataset.busView = selectedRouteId ? "ROUTE" : "OVERVIEW";
    container.dataset.busRoute = selectedRouteId;
    container.dataset.busZoom = String(zoom);
  }, [map, selectedRouteId, zoom]);

  const close = zoom >= 14;
  const styles = useMemo(() => ({
    context: { color: "#617b99", weight: close ? 3.5 : 3, opacity: emphasizedRouteId ? .24 : .65, lineCap: "round" as const, lineJoin: "round" as const },
    casing: { color: "#fff", weight: close ? 9 : 8, opacity: .95 },
    selected: { color: "#1458b8", weight: close ? 5.5 : 4.5, opacity: 1 },
  }), [close, emphasizedRouteId]);
  const emphasized = busMapRoutes.find(route => route.id === emphasizedRouteId);

  return <>
    <Pane name="bus-route-network" style={{ zIndex: 420, pointerEvents: "none" }}>
      {enabled && busMapRoutes.filter(route => !selectedRouteId || route.id === selectedRouteId).map(route => <Polyline key={route.id}
        className={"bus-network-route bus-route-" + route.id} positions={route.path}
        interactive={false} pathOptions={styles.context}/>)}
    </Pane>
    <Pane name="bus-route-selected" style={{ zIndex: 430, pointerEvents: "none" }}>
      {enabled && emphasized && <>
        <Polyline positions={emphasized.path} interactive={false} pathOptions={styles.casing}/>
        <Polyline key={emphasized.id} className={"bus-route-emphasis bus-route-" + emphasized.id} positions={emphasized.path}
          interactive={false} pathOptions={styles.selected}/>
      </>}
    </Pane>
  </>;
}

export default memo(BusRouteLayers);
