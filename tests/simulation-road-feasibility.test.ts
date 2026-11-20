import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getAlerts } from "@/app/api/alerts/route";
import { GET as getJourney } from "@/app/api/bus-journey/route";
import { GET as getDepartures } from "@/app/api/departures/route";
import { GET as getTransit } from "@/app/api/transit/route";
import { simulationSnapshot } from "@/lib/simulation";
import { railNetwork, stationServices } from "@/lib/simulation/network";
import { busJourney, stationArrivals } from "@/lib/simulation/vehicles";
import { expandedServiceById } from "@/lib/expanded-services";
import { mergeRailStations } from "@/lib/rail-model";
import evidence from "@/docs/SM-2.3-evidence/snapshot-comparison.json";

const oldRoutes = ["D100", "D200", "D300", "D400", "D500", "D600", "D700", "T801", "T802", "T803", "P101", "P102"];
const activeIds = ["bus:T401:01", "bus:T401:02", "bus:T402:01", "bus:T402:02"];
const now = evidence.before.proof[0].now;
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
// Preserve the historical operational snapshot while allowing the two requested colour corrections.
// Current canonical colours and rendered strokes are asserted in rail-route-style.test.tsx.
const historicalRailColours = (x: unknown) => JSON.parse(JSON.stringify(x, (key, value) =>
  key === "colour" && value === "#8BCB88" ? "#2878B5" : key === "colour" && value === "#8B5A3C" ? "#7651A8" : value));
const request = (path: string) => new NextRequest("http://localhost" + path);
const establishedLines = railNetwork.lines.filter(line => !expandedServiceById.has(line.id));
const establishedStations = railNetwork.stations.flatMap(marker => {
  const original = stationServices.get(marker.stopRefs![0])?.station.position;
  const station = { ...marker, position: original ?? marker.position };
  const lines = station.railLines!.map(id => establishedLines.find(line => line.id === id)).filter(line => line !== undefined);
  if (!lines.length) return [];
  if (!station.stationProvenance?.length) return [station];
  const { stationProvenance, ...legacy } = station;
  const newIds = new Set(stationProvenance.map(item => item.routeId));
  const lineNames = lines.map(line => line.name);
  return [{ ...legacy, railLines: lines.map(line => line.id), lineNames, route: lineNames.join(" · "),
    stopRefs: legacy.stopRefs?.filter(ref => !newIds.has(ref.split(":")[1])),
    source: railNetwork.source, modes: [...new Set(lines.map(line => line.mode))],
    interchange: lines.length > 1, mrtLines: legacy.mrtLines?.length || lines.length > 1 ? legacy.mrtLines : undefined }];
});
// The frozen operational snapshot precedes the published map coordinates and
// treats the two Salak Selatan stops as one record. Restore that representation
// for this hash. Current station identity is tested in rail-station-alignment.
const salak = establishedStations.filter(station => station.name === "Salak Selatan");
const [historicalSalak] = mergeRailStations(salak.map(station => ({
  ...station, id: station.id.replace(/^rail:/, ""), stationComplexId: undefined,
})));
const historicalStations = establishedStations.flatMap(station => station.id === historicalSalak.id
  ? [historicalSalak] : station.name === "Salak Selatan" ? [] : [station]);

describe("T401/T402 scope reduction", () => {
  it("preserves the four deterministic bus journeys across six fixed ticks", () => {
    for (const tick of evidence.after.proof) {
      const buses = simulationSnapshot(tick.now).records.filter(record => activeIds.includes(record.id));
      expect(buses.map(bus => bus.id)).toEqual(activeIds);
      expect(hash(buses.map(bus => busJourney(bus.id, tick.now)))).toBe(tick.bus);
    }
  });

  it("preserves rail, its departure previews, alerts and LinkBike from the frozen baseline", () => {
    for (const tick of evidence.before.proof) {
      const snapshot = simulationSnapshot(tick.now);
      expect(hash(historicalRailColours({
        railNetwork: { lines: establishedLines, stations: historicalStations, available: true,
          source: railNetwork.source, dataMode: railNetwork.dataMode },
        trains: snapshot.trains.filter(train => !expandedServiceById.has(train.lineId)), linkBike: snapshot.linkBike,
        railAlerts: snapshot.alerts.filter(alert => !alert.modes.includes("Bus")),
        railArrivals: historicalStations.map(stop => stationArrivals(stop.stopRefs!, tick.now)),
      }))).toBe(tick.railAndLinkBike);
    }
  });

  it("preserves retained feeder data through the active adapters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const fetch = vi.fn(() => { throw new Error("Unexpected external request"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const response = await getTransit(request("/api/transit?mode=live"));
      const { records, feeds } = await response.json() as ReturnType<typeof simulationSnapshot>;
      const busRecords = records.filter(record => record.mode === "Bus" && record.routeId !== "brt-sunway");
      expect(feeds).toEqual([]);
      expect(busRecords).toHaveLength(89);
      expect(busRecords.filter(bus => bus.recordKind === "vehicle").map(bus => bus.id)).toEqual(activeIds);
      expect(new Set(busRecords.map(bus => bus.routeId))).toEqual(new Set(["T401", "T402"]));
      expect(busRecords.every(bus => bus.dataMode === "SIMULATED")).toBe(true);
      for (const id of activeIds) {
        const journeyResponse = await getJourney(request("/api/bus-journey?vehicle=" + id + "&mode=live"));
        expect(journeyResponse.status).toBe(200);
        const journey = await journeyResponse.json();
        expect(journey).toMatchObject({ routeId: id.split(":")[1], dataMode: "SIMULATED" });
        expect(journey.stops.every((stop: { classification: string }) => stop.classification === "SIMULATED")).toBe(true);
      }
      for (const busStop of busRecords.filter(bus => bus.recordKind === "stop")) {
        const ref = busStop.stopRefs![0];
        expect(stationServices.has(ref)).toBe(true);
        const boardResponse = await getDepartures(request("/api/departures?stop=" + ref));
        expect(boardResponse.status).toBe(200);
        const { arrivals } = await boardResponse.json() as { arrivals: ReturnType<typeof stationArrivals> };
        expect(arrivals).toHaveLength(8);
        expect(arrivals.every(arrival => arrival.routeId === busStop.routeId && arrival.dataMode === "SIMULATED")).toBe(true);
      }
      const { alerts } = await (await getAlerts()).json() as ReturnType<typeof simulationSnapshot>;
      expect(alerts.every(alert => !alert.modes.includes("Bus") && alert.routeIds.every(id => !oldRoutes.includes(id)))).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("rejects every retired vehicle ID and retired stop reference", async () => {
    for (const route of evidence.before.routes) {
      for (let number = 1; number <= route.size; number++) {
        const id = "bus:" + route.id + ":" + String(number).padStart(2, "0");
        expect(busJourney(id, now)).toBeNull();
      }
      expect((await getJourney(request("/api/bus-journey?vehicle=bus:" + route.id + ":01"))).status).toBe(404);
      expect((await getDepartures(request("/api/departures?stop=sim:" + route.id + ":legacy"))).status).toBe(400);
    }
  });
});
