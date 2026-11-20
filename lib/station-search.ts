import type { RailNetwork } from "./rail-model";
import { validPoint } from "./route-projection";
import type { Record as TransitRecord } from "./transit-data";
import { stationAliases, stationKey } from "./station-operations";
import type { SearchBusStop } from "./bus-stop-search";
import { OPERATOR_STYLE, type MicromobilityOperator, type MicromobilityStation } from "./micromobility";
import type { GeoPoint } from "./route-projection";

export type StationSearchRequest = { stationId: string; revision: number } & (
  | { type?: "RAIL_STATION" }
  | { type: "BUS_STOP"; stop: SearchBusStop }
  | { type: "MICROMOBILITY_STATION"; operator: MicromobilityOperator }
);

type SearchEntityFields = {
  id: string;
  sourceIds: string[];
  name: string;
  position: GeoPoint;
  operator: string;
  area?: string;
  state?: string;
  aliases: string[];
  routes: { id: string; name: string }[];
};
export type SearchEntity = SearchEntityFields & (
  | { type: "RAIL_STATION"; record: TransitRecord }
  | { type: "BUS_STOP"; stop: SearchBusStop }
  | { type: "MICROMOBILITY_STATION"; station: MicromobilityStation }
);

const normalise = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const operatorQueries = new Set(Object.entries(OPERATOR_STYLE).flatMap(([id, style]) => [normalise(id), normalise(style.name)]));
type IndexedStation = {
  entity: SearchEntity;
  ids: string[];
  name: string;
  aliases: string[];
  localities: string[];
  service: string[];
};

export function buildStationSearchIndex(network: RailNetwork, busStops: SearchBusStop[], micromobility: MicromobilityStation[]) {
  const rail: SearchEntity[] = network.stations.flatMap(record => {
    if (!validPoint(record.position)) return [];
    return [{
      type: "RAIL_STATION", id: record.id, sourceIds: record.stopRefs ?? [], name: record.name,
      position: record.position, operator: record.operator, aliases: stationAliases(record), record,
      routes: network.lines.filter(line => record.railLines?.includes(line.id)).map(line => ({ id: line.id, name: line.name })),
    }];
  });
  const buses: SearchEntity[] = busStops.filter(stop => validPoint(stop.position)).map(stop => ({
    ...stop, type: "BUS_STOP", sourceIds: [stop.sourceId], stop,
  }));
  const bikes: SearchEntity[] = micromobility.flatMap(station => {
    const position: GeoPoint = [station.latitude, station.longitude];
    if (!validPoint(position)) return [];
    return [{
      type: "MICROMOBILITY_STATION", id: `${station.operator}:${station.id}`, sourceIds: [station.id],
      name: station.name, position, operator: OPERATOR_STYLE[station.operator].name, area: station.area,
      state: station.state, aliases: [], routes: [], station,
    }];
  });
  const index = new Map<string, IndexedStation>();
  for (const entity of [...rail, ...buses, ...bikes]) {
    index.set(`${entity.type}:${entity.id}`, {
      entity,
      ids: [entity.id, ...entity.sourceIds, ...(entity.type === "RAIL_STATION" ?
        entity.sourceIds.map(id => id.split(":").at(-1)!) : [])].map(normalise),
      name: normalise(entity.name),
      aliases: entity.aliases.map(normalise),
      localities: [entity.area, entity.state].flatMap(value => value ? [normalise(value)] : []),
      service: [entity.operator, ...(entity.type === "BUS_STOP" ? [entity.stop.feed] : []),
        ...entity.routes.flatMap(route => [route.id, route.name])].map(normalise),
    });
  }
  return [...index.values()];
}

export function findStations(index: IndexedStation[], query: string): SearchEntity[] {
  const key = normalise(query);
  if (!key) return [];
  const railKey = stationKey(query);
  const ranked: { entity: SearchEntity; rank: number }[] = [];
  for (const { entity, ids, name, aliases, localities, service } of index) {
    const aliasKey = entity.type === "RAIL_STATION" ? railKey : key;
    let rank: number;
    if (ids.includes(key)) rank = 0;
    else if (name === key) rank = 1;
    else if (aliasKey && aliases.includes(aliasKey)) rank = 2;
    else if (name.startsWith(key) || (aliasKey && aliases.some(alias => alias.startsWith(aliasKey)))) rank = 3;
    else if (name.includes(key) || (aliasKey && aliases.some(alias => alias.includes(aliasKey)))) rank = 4;
    else if (localities.some(locality => locality.includes(key))) rank = 5;
    else if (service.includes(key)) rank = 6;
    else if (service.some(value => value.includes(key))) rank = 7;
    else continue;
    ranked.push({ entity, rank });
  }
  const limit = operatorQueries.has(key) ? 30 : 15;
  return ranked.sort((a, b) => a.rank - b.rank || a.entity.name.localeCompare(b.entity.name) || a.entity.id.localeCompare(b.entity.id))
    .slice(0, limit).map(({ entity }) => entity);
}

/** An active search hides ordinary markers and keeps the selected result visible. */
export function showMicromobilityMarker(searchActive: boolean, selected: boolean) {
  return !searchActive || selected;
}
export const STATION_SEARCH_COMPLETION_MS = 350;

export const normaliseSearchText = (query: string) => query.normalize("NFKC").trim().replace(/\s+/g, " ");

/** Reuse station naming/alias conventions; an ambiguous name never becomes a camera command. */
export function resolveExactStation(query: string, network: RailNetwork): TransitRecord | undefined {
  const key = stationKey(query);
  if (!key) return;
  const matches = network.stations.filter(station => stationAliases(station).includes(key));
  return matches.length === 1 ? resolveStationResult(matches[0], network) : undefined;
}

/** Results already use the network's merged identities. Never resolve by name or proximity. */
export function resolveStationResult(result: TransitRecord, network: RailNetwork): TransitRecord | undefined {
  if (result.recordKind !== "stop" || !["MRT", "LRT", "Monorail", "KTM"].includes(result.mode)) return;
  const matches = network.stations.filter(station => station.id === result.id);
  if (matches.length !== 1) return;
  const station = matches[0];
  return station.recordKind === "stop" && validPoint(station.position) ? station : undefined;
}
