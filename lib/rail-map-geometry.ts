import legacyAlignments from "./data/legacy-rail-alignments.json";
import type { RailLine } from "./rail-model";

// Each snapshot uses WGS84 [latitude, longitude], matching RailLine.paths.
const displayAlignments: Partial<Record<string, { paths: number[][][] }>> = legacyAlignments;

/** Use published infrastructure for the map without changing simulation paths or timings. */
export function railMapPaths(line: RailLine): RailLine["paths"] {
  if (line.dataMode === "STATIC") return line.paths;
  return (displayAlignments[line.id]?.paths as RailLine["paths"] | undefined) ?? line.paths;
}
