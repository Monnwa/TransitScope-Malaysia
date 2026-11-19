"use client";

import L from "leaflet";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { Pane, useMap } from "react-leaflet";

/** Keep search fixed to the viewport, above markers and below native popups. */
export default function MapSearchOverlay({ children }: { children: ReactNode }) {
  const map = useMap();
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!host) return;
    const place = () => {
      L.DomUtil.setPosition(host, map.containerPointToLayerPoint([0, 0]));
      host.style.width = `${map.getSize().x}px`;
    };
    L.DomEvent.disableClickPropagation(host);
    L.DomEvent.disableScrollPropagation(host);
    map.on("move zoom viewreset resize", place);
    place();
    return () => {
      map.off("move zoom viewreset resize", place);
      L.DomEvent.off(host);
    };
  }, [map, host]);

  return <Pane name="map-search" style={{ zIndex: 650, pointerEvents: "none" }}>
    <div className="map-search-host" ref={setHost} onKeyDown={event => event.stopPropagation()}>
      <div className="map-search">{children}</div>
    </div>
  </Pane>;
}
