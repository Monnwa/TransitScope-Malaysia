import { describe, expect, it } from "vitest";
import { busOperationalTiming, busRunningTimes, busStopDwellMs, scheduleBusLeg } from "@/lib/simulation/bus-operations";
import { busRoutes } from "@/lib/simulation/network";
import { busJourney, stationArrivals } from "@/lib/simulation/vehicles";

const now = Date.UTC(2026, 10, 14, 4);
const minute = 60_000;

describe("feeder timetable and loop progression", () => {
  it("preserves representative leg budgets and accounts for dwell once at each split", () => {
    expect(busRoutes.map(route => route.legs.map(leg => leg.duration))).toEqual([[1_748_000, 1_852_000], [1_390_000, 2_210_000]]);
    for (const route of busRoutes) {
      expect(route.fleetSize).toBe(2);
      expect(route.period).toBe(60 * minute);
      const [outbound, returning] = route.legs;
      expect(outbound.stops.at(-1)!.departure - outbound.stops.at(-1)!.arrival).toBe(busStopDwellMs);
      expect(returning.stops[0].departure).toBe(0);
      const terminal = returning.stops.at(-1)!;
      expect(terminal.departure - terminal.arrival).toBe(busOperationalTiming[route.id as keyof typeof busOperationalTiming].originLayoverMs);
      for (const leg of route.legs) for (let i = 1; i < leg.stops.length; i++) {
        const before = leg.stops[i - 1], stop = leg.stops[i];
        expect((stop.distance - before.distance) * 3_600 / (stop.arrival - before.departure)).toBeLessThanOrEqual(45.001);
      }
    }
  });

  it("rebudgets short spans while rejecting impossible timing", () => {
    const stops = [{ distance: 0, elapsedMs: 0 }, { distance: 200, elapsedMs: 10_000 }, { distance: 300, elapsedMs: 70_000 }];
    expect(busRunningTimes(stops, 0)).toEqual([16_000, 39_000]);
    expect(() => busRunningTimes(stops.map(stop => ({ ...stop, distance: stop.distance * 100 })), 0)).toThrow("time budget");
    const schedule = scheduleBusLeg(stops, [16_000, 39_000], 300_000);
    expect(schedule.map(({ arrival, departure }) => [arrival, departure])).toEqual([[0, 0], [16_000, 31_000], [70_000, 370_000]]);
    expect(() => scheduleBusLeg(stops, [10_000], 0)).toThrow("operational timing");
  });

  it.each(["T401", "T402"])("does not jump during the split, layover or loop rollover for %s", id => {
    const route = busRoutes.find(x => x.id === id)!;
    const vehicleId = "bus:" + id + ":01";
    const turnAt = now + route.legs[0].duration;
    const dwell = busJourney(vehicleId, turnAt - 1)!;
    const next = busJourney(vehicleId, turnAt)!;
    expect([dwell.direction, next.direction]).toEqual([0, 1]);
    expect(dwell.position).toEqual(next.position);
    expect(dwell.stops.at(-1)?.status).toBe("CURRENT");
    expect(next.stops[0].status).toBe("PASSED");
    const rollover = now + route.period;
    const terminal = busJourney(vehicleId, rollover - 1)!;
    const start = busJourney(vehicleId, rollover)!;
    expect(terminal.position).toEqual(start.position);
    expect(terminal.stops.at(-1)?.status).toBe("CURRENT");
    expect(start.direction).toBe(0);
    expect(start.nextArrival).toBe(Date.parse(start.stops[1].arrival));
  });

  it("offers regular 30-minute origin departures and retains an imminent departure during layover", () => {
    for (const route of busRoutes) {
      const station = route.legs[0].stops[0];
      const ref = "sim:" + route.id + ":" + station.id;
      const board = stationArrivals([ref], now - 1);
      expect(board[0].arrivalTimestamp).toBeLessThan(now);
      expect(board[0].departureTimestamp).toBe(now);
      expect(board.slice(1).map((item, i) => item.departureTimestamp - board[i].departureTimestamp)).toEqual(Array(7).fill(30 * minute));
      expect(board.every(item => item.dataMode === "SIMULATED" && item.routeId === route.id)).toBe(true);
      const journey = busJourney("bus:" + route.id + ":01", now)!;
      for (const preview of journey.departures) {
        expect(busJourney(journey.vehicle.id, now, preview.vehicleId, preview.arrivalTimestamp)?.journeyId).toBe(preview.tripId);
      }
    }
  });
});
