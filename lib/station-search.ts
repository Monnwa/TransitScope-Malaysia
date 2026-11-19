import type { RailNetwork } from "./rail-model";
import { validPoint } from "./route-projection";
import type { Record as TransitRecord } from "./transit-data";

export type StationSearchRequest = { stationId: string; revision: number };

/** Results already use the network's merged identities. Never resolve by name or proximity. */
export function resolveStationResult(result: TransitRecord, network: RailNetwork): TransitRecord | undefined {
  if (result.recordKind !== "stop" || !["MRT", "LRT", "Monorail", "KTM"].includes(result.mode)) return;
  const matches = network.stations.filter(station => station.id === result.id);
  if (matches.length !== 1) return;
  const station = matches[0];
  return station.recordKind === "stop" && validPoint(station.position) ? station : undefined;
}
