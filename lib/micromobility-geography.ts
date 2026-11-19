import type { MicromobilityStation } from "./micromobility";

type LocatedStation = Pick<MicromobilityStation, "id" | "operator" | "latitude" | "longitude">;

/** Great-circle distance in metres, using the mean Earth radius. */
export function stationDistance(a: Pick<LocatedStation, "latitude" | "longitude">, b: Pick<LocatedStation, "latitude" | "longitude">) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Explicit register for any approved sub-300 m pair. Empty: no exceptions needed.
export const MICROMOBILITY_SPACING_EXCEPTIONS: { ids: [string, string]; reason: string }[] = [];

export function auditStationDistances(stations: LocatedStation[], comparison = stations) {
  const pairs = stations.flatMap((a, index) => stations.slice(index + 1).map(b => ({
    ids: [a.id, b.id], sameOperator: a.operator === b.operator, distanceMetres: stationDistance(a, b),
  })));
  const minimum = (sameOperator: boolean) => Math.min(...pairs.filter(p => p.sameOperator === sameOperator).map(p => p.distanceMetres));
  const rows = stations.map(station => {
    const nearest = (sameOperator: boolean) => comparison.filter(other => other.id !== station.id && (other.operator === station.operator) === sameOperator)
      .map(other => ({ id: other.id, distanceMetres: stationDistance(station, other) })).sort((a, b) => a.distanceMetres - b.distanceMetres)[0] ?? null;
    return { ...station, nearestSameOperator: nearest(true), nearestOtherOperator: nearest(false) };
  });
  return { rows, summary: { stations: stations.length, exactDuplicates: pairs.filter(p => p.distanceMetres === 0).length,
    pairsUnder100m: pairs.filter(p => p.distanceMetres < 100).length, pairsUnder200m: pairs.filter(p => p.distanceMetres < 200).length,
    pairsUnder300m: pairs.filter(p => p.distanceMetres < 300).length, minimumSameOperatorMetres: minimum(true),
    minimumCrossOperatorMetres: minimum(false), minimumCrossOperatorIncludingLinkBikeMetres: Math.min(...rows.map(r => r.nearestOtherOperator?.distanceMetres ?? Infinity)) }, pairs };
}
