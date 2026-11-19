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

describe("T401/T402 scope reduction", () => {
  it("preserves the four deterministic bus journeys across six fixed ticks", () => {
    for (const tick of evidence.after.proof) {
      const buses = simulationSnapshot(tick.now).records.filter(record => record.mode === "Bus" && record.recordKind === "vehicle");
      expect(buses.map(bus => bus.id)).toEqual(activeIds);
      expect(hash(buses.map(bus => busJourney(bus.id, tick.now)))).toBe(tick.bus);
    }
  });

  it("preserves rail, its departure previews, alerts and LinkBike from the frozen baseline", () => {
    for (const tick of evidence.before.proof) {
      const snapshot = simulationSnapshot(tick.now);
      expect(hash(historicalRailColours({
        railNetwork, trains: snapshot.trains, linkBike: snapshot.linkBike,
        railAlerts: snapshot.alerts.filter(alert => !alert.modes.includes("Bus")),
        railArrivals: railNetwork.stations.map(stop => stationArrivals(stop.stopRefs!, tick.now)),
      }))).toBe(tick.railAndLinkBike);
    }
  });

  it("returns only the retained simulated bus data through the active adapters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const fetch = vi.fn(() => { throw new Error("Unexpected external request"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const response = await getTransit(request("/api/transit?mode=live"));
      const { records, feeds } = await response.json() as ReturnType<typeof simulationSnapshot>;
      const busRecords = records.filter(record => record.mode === "Bus");
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
