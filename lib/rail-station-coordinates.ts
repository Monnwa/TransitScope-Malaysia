import snapshot from "./data/rail-station-coordinates.json";
import type { GeoPoint } from "./route-projection";
import type { Record as TransitRecord } from "./transit-data";

type PublishedStop = {
  code: string;
  sequence: number;
  position: GeoPoint;
  osmNodeId?: number;
  originalGtfsPosition?: GeoPoint;
};

// GTFS stops matched by trip and stop sequence to each existing simulation stop ID.
export const publishedRailStops = snapshot.stations as unknown as Partial<Record<string, PublishedStop>>;
const interchangeAnchors: Partial<Record<string, string>> = snapshot.interchangeAnchors;

export function railStationAnchor(station: TransitRecord) {
  const routeId = interchangeAnchors[station.id] ?? station.railLines?.[0];
  if (!routeId || routeId === "brt-sunway") return undefined;
  const ref = station.stopRefs?.find(stopRef => stopRef.startsWith(`sim:${routeId}:`));
  const stop = (ref && publishedRailStops[ref]) || station.stationProvenance?.find(entry => entry.routeId === routeId);
  return stop ? { ...stop, routeId } : undefined;
}

export function withRailStationCoordinates(station: TransitRecord): TransitRecord {
  const anchor = railStationAnchor(station);
  return anchor ? { ...station, position: anchor.position } : station;
}
