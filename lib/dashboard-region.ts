import type { SearchBusStop } from "./bus-stop-search";
import { brtSunway } from "./expanded-services";
import type { MicromobilityStation } from "./micromobility";
import { busRoutes, railNetwork } from "./simulation/network";
import type { Mode, Record as TransitRecord } from "./transit-data";

export const regions = ["Klang Valley", "Penang"] as const;
export type Region = typeof regions[number];
export const defaultRegion: Region = "Klang Valley";
export const penangBusFeed = "rapid-bus-penang";
const klangValleyStates = new Set(["Kuala Lumpur", "Selangor", "Putrajaya"]);

export const klangValleyRoutes = [...railNetwork.lines, ...busRoutes].map(route => ({
  id: route.id, name: route.name, colour: route.colour,
  category: route.id === brtSunway.id ? brtSunway.classification : route.mode,
}));
export type OverviewRoute = { id: string; name: string; colour?: string; category: Mode | "BRT" };
const klangValleyRouteIds = new Set(klangValleyRoutes.map(route => route.id));

export function micromobilityRegion(station: Pick<MicromobilityStation, "state">): Region | undefined {
  if (station.state === "Penang") return "Penang";
  if (klangValleyStates.has(station.state)) return "Klang Valley";
}

export function simulationRecordRegion(record: TransitRecord, penangBikeIds: ReadonlySet<string>): Region | undefined {
  if (record.recordKind === "other" && record.mode === "Shared bike" && penangBikeIds.has(record.id)) return "Penang";
  if (record.railLines?.some(id => klangValleyRouteIds.has(id)) ||
      record.routeId && klangValleyRouteIds.has(record.routeId)) return "Klang Valley";
}

export function busStopRegion(stop: SearchBusStop): Region | undefined {
  const [kind, feed] = stop.id.split(":");
  if (kind !== "bus-stop") return;
  if (feed === penangBusFeed) return "Penang";
  if (feed === "rapid-bus-kl" || feed === "rapid-bus-mrtfeeder") return "Klang Valley";
}

export function penangBusStops(stops: readonly SearchBusStop[]) {
  const indexed = new Map<string, SearchBusStop>();
  for (const stop of stops) {
    if (stop.simulatedPosition || busStopRegion(stop) !== "Penang" || !stop.routes.length) continue;
    const previous = indexed.get(stop.id);
    if (previous && (previous.position[0] !== stop.position[0] || previous.position[1] !== stop.position[1])) continue;
    const routes = new Map([...(previous?.routes ?? []), ...stop.routes].map(route => [route.id, route]));
    indexed.set(stop.id, { ...stop, routes: [...routes.values()] });
  }
  return [...indexed.values()];
}

export function staticBusRoutes(stops: readonly SearchBusStop[]): OverviewRoute[] {
  const routes = new Map(stops.flatMap(stop => stop.routes.map(route => [route.id, route] as const)));
  return [...routes.values()].sort((a, b) => a.name.localeCompare(b.name, "en-MY", { numeric: true }))
    .map(route => ({ ...route, category: "Bus" }));
}

export function vehicleCategory(record: TransitRecord): Mode | "BRT" {
  return record.mode === "Bus" && record.routeId === brtSunway.id ? brtSunway.classification : record.mode;
}
