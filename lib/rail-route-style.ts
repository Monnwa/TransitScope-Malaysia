import type { RailLine } from "./rail-model";
import type { Record as TransitRecord } from "./transit-data";

export const DEFAULT_RAIL_OPACITY = 1;
export const SELECTED_ROUTE_OPACITY = 1;
export const DIMMED_ROUTE_OPACITY = 0.18;

/** Use merged station identities and canonical route IDs, never station names. */
export function stationRailLines(selected: TransitRecord | undefined, lines: RailLine[]): string[] {
  if (!selected || selected.recordKind === "vehicle" || !["MRT", "LRT", "Monorail", "KTM"].includes(selected.mode)) return [];
  const valid = new Set(lines.map(line => line.id));
  return [...new Set(selected.railLines?.filter(id => valid.has(id)) ?? [])];
}

export function railRouteOpacity(lineId: string, stationLines: string[]): number {
  return !stationLines.length ? DEFAULT_RAIL_OPACITY : stationLines.includes(lineId) ? SELECTED_ROUTE_OPACITY : DIMMED_ROUTE_OPACITY;
}
