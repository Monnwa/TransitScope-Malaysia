import type { SearchBusStop } from "./bus-stop-search";
import { brtSunway, rapidBusBrtStopIds } from "./expanded-services";
import type { RailNetwork } from "./rail-model";
import { railStationAnchor } from "./rail-station-coordinates";
import { distanceM, validPoint, type GeoPoint } from "./route-projection";
import { transitSearchEntities, type TransitSearchEntity } from "./station-search";

export const NEARBY_RADIUS_M = 3_000;
export const NEARBY_INITIAL_COUNT = 5;

export type UserLocation = { position: GeoPoint; accuracyM: number };
export type NearbyCandidate = TransitSearchEntity;

export function nearbyTransitCandidates(network: RailNetwork, publishedBusStops: readonly SearchBusStop[]) {
  const stops = new Map<string, SearchBusStop>();
  for (const stop of publishedBusStops) {
    if (stop.simulatedPosition || !validPoint(stop.position)) continue;
    const previous = stops.get(stop.id);
    // A feed stop ID identifies the boarding point. Names and proximity cannot identify platforms.
    if (previous && (previous.position[0] !== stop.position[0] || previous.position[1] !== stop.position[1])) continue;
    const routes = new Map([...(previous?.routes ?? []), ...stop.routes].map(route => [route.id, route]));
    stops.set(stop.id, { ...stop, routes: [...routes.values()] });
  }
  const busStops = [...stops.values()];
  const brtSourceIds = new Set(rapidBusBrtStopIds.values());
  const brtAliases = new Map(busStops.filter(stop => brtSourceIds.has(stop.sourceId) && stop.id === `bus-stop:rapid-bus-kl:${stop.sourceId}` &&
    stop.routes.some(route => route.id === "B1000")).map(stop => [stop.sourceId, stop]));
  const entities = transitSearchEntities(network, busStops);
  return entities.flatMap<NearbyCandidate>(entity => {
    if (entity.type === "BUS_STOP") return entity.routes.length ? [entity] : [];
    const anchor = railStationAnchor(entity.record) ??
      entity.record.stationProvenance?.find(stop => stop.routeId === brtSunway.id);
    if (!anchor || anchor.position[0] !== entity.position[0] || anchor.position[1] !== entity.position[1]) return [];
    if (!entity.routes.some(route => route.id === brtSunway.id)) return [entity];
    const routes = new Map(entity.routes.map(route => [route.id, route]));
    for (const sourceId of entity.sourceIds) {
      for (const route of brtAliases.get(sourceId)?.routes ?? []) {
        if (route.id !== "B1000") routes.set(route.id, route);
      }
    }
    return [{ ...entity, routes: [...routes.values()] }];
  });
}

export function rankNearbyTransit(candidates: readonly NearbyCandidate[], origin: GeoPoint, radiusM = NEARBY_RADIUS_M) {
  if (!validPoint(origin)) return [];
  return candidates.flatMap(candidate => {
    const metres = distanceM(origin, candidate.position);
    return metres <= radiusM ? [{ candidate, metres }] : [];
  }).sort((a, b) => a.metres - b.metres || a.candidate.id.localeCompare(b.candidate.id));
}

export function formatNearbyDistance(metres: number) {
  return metres < 1000 ? `${Math.min(999, Math.round(metres))} m` : `${(metres / 1000).toFixed(1).replace(/\.0$/, "")} km`;
}

export function poorLocationAccuracy(accuracyM: number) {
  return accuracyM > 100;
}

export function formatRecommendationDistance(metres: number, accuracyM: number) {
  if (!poorLocationAccuracy(accuracyM)) return formatNearbyDistance(metres);
  const increment = 10 ** Math.floor(Math.log10(accuracyM));
  if (metres < increment) return `< ${formatNearbyDistance(increment)}`;
  return `~${formatNearbyDistance(Math.round(metres / increment) * increment)}`;
}
