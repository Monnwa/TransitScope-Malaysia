"use client";

import type L from "leaflet";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Popup, useMap, type PopupProps } from "react-leaflet";
import type { GeoPoint } from "@/lib/route-projection";
import type { StationSearchRequest } from "@/lib/station-search";
import useStationSearchNavigation from "./use-station-search-navigation";

function SearchPopupContent({ onReady, children }: { onReady: () => void; children: ReactNode }) {
  useLayoutEffect(() => { onReady(); });
  return <>{children}</>;
}

export default function SearchableStationPopup({ id, position, request, contentSelector, onSearchClose, eventHandlers,
  children, ...props }: PopupProps & {
  id: string;
  position: GeoPoint;
  request?: StationSearchRequest | null;
  contentSelector: string;
  onSearchClose?: (request: StationSearchRequest) => void;
}) {
  const map = useMap();
  const popup = useRef<L.Popup>(null);
  const ready = useStationSearchNavigation(map, popup, { id, position }, request, contentSelector);
  const searchOptions = request ? {
    className: [props.className, "station-search-native-popup"].filter(Boolean).join(" "),
    closeOnClick: false,
    autoPan: false,
  } : {};
  return <Popup {...props} {...searchOptions} ref={popup}
    eventHandlers={{ ...eventHandlers, remove: event => {
    eventHandlers?.remove?.(event);
    if (request) onSearchClose?.(request);
  } }}>
    <SearchPopupContent onReady={() => {
      if (request) {
        popup.current?.update();
        ready.current();
      }
    }}>{children}</SearchPopupContent>
  </Popup>;
}
