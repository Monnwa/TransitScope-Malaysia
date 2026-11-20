import type { RailLine } from "./rail-model";
import type { Record as TransitRecord } from "./transit-data";

export const railRouteStyle = {
  track: { weight: 4, lineCap: "round", lineJoin: "round" },
  casing: { weight: 7, color: "#fff" },
  smoothFactor: 0.4,
  opacity: { normal: 1, selected: 1, dimmed: 0.18 },
  transitionMs: 180,
} as const;

// The two ERL services trace the same corridor. Both strokes fit inside the
// regular casing, and either service alone uses the regular track and casing.
export const erlSharedTrack = {
  express: "erl-klia-ekspres",
  transit: "erl-klia-transit",
  expressWeight: 5.5,
  transitWeight: 2.5,
} as const;

/** Use merged station identities and canonical route IDs, never station names. */
export function stationRailLines(selected: TransitRecord | undefined, lines: RailLine[]): string[] {
  if (!selected || selected.recordKind === "vehicle" || selected.mode === "Bus" || selected.mode === "Shared bike") return [];
  const valid = new Set(lines.map(line => line.id));
  return [...new Set(selected.railLines?.filter(id => valid.has(id)) ?? [])];
}

export function railRouteOpacity(lineId: string, stationLines: string[]): number {
  const { normal, selected, dimmed } = railRouteStyle.opacity;
  return !stationLines.length ? normal : stationLines.includes(lineId) ? selected : dimmed;
}
