import type { RailNetwork } from "./rail-model";
import { modeSchema, type Mode, type Record as TransitRecord } from "./transit-data";

export const DEFAULT_TRANSPORT_TYPES = modeSchema.options;

export function transportTypeFilter(network: RailNetwork, types: readonly Mode[], busRouteId: string) {
  const selected = new Set(types);
  const railLines = network.lines.filter(line => selected.has(line.mode));
  const railIds = new Set(railLines.map(line => line.id));
  const bus = selected.has("Bus");
  const sharedBike = selected.has("Shared bike");
  const showsBusRoute = (routeId?: string | null) => bus && (!busRouteId || routeId === busRouteId);
  const visibleLineIds = new Set([...railIds, ...(network.busLines ?? []).filter(line => showsBusRoute(line.id)).map(line => line.id)]);

  return {
    bus, sharedBike, railLines, railIds, visibleLineIds, showsBusRoute,
    showsRecord(record: TransitRecord) {
      if (record.railLines?.length) return record.railLines.some(id => visibleLineIds.has(id));
      if (record.mode === "Bus") return showsBusRoute(record.routeId);
      return selected.has(record.mode);
    },
  };
}
