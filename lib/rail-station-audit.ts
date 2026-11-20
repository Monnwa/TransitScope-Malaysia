import { projectCandidates, type GeoPoint, type Projection, type ShapeIndex } from "./route-projection";

export const stationAlignmentThresholds = { passM: 15, warningM: 30 };

export function classifyRailStationDistance(
  distanceM: number | null,
  { passM, warningM } = stationAlignmentThresholds,
): "PASS" | "WARNING" | "FAIL" | "UNVERIFIED" {
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM < 0) return "UNVERIFIED";
  if (distanceM <= passM) return "PASS";
  return distanceM <= warningM ? "WARNING" : "FAIL";
}

/** Project only onto the already-matched route and keep the WGS84 station coordinate intact. */
export function closestRailTrackPoint(shape: ShapeIndex, station: GeoPoint): Projection | null {
  return projectCandidates(shape, station, Infinity).reduce<Projection | null>((best, candidate) =>
    !best || candidate.offsetM < best.offsetM ? candidate : best, null);
}
