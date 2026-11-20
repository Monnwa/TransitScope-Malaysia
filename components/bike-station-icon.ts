import { divIcon } from "leaflet";
import "@/app/micromobility.css";

const bicycle = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/>
  <path d="m5 17 4-9 4 9H5m4-7h7l3 7m-3-7-1-4h3M7 8h4"/>
</svg>`;

export function bikeStationIcon(className: string) {
  return divIcon({ className: `bike-station-marker ${className}`, html: bicycle, iconSize: [26, 26], iconAnchor: [13, 13] });
}
