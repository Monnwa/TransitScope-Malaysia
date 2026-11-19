import type { RailNetwork } from "./rail-model";
import { validPoint } from "./route-projection";
import type { Record as TransitRecord } from "./transit-data";
import { stationAliases, stationKey } from "./station-operations";

export type StationSearchRequest = { stationId: string; revision: number };
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
