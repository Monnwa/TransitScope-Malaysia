import { describe, expect, it } from "vitest";
import type { SearchBusStop } from "@/lib/bus-stop-search";
import { brtSunway } from "@/lib/expanded-services";
import { formatNearbyDistance, formatRecommendationDistance, nearbyTransitCandidates, poorLocationAccuracy, rankNearbyTransit } from "@/lib/nearby-transit";
import { distanceM, type GeoPoint } from "@/lib/route-projection";
import { railNetwork } from "@/lib/simulation/network";

const bus = (id: string, position: GeoPoint, routes = [{ id: "T401", name: "T401" }]): SearchBusStop => ({
  id: `bus-stop:rapid-bus-kl:${id}`, sourceId: id, position, name: "Same stop name",
  feed: "Rapid KL Bus", operator: "Prasarana", aliases: [], routes,
});
const noRail = { ...railNetwork, stations: [] };

describe("nearby public transport", () => {
  it("uses Haversine metres, including across the antimeridian", () => {
    expect(distanceM([3.139, 101.687], [3.139, 101.687])).toBe(0);
    expect(distanceM([0, 0], [0, 1])).toBeCloseTo(111195.08, 2);
    expect(distanceM([0, 179.5], [0, -179.5])).toBeCloseTo(111195.08, 2);
    expect(distanceM([3.139, 101.687], [3.149, 101.687])).toBeCloseTo(1111.95, 2);
  });

  it.each([[350, "350 m"], [999.9, "999 m"], [1000, "1 km"], [1211, "1.2 km"]] as const)(
    "formats %d metres as %s", (metres, expected) => expect(formatNearbyDistance(metres)).toBe(expected));

  it("ranks strictly by distance and excludes stops outside the configured radius", () => {
    const candidates = nearbyTransitCandidates(noRail, [bus("far", [0.04, 0]), bus("mid", [0.02, 0]), bus("near", [0, 0.005])]);
    expect(rankNearbyTransit(candidates, [0, 0]).map(item => item.candidate.sourceIds[0])).toEqual(["near", "mid"]);
    expect(rankNearbyTransit(candidates, [0, 0], 600).map(item => item.candidate.sourceIds[0])).toEqual(["near"]);
    expect(rankNearbyTransit(candidates, [NaN, 0])).toEqual([]);
  });

  it("groups associated routes by physical stop ID and preserves distinct boarding points", () => {
    const stop = bus("one", [3.1, 101.7]);
    const candidates = nearbyTransitCandidates(noRail, [stop, bus("two", stop.position),
      { ...stop, routes: [...stop.routes, { id: "T402", name: "T402" }] }]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].routes.map(route => route.id)).toEqual(["T401", "T402"]);
    expect(candidates[1].sourceIds).toEqual(["two"]);
  });

  it("uses corrected rail anchors and preserves canonical interchanges and separate Salak Selatan stations", () => {
    const candidates = nearbyTransitCandidates(railNetwork, []);
    expect(candidates.filter(candidate => candidate.name === "Salak Selatan")).toHaveLength(2);
    const trx = candidates.find(candidate => candidate.name === "Tun Razak Exchange");
    expect(trx?.routes.map(route => route.id)).toEqual(["MRT1", "MRT2"]);
    expect(trx?.position).toEqual(railNetwork.stations.find(station => station.id === trx?.id)?.position);
    expect(new Set(candidates.flatMap(candidate => candidate.routes.map(route => route.id)))).toEqual(
      new Set([...railNetwork.lines.map(line => line.id), brtSunway.id]));
  });

  it("reuses the BRT platform and retains additional route labels from its known GTFS alias", () => {
    const candidates = nearbyTransitCandidates(railNetwork, [bus("1005840", [3.1, 101.6], [
      { id: "B1000", name: "B1000" }, { id: "other", name: "Other bus" },
    ])]);
    const matching = candidates.filter(item => item.sourceIds.includes("1005840"));
    expect(matching).toHaveLength(1);
    expect(matching[0].routes.map(route => route.id)).toEqual(expect.arrayContaining([brtSunway.id, "other"]));
    expect(matching[0].routes.map(route => route.id)).not.toContain("B1000");
  });

  it("excludes invalid, missing, approximate and unserved stops", () => {
    const station = railNetwork.stations.find(item => item.name === "Tun Razak Exchange")!;
    const network = { ...railNetwork, stations: [
      { ...station, position: null }, { ...station, stopRefs: [], stationProvenance: undefined },
    ] };
    const candidates = nearbyTransitCandidates(network, [bus("bad", [91, 0]), bus("nan", [3, NaN]),
      { ...bus("synthetic", [3.1, 101.7]), simulatedPosition: true }, bus("unserved", [3.1, 101.7], [])]);
    expect(candidates).toEqual([]);
  });

  it("warns above 100 m and avoids metre-level precision when accuracy is poor", () => {
    expect(poorLocationAccuracy(100)).toBe(false);
    expect(poorLocationAccuracy(101)).toBe(true);
    expect(formatRecommendationDistance(23, 150)).toBe("< 100 m");
    expect(formatRecommendationDistance(350, 25)).toBe("350 m");
    expect(formatRecommendationDistance(1211, 1500)).toBe("~1 km");
  });
});
