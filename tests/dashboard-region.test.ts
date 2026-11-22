import { describe, expect, it } from "vitest";
import type { SearchBusStop } from "@/lib/bus-stop-search";
import { busStopRegion, klangValleyRoutes, micromobilityRegion, penangBusStops, simulationRecordRegion,
  staticBusRoutes, vehicleCategory } from "@/lib/dashboard-region";
import { EPOCH } from "@/lib/simulation/clock";
import { simulationSnapshot } from "@/lib/simulation";

const stop: SearchBusStop = {
  id: "bus-stop:rapid-bus-penang:255", sourceId: "255", name: "Fixture",
  position: [5.4, 100.3], operator: "Prasarana", feed: "Rapid Penang", aliases: [],
  routes: [{ id: "route-a", name: "101" }],
};

describe("dashboard regions", () => {
  it("assigns known simulated routes and LinkBike IDs and excludes unassigned records", () => {
    const snapshot = simulationSnapshot(EPOCH);
    const bikeIds = new Set(snapshot.linkBike.stations.map(station => station.station_id));
    const vehicles = snapshot.records.filter(record => record.recordKind === "vehicle");
    expect(vehicles.every(vehicle => simulationRecordRegion(vehicle, bikeIds) === "Klang Valley")).toBe(true);
    expect(snapshot.records.filter(record => simulationRecordRegion(record, bikeIds) === "Penang")).toHaveLength(27);
    expect(simulationRecordRegion({ ...vehicles[0], routeId: "unknown", railLines: [] }, bikeIds)).toBeUndefined();
    expect(micromobilityRegion({ state: "Penang" })).toBe("Penang");
    expect(micromobilityRegion({ state: "Putrajaya" })).toBe("Klang Valley");
  });

  it("uses feed identity, merges repeated boarding points and ignores conflicting stop coordinates", () => {
    const unknown = { ...stop, id: "bus-stop:unknown:255" };
    expect(busStopRegion(unknown)).toBeUndefined();
    const merged = penangBusStops([
      stop, { ...stop, routes: [{ id: "route-b", name: "102" }] },
      { ...stop, position: [5.5, 100.4], routes: [{ id: "conflict", name: "103" }] }, unknown,
      { ...stop, id: "bus-stop:rapid-bus-kl:255" }, { ...stop, id: "bus-stop:rapid-bus-penang:256", simulatedPosition: true },
    ]);
    expect(merged.map(item => item.id)).toEqual([stop.id]);
    expect(staticBusRoutes(merged)).toEqual([
      { id: "route-a", name: "101", category: "Bus" }, { id: "route-b", name: "102", category: "Bus" },
    ]);
  });

  it("retains distinct services and classifies BRT vehicles from the BRT route", () => {
    expect(klangValleyRoutes).toHaveLength(14);
    expect(new Set(klangValleyRoutes.map(route => route.id)).size).toBe(14);
    expect(klangValleyRoutes.filter(route => route.category === "ERL").map(route => route.id))
      .toEqual(["erl-klia-ekspres", "erl-klia-transit"]);
    const vehicles = simulationSnapshot(EPOCH).records.filter(record => record.recordKind === "vehicle");
    expect(vehicles.filter(record => vehicleCategory(record) === "BRT")).toHaveLength(4);
    expect(vehicles.filter(record => vehicleCategory(record) === "Bus")).toHaveLength(4);
  });
});
