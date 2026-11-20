import { describe, expect, it } from "vitest";
import { indexGtfsBusStops } from "@/lib/bus-stop-search";
import { micromobilitySnapshot } from "@/lib/micromobility-data";
import { buildTimetable } from "@/lib/scheduled-departures";
import { railNetwork } from "@/lib/simulation/network";
import { buildStationSearchIndex, findStations, showMicromobilityMarker } from "@/lib/station-search";

const station = { stop_id: "12003043", stop_name: "MRT TAMAN MIDAH PINTU A", stop_lat: "3.1055319", stop_lon: "101.7315913" };
const table = buildTimetable({
  stops: [
    { ...station, stop_code: "MIDAH-A", stop_city: "Cheras" },
    { ...station, stop_id: "A", stop_name: "Pasar Seni" },
    { ...station, stop_id: "B", stop_name: "Pasar Seni", stop_lat: "3.145" },
    { ...station, stop_id: "C", stop_name: "Unscheduled stop" },
    { ...station, stop_id: "D", stop_lat: "" },
    { ...station, stop_id: "E", location_type: "2" },
  ],
  routes: [{ route_id: "T401", route_short_name: "T401" }, { route_id: "T402", route_short_name: "T402" }],
  trips: [{ trip_id: "one", route_id: "T401" }, { trip_id: "two", route_id: "T402" }],
  stopTimes: [
    { trip_id: "one", stop_id: station.stop_id, pickup_type: "1" },
    { trip_id: "two", stop_id: station.stop_id }, { trip_id: "one", stop_id: "A" },
  ],
  calendars: [], exceptions: [], frequencies: [], source: "test fixture", mode: () => "Bus",
});
const source = { id: "rapid-bus-mrtfeeder", label: "MRT Feeder Bus", operator: "Prasarana" };
const stops = indexGtfsBusStops(table, source);
const { stations } = micromobilitySnapshot();
const index = buildStationSearchIndex(railNetwork, stops, stations);
const search = (query: string) => findStations(index, query);

describe("universal station index", () => {
  it("preserves exact and partial rail behavior, aliases and interchange lines", () => {
    const [trx] = search(" Tun  Razak Exchange ");
    expect(trx).toMatchObject({ type: "RAIL_STATION", name: "Tun Razak Exchange" });
    expect(trx.routes.map(route => route.id)).toEqual(["MRT1", "MRT2"]);
    expect(search("tun raz")).toContain(trx);
    expect(search("MRT, Tun Razak Exchange Station")[0]).toBe(trx);
    expect(search("TBS")[0].name).toBe("Bandar Tasik Selatan");
  });

  it("uses GTFS relationships without pickup times, current service or GPS", () => {
    expect(stops.map(stop => stop.sourceId)).toEqual([station.stop_id, "A", "B", "C"]);
    expect(search(" 12003043 ")[0]).toMatchObject({ type: "BUS_STOP", sourceIds: [station.stop_id],
      position: [3.1055319, 101.7315913], area: "Cheras", routes: [{ id: "T401", name: "T401" }, { id: "T402", name: "T402" }] });
    expect(search("T401").map(item => item.name)).toEqual(["MRT TAMAN MIDAH PINTU A", "Pasar Seni"]);
    expect(search("T402").map(item => item.name)).toEqual(["MRT TAMAN MIDAH PINTU A"]);
    expect(search("MRT Feeder Bus")).toHaveLength(4);
    expect(search("midah-a")[0]).toBe(search(station.stop_id)[0]);
    expect(search("cheras")).toContain(search(station.stop_id)[0]);
  });

  it("keeps identical names and original IDs separate across locations and modes", () => {
    const exact = search("pasar seni").filter(item => item.name === "Pasar Seni");
    expect(exact.map(item => item.type).sort()).toEqual(["BUS_STOP", "BUS_STOP", "RAIL_STATION"]);
    expect(new Set(exact.map(item => item.id)).size).toBe(3);
    const anotherFeed = indexGtfsBusStops(table, { ...source, id: "rapid-bus-kl" });
    expect(buildStationSearchIndex(railNetwork, [...stops, ...anotherFeed], stations)).toHaveLength(
      railNetwork.stations.length + stops.length * 2 + stations.length);
  });

  it.each([["LINKBIKE", "LinkBike"], ["HELLORIDE", "HelloRide"], ["TRYKE", "TRYKE"], ["BEAM", "Beam"]] as const)(
    "preserves %s coordinates, inventory and provenance", (operator, query) => {
      const station = stations.find(item => item.operator === operator)!;
      const entity = search(station.id)[0];
      expect(entity).toMatchObject({ type: "MICROMOBILITY_STATION", sourceIds: [station.id], station,
        position: [station.latitude, station.longitude] });
      expect(search(station.name)).toContain(entity);
      expect(search(query).filter(item => item.type === "MICROMOBILITY_STATION" && item.station.operator === operator))
        .toHaveLength(stations.filter(item => item.operator === operator).length);
    });

  it("normalizes locality and limits broad matches", () => {
    expect(search("  george,   town  ").some(item => item.type === "MICROMOBILITY_STATION" && item.area === "George Town")).toBe(true);
    expect(search("a")).toHaveLength(15);
    expect(search("  ")).toEqual([]);
    expect(search("zzzz no matching station zzzz")).toEqual([]);
  });
});

describe("micromobility search marker visibility", () => {
  it.each([
    [false, false, true],
    [false, true, true],
    [true, false, false],
    [true, true, true],
  ])("with search active=%s and selected=%s, marker visible=%s", (active, selected, visible) => {
    expect(showMicromobilityMarker(active, selected)).toBe(visible);
  });
});
