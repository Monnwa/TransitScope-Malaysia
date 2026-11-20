import { describe, expect, it } from "vitest";
import { micromobilitySnapshot } from "@/lib/micromobility-data";
import { stationRailLines } from "@/lib/rail-route-style";
import { simulationSnapshot } from "@/lib/simulation";
import { EPOCH } from "@/lib/simulation/clock";
import { railNetwork } from "@/lib/simulation/network";
import { buildStationSearchIndex } from "@/lib/station-search";
import { DEFAULT_TRANSPORT_TYPES, transportTypeFilter } from "@/lib/transport-type-filter";
import type { Mode } from "@/lib/transit-data";

const routes = {
  MRT: ["MRT1", "MRT2"],
  LRT: ["LRT-KJ", "LRT-AG", "LRT-PH", "lrt-shah-alam"],
  Monorail: ["MONORAIL"],
  KTM: ["KTM:KA15_KD19", "KTM:KC05_KB18"],
  ERL: ["erl-klia-ekspres", "erl-klia-transit"],
};
const snapshot = simulationSnapshot(EPOCH);
const cases: [Mode[], string[]][] = [
  [["MRT"], routes.MRT],
  [["LRT"], routes.LRT],
  [["Monorail"], routes.Monorail],
  [["KTM"], routes.KTM],
  [["ERL"], routes.ERL],
  [["Bus"], []],
  [["Shared bike"], []],
  [["MRT", "Shared bike"], routes.MRT],
  [["Bus", "Shared bike"], []],
  [["MRT", "LRT"], [...routes.MRT, ...routes.LRT]],
  [DEFAULT_TRANSPORT_TYPES, Object.values(routes).flat()],
  [[], []],
];

describe("dashboard transport types", () => {
  it("defaults to all seven types", () => {
    expect(DEFAULT_TRANSPORT_TYPES).toEqual(["Bus", "MRT", "LRT", "Monorail", "KTM", "ERL", "Shared bike"]);
  });

  it.each(cases)("matches exactly the selected types %j", (types, expectedRoutes) => {
    const filter = transportTypeFilter(railNetwork, types, "");
    expect(new Set(filter.railLines.map(line => line.id))).toEqual(new Set(expectedRoutes));
    const visible = snapshot.records.filter(filter.showsRecord);
    expect(visible.some(record => record.mode === "Bus")).toBe(types.includes("Bus"));
    expect(visible.filter(record => record.mode === "Shared bike")).toHaveLength(types.includes("Shared bike") ? 27 : 0);
    for (const train of snapshot.trains) {
      expect(visible.includes(train)).toBe(expectedRoutes.includes(train.lineId));
    }
    for (const station of railNetwork.stations) {
      expect(visible.includes(station)).toBe(station.railLines!.some(id =>
        expectedRoutes.includes(id) || id === "brt-sunway" && types.includes("Bus")));
    }
    if (!types.length) expect(visible).toEqual([]);
  });

  it("narrows only Bus when a bus route is selected and prevents a disabled route from appearing", () => {
    const filter = transportTypeFilter(railNetwork, ["Bus", "MRT"], "T401");
    const bus = snapshot.records.filter(filter.showsRecord).filter(record => record.mode === "Bus");
    expect(new Set(bus.map(record => record.routeId))).toEqual(new Set(["T401"]));
    expect(bus.some(record => record.recordKind === "stop")).toBe(true);
    expect(bus.some(record => record.recordKind === "vehicle")).toBe(true);
    expect(filter.railLines.map(line => line.id)).toEqual(routes.MRT);
    expect(transportTypeFilter(railNetwork, ["MRT"], "T401").showsBusRoute("T401")).toBe(false);
  });

  it("keeps an interchange on either selected line without reviving hidden lines", () => {
    const interchange = railNetwork.stations.find(station => station.name === "Pasar Seni")!;
    const mrt = transportTypeFilter(railNetwork, ["MRT"], "");
    const both = transportTypeFilter(railNetwork, ["MRT", "LRT"], "");
    expect(mrt.showsRecord(interchange)).toBe(true);
    expect(stationRailLines(interchange, mrt.railLines)).toEqual(["MRT1"]);
    expect(stationRailLines(interchange, both.railLines)).toEqual(["MRT1", "LRT-KJ"]);
    expect(transportTypeFilter(railNetwork, ["LRT"], "").showsRecord(interchange)).toBe(true);
  });

  it("keeps all micromobility locations searchable with all map categories off", () => {
    const filter = transportTypeFilter(railNetwork, [], "");
    const index = buildStationSearchIndex(railNetwork, [], micromobilitySnapshot().stations);
    const bikes = index.filter(({ entity }) => entity.type === "MICROMOBILITY_STATION");
    expect(filter.sharedBike).toBe(false);
    expect(bikes).toHaveLength(75);
    expect(new Set(bikes.map(({ entity }) => entity.operator))).toEqual(new Set(["LinkBike", "HelloRide", "TRYKE", "Beam Mobility"]));
  });
});
