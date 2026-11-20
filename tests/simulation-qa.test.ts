import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { distanceM, pointAtDistance } from "@/lib/route-projection";
import { busRoutes, stationServices } from "@/lib/simulation/network";
import { busJourney, stationArrivals } from "@/lib/simulation/vehicles";
import { GET as getDepartures } from "@/app/api/departures/route";

const origin = Date.UTC(2026, 10, 14, 4);
const headway = 30 * 60_000;
const ref = (route: string, stop: string) => "sim:" + route + ":" + stop;

const feederRoutes = busRoutes.filter(route => route.id === "T401" || route.id === "T402");

describe("feeder QA boundary states", () => {
  it.each(feederRoutes)("preserves the timed path, stop state and ETA across both seams for $id", route => {
    const [out, back] = route.legs;
    const id = "bus:" + route.id + ":01";
    const splitArrival = origin + out.stops.at(-1)!.arrival;
    const splitDeparture = origin + out.duration;
    const originArrival = splitDeparture + back.stops.at(-1)!.arrival;
    const rollover = origin + route.period;
    const samples = [
      [origin - 1, 1, "CURRENT"],
      [origin, 0, "PASSED"],
      [origin + 1, 0, "PASSED"],
      [splitArrival - 1, 0, "UPCOMING"],
      [splitArrival, 0, "CURRENT"],
      [splitDeparture - 1, 0, "CURRENT"],
      [splitDeparture, 1, "PASSED"],
      [splitDeparture + 1, 1, "PASSED"],
      [originArrival - 1, 1, "UPCOMING"],
      [originArrival, 1, "CURRENT"],
      [rollover - 1, 1, "CURRENT"],
      [rollover, 0, "PASSED"],
      [rollover + 1, 0, "PASSED"],
    ] as const;
    const journeys = samples.map(([now, direction, status]) => {
      const j = busJourney(id, now)!;
      const leg = route.legs[direction];
      expect(j.currentJourneyId).toBe(j.vehicle.tripId);
      expect(j.direction).toBe(direction);
      expect(j.path).toEqual(leg.shape.path);
      expect(j.position).toEqual(pointAtDistance(leg.shape, j.progress * leg.shape.lengthM).point);
      expect(j.vehicle.speed).toBeGreaterThanOrEqual(0);
      expect(j.vehicle.speed).toBeLessThanOrEqual(45);
      const stop = now === origin || now === origin + 1 || now === splitDeparture || now === splitDeparture + 1 ||
        now >= rollover ? j.stops[0] : j.stops.at(-1)!;
      expect(stop.status).toBe(status);
      const next = j.stops.find(item => item.status === "UPCOMING");
      expect(j.nextArrival).toBe(next ? Date.parse(next.arrival) : null);
      if (next) expect(Number.isFinite(j.nextArrival) && j.nextArrival! >= now).toBe(true);
      return j;
    });
    for (const [before, after] of [[0, 1], [3, 4], [5, 6], [8, 9], [10, 11]]) {
      expect(distanceM(journeys[before].position, journeys[after].position)).toBeLessThan(0.013);
    }
  });

  it.each(feederRoutes)("keeps departures due at rollover, but removes them after the departure for $id", route => {
    const stopRef = ref(route.id, route.legs[0].stops[0].id);
    for (let cycle = 0; cycle < 4; cycle++) {
      const due = origin + cycle * headway;
      const before = stationArrivals([stopRef], due - 1);
      const at = stationArrivals([stopRef], due);
      const after = stationArrivals([stopRef], due + 1);
      expect(at[0]).toEqual(before[0]);
      expect(at[0].departureTimestamp).toBe(due);
      expect(after[0].departureTimestamp).toBe(due + headway);
      expect(new Set(at.map(visit => visit.tripId)).size).toBe(8);
      expect(at.map(visit => visit.departureTimestamp)).toEqual(Array.from({ length: 8 }, (_, i) => due + i * headway));
    }
  });

  it("sorts combined boards by the displayed bus departure time", () => {
    const rows = stationArrivals([ref("T402", "12003043"), ref("T401", "12001343")], origin - 5 * 60_000);
    expect(rows.slice(0, 3).map(visit => [visit.routeId, visit.departureTimestamp - origin])).toEqual([
      ["T402", 0], ["T401", 1_252_000], ["T402", headway],
    ]);
    expect(rows.map(visit => visit.departureTimestamp)).toEqual(rows.map(visit => visit.departureTimestamp).sort((a, b) => a - b));
  });

  it("offers only valid upcoming same-route previews and returns to the active journey when one expires", () => {
    const id = "bus:T401:01";
    const now = origin - 1;
    const current = busJourney(id, now)!;
    for (const option of current.departures) {
      const preview = busJourney(id, now, option.vehicleId, option.arrivalTimestamp)!;
      expect(preview).toMatchObject({ isPreview: true, journeyId: option.tripId, currentJourneyId: current.currentJourneyId });
      expect(preview.stops.every(stop => stop.status === "UPCOMING")).toBe(true);
      expect(preview.stops[0].departure).toBe(new Date(option.departureTimestamp).toISOString());
    }
    const option = current.departures[0];
    const expired = busJourney(id, option.departureTimestamp + 1, option.vehicleId, option.arrivalTimestamp)!;
    expect(expired.isPreview).toBe(false);
    expect(expired.journeyId).toBe(expired.currentJourneyId);
    expect(busJourney(id, now, "bus:T402:01", origin)?.isPreview).toBe(false);
    expect(busJourney(id, now, id, origin + 4 * headway)?.isPreview).toBe(false);
  });

  it("preserves both published route associations on the combined shared-stop API", async () => {
    const shared = ["12001272", "12001273", "12001270", "12001300", "12001295", "12001294", "12001357"];
    for (const id of shared) {
      const refs = ["T401", "T402"].map(route => ref(route, id));
      expect(refs.map(r => stationServices.get(r)?.route.id)).toEqual(["T401", "T402"]);
      const response = await getDepartures(new NextRequest("http://localhost/api/departures?" +
        new URLSearchParams(refs.map(r => ["stop", r])).toString()));
      expect(response.status).toBe(200);
      const data = await response.json() as { dataMode: string; arrivals: ReturnType<typeof stationArrivals> };
      expect(data.dataMode).toBe("SIMULATED");
      expect(new Set(data.arrivals.map(item => item.routeId))).toEqual(new Set(["T401", "T402"]));
      expect(data.arrivals.every(item => item.dataMode === "SIMULATED")).toBe(true);
    }
  });
});
