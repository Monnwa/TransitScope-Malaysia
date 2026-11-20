import { describe, expect, it } from "vitest";
import { expandedServiceById, brtSunway } from "@/lib/expanded-services";
import { distanceM, projectCandidates, validPoint } from "@/lib/route-projection";
import { simulationSnapshot } from "@/lib/simulation";
import { EPOCH } from "@/lib/simulation/clock";
import { busRoutes, busStops, railNetwork, railRoutes } from "@/lib/simulation/network";
import { busJourney, stationArrivals } from "@/lib/simulation/vehicles";
import { buildStationSearchIndex, findStations, resolveAlertStations, resolveExactStation } from "@/lib/station-search";
import { transportTypeFilter } from "@/lib/transport-type-filter";
import { micromobilitySnapshot } from "@/lib/micromobility-data";

const byId = new Map([...railRoutes, ...busRoutes].map(route => [route.id, route]));
const ekspres = "erl-klia-ekspres";
const transit = "erl-klia-transit";
const shahAlam = "lrt-shah-alam";
const brt = "brt-sunway";
const snapshot = simulationSnapshot(EPOCH);
const index = buildStationSearchIndex(railNetwork, [{
  id: "bus-stop:rapid-bus-kl:1005840", sourceId: "1005840", name: "STESEN BRT SETIA JAYA",
  operator: "Prasarana", feed: "Rapid Bus", position: [3.082856, 101.612238],
  aliases: [], routes: [{ id: "B1000", name: "SUNWAY LINE" }],
}], micromobilitySnapshot().stations);

describe("published service expansion", () => {
  it.each([
    [ekspres, "ERL KLIA Ekspres Line", "ERL", "#7946A3", "KE01 KE02 KE03"],
    [transit, "ERL KLIA Transit Line", "ERL", "#008B8B", "KT01 KT02 KT03 KT04 KT05 KT06"],
    [shahAlam, "LRT Shah Alam Line", "LRT", "#59B8E6",
      "SA1 SA2 SA3 SA5 SA6 SA7 SA9 SA10 SA12 SA14 SA15 SA17 SA18 SA19 SA20 SA21 SA22 SA23 SA24 SA26"],
    [brt, "BRT Sunway Line", "Bus", "#115740", "BRT1 BRT2 BRT3 BRT4 BRT5 BRT6 BRT7"],
  ])("preserves both directions, service stops and geography for %s", (id, name, mode, colour, codes) => {
    const route = byId.get(id)!;
    const meta = expandedServiceById.get(id)!;
    expect(route).toMatchObject({ id, name, mode, colour });
    expect(meta.classification).toBe(mode === "Bus" ? "BRT" : mode);
    expect(route.legs[0].stops.map(stop => stop.id)).toEqual(codes.split(" "));
    expect(route.legs[1].stops.map(stop => stop.id)).toEqual(codes.split(" ").reverse());
    expect(route.legs[0].shape.path).toBe(meta.paths[0]);
    expect(route.legs[1].shape.path).toBe(meta.paths[1]);
    for (const stop of meta.stops) {
      expect(validPoint(stop.position)).toBe(true);
      expect(stop.position[0]).toBeGreaterThan(2.7);
      expect(stop.position[0]).toBeLessThan(3.2);
      expect(stop.position[1]).toBeGreaterThan(101.4);
      expect(stop.position[1]).toBeLessThan(101.75);
      for (const leg of route.legs) expect(projectCandidates(leg.shape, stop.position, 100).length).toBeGreaterThan(0);
      const canonical = railNetwork.stations.filter(record => record.stationProvenance?.some(entry => entry.code === stop.id));
      expect(canonical).toHaveLength(1);
      const [station] = canonical;
      expect(station.railLines).toContain(id);
      expect(findStations(index, stop.id)[0]?.id).toBe(station.id);
      expect(findStations(index, stop.name)[0]?.id).toBe(station.id);
      expect(findStations(index, stop.name.slice(0, Math.max(4, stop.name.length - 2))).some(result => result.id === station.id)).toBe(true);
      expect(resolveExactStation(stop.id, railNetwork)?.id).toBe(station.id);
      expect(resolveAlertStations(index, [stop.name], [id])[0]?.id).toBe(station.id);
      expect(stationArrivals([`sim:${id}:${stop.id}`], EPOCH).every(visit =>
        visit.routeId === id && visit.dataMode === "SIMULATED")).toBe(true);
    }
  });

  it.each([
    ["KE01", ["LRT-KJ", "MONORAIL", "KTM:KA15_KD19", "KTM:KC05_KB18", ekspres, transit]],
    ["KT02", ["LRT-PH", "KTM:KC05_KB18", transit]],
    ["KT03", ["MRT2", transit]],
    ["KE02", [ekspres, transit]], ["KE03", [ekspres, transit]],
    ["SA1", ["MRT1", shahAlam]], ["SA7", ["LRT-KJ", shahAlam]],
    ["BRT1", ["KTM:KA15_KD19", brt]], ["BRT7", ["LRT-KJ", brt]],
  ] as const)("has one complex with the published line links for %s", (code, lines) => {
    const record = resolveExactStation(code, railNetwork)!;
    expect(record.interchange).toBe(true);
    expect(record.railLines).toEqual(lines);
    expect(resolveAlertStations(index, [code], lines).map(station => station.id)).toEqual([record.id]);
  });

  it("uses the same ERL corridor while keeping independent stopping patterns and fleets", () => {
    const express = byId.get(ekspres)!;
    const local = byId.get(transit)!;
    const localOnly = ["Bandar Tasik Selatan", "Putrajaya & Cyberjaya", "Salak Tinggi"];
    expect(express.legs.map(leg => leg.shape.path)).toEqual(local.legs.map(leg => leg.shape.path));
    for (const time of [EPOCH, EPOCH + express.legs[0].duration, EPOCH + local.legs[0].duration]) {
      for (const train of simulationSnapshot(time).trains.filter(item => item.mode === "ERL")) {
        expect(train.dataMode).toBe("SIMULATED");
        if (train.lineId === ekspres) for (const stop of [train.previousStation, train.nearStation, train.nextStation]) {
          expect(localOnly).not.toContain(stop?.name);
        }
      }
    }
  });

  it("uses the bus journey layer and serves seven stops on each leg", () => {
    const route = byId.get(brt)!;
    for (const time of [EPOCH, EPOCH + route.legs[0].duration]) {
      const bus = busJourney("bus:brt-sunway:01", time)!;
      expect(bus.vehicle.mode).toBe("Bus");
      expect(bus.routeName).toBe(brtSunway.name);
      expect(bus.dataMode).toBe("SIMULATED");
      expect(bus.stops.map(stop => stop.id)).toEqual(route.legs[bus.direction].stops.map(stop => stop.id));
      expect(bus.stops.every(stop => stop.classification === "SIMULATED")).toBe(true);
    }
    const [out, inbound] = route.legs;
    expect(distanceM(out.stops.at(-1)!.position, inbound.stops[0].position)).toBeLessThan(1);
    expect(snapshot.trains.some(train => train.lineId === brt)).toBe(false);
    expect(findStations(index, "1005840").map(result => result.id)).toEqual([resolveExactStation("BRT1", railNetwork)?.id]);
  });

  it("keeps unique station and route counts, and restricts BRT to the selected bus route", () => {
    expect(byId.size).toBe(14);
    expect(railNetwork.stations).toHaveLength(199);
    expect(new Set(railNetwork.stations.map(station => station.id)).size).toBe(199);
    expect(new Set(busStops.map(stop => stop.stopRefs?.[0].split(":").at(-1))).size).toBe(78);
    expect(snapshot.records.filter(record => record.recordKind === "vehicle")).toHaveLength(145);
    expect(index).toHaveLength(274);
    const onlyBrt = transportTypeFilter(railNetwork, ["Bus"], brt);
    expect(snapshot.records.filter(onlyBrt.showsRecord)).toHaveLength(11);
    expect(onlyBrt.railLines).toHaveLength(0);
    expect(snapshot.records.filter(transportTypeFilter(railNetwork, ["Bus"], "").showsRecord)).toHaveLength(100);
    expect(snapshot.records.filter(transportTypeFilter(railNetwork, [], brt).showsRecord)).toHaveLength(0);
  });
});
