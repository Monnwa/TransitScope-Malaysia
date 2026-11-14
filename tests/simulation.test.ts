import { describe, expect, it, vi } from "vitest";
import { simulationSnapshot } from "@/lib/simulation";
import { SIMULATED, simulationTime } from "@/lib/simulation/clock";
import { railNetwork, railNetworkFor, stationServices } from "@/lib/simulation/network";
import { busJourney, stationArrivals } from "@/lib/simulation/vehicles";
import { indexShape, pointAtDistance } from "@/lib/route-projection";
import { linkBikeSnapshot } from "@/lib/simulation/scenarios";

const now = simulationTime(Date.UTC(2026, 10, 14, 4));

describe("simulation", () => {
  it("keeps fixed-seed fleet identities and positions consistent across consumers", () => {
    const first = simulationSnapshot(now);
    const later = simulationSnapshot(now + 10_000);
    const buses = first.records.filter(record => record.mode === "Bus" && record.recordKind === "vehicle");
    expect(buses).toHaveLength(324);
    expect(first).toEqual(simulationSnapshot(now));
    expect(new Set(first.records.map(record => record.id)).size).toBe(first.records.length);
    expect(later.records.map(record => record.id)).toEqual(first.records.map(record => record.id));
    expect(first.records.every(record => record.dataMode === SIMULATED)).toBe(true);
    expect(first.trains.every(train => first.records.includes(train))).toBe(true);
    const journeys = buses.map(bus => busJourney(bus.id, now)!);
    expect(journeys.every((journey, index) => journey.vehicle.position!.every((coordinate, axis) => coordinate === buses[index].position![axis]))).toBe(true);
    for (const journey of journeys) {
      const shape = indexShape(journey.path)!;
      const projected = pointAtDistance(shape, journey.progress * shape.lengthM);
      expect(journey.position[0]).toBeCloseTo(projected.point[0], 10);
      expect(journey.position[1]).toBeCloseTo(projected.point[1], 10);
      expect(journey.now).toBe(now);
      const next = journey.stops.find(stop => stop.status === "UPCOMING");
      expect(journey.nextArrival).toBe(next ? Date.parse(next.arrival) : null);
      for (const stop of journey.stops) {
        const arrival = Date.parse(stop.arrival);
        const departure = Date.parse(stop.departure);
        expect(stop.status).toBe(now < arrival ? "UPCOMING" : now < departure ? "CURRENT" : "PASSED");
      }
      if (next) {
        const nextArrival = Date.parse(next.arrival);
        const arrivals = stationArrivals([`sim:${journey.routeId}:${next.id}`], nextArrival - 1);
        expect(arrivals).toContainEqual(expect.objectContaining({ tripId: journey.currentJourneyId, arrivalTimestamp: nextArrival }));
        const atArrival = busJourney(journey.vehicle.id, nextArrival)!;
        expect(atArrival.position).toEqual(next.position);
        expect(atArrival.stops[next.sequence - 1].status).toBe("CURRENT");
      }
    }
    expect(journeys.some(journey => journey.stops.some(stop => stop.status === "CURRENT"))).toBe(true);
    expect(new Set(journeys.map(journey => journey.timing))).toEqual(new Set(["Early", "On time", "Delayed"]));
    expect(buses.some((bus, index) => bus.position!.some((value, axis) => value !== later.records[index].position![axis]))).toBe(true);
    const choice = journeys[0].departures[0];
    expect(busJourney(buses[0].id, now, choice.vehicleId, choice.arrivalTimestamp)?.journeyId).toBe(choice.tripId);
  });

  it("derives stable arrivals from vehicle runs and keeps bike counts within capacity", () => {
    const first = simulationSnapshot(now);
    for (const station of first.records.filter(record => record.recordKind === "stop")) {
      const arrivals = stationArrivals(station.stopRefs!, now);
      expect(arrivals).toHaveLength(8);
      expect(arrivals.every(arrival => arrival.arrivalTimestamp >= now && arrival.departureTimestamp >= arrival.arrivalTimestamp)).toBe(true);
      const later = stationArrivals(station.stopRefs!, now + 5_000);
      for (const arrival of arrivals.filter(item => item.arrivalTimestamp >= now + 5_000)) expect(later).toContainEqual(arrival);
    }
    for (const train of first.trains) {
      const line = railNetwork.lines.find(line => line.id === train.lineId);
      expect(line?.mode).toBe(train.mode);
      for (const station of [train.previousStation, train.nearStation, train.nextStation]) {
        if (!station) continue;
        const ref = `sim:${train.lineId}:${station.id}`;
        expect(stationServices.get(ref)?.station.position).toEqual(station.position);
        expect(railNetwork.stations.find(item => item.stopRefs?.includes(ref))?.railLines).toContain(train.lineId);
      }
      if (train.nextStation && train.nextArrival !== null) {
        const approaching = stationArrivals([`sim:${train.lineId}:${train.nextStation.id}`], train.nextArrival - 1);
        expect(approaching).toContainEqual(expect.objectContaining({ tripId: train.tripId, vehicleId: train.id, arrivalTimestamp: train.nextArrival }));
      }
    }
    expect(railNetwork.stations.find(station => station.name === "Bandar Tasik Selatan")?.modes).toEqual(["LRT", "KTM"]);
    expect(first.linkBike.stations).toHaveLength(27);
    for (const station of first.linkBike.stations) {
      expect(station.available_bikes).toBeGreaterThanOrEqual(0);
      expect(station.available_docks).toBeGreaterThanOrEqual(0);
      expect(station.available_bikes + station.available_docks).toBe(station.total_docks);
    }
    for (let minute = 0; minute < 90; minute++) {
      for (const station of linkBikeSnapshot(now + minute * 60_000).stations) {
        expect(station.available_bikes).toBeGreaterThanOrEqual(0);
        expect(station.available_bikes).toBeLessThanOrEqual(station.total_docks);
      }
    }
  });

  it("partitions the combined simulated rail network without leaking line or station memberships", () => {
    const rapid = railNetworkFor("rapid-rail-kl");
    const ktm = railNetworkFor("ktmb");
    expect(rapid.lines).toHaveLength(6);
    expect(ktm.lines).toHaveLength(2);
    expect([...rapid.lines, ...ktm.lines]).toHaveLength(railNetwork.lines.length);
    expect(new Set([...rapid.lines, ...ktm.lines].map(line => line.id))).toEqual(new Set(railNetwork.lines.map(line => line.id)));
    expect(rapid.lines.every(line => line.mode !== "KTM")).toBe(true);
    expect(ktm.lines.every(line => line.mode === "KTM")).toBe(true);
    for (const network of [rapid, ktm]) {
      const ids = new Set(network.lines.map(line => line.id));
      expect(network.stations.length).toBeGreaterThan(0);
      expect(network.stations.every(station =>
        station.dataMode === SIMULATED && (station.railLines?.length ?? 0) > 0 && station.railLines!.every(id => ids.has(id))
      )).toBe(true);
    }
  });

  it("returns simulation data from every adapter without using external fetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const fetch = vi.fn(() => { throw new Error("Unexpected external request"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const { NextRequest } = await import("next/server");
      const transit = await import("@/app/api/transit/route");
      const alerts = await import("@/app/api/alerts/route");
      const departures = await import("@/app/api/departures/route");
      const journey = await import("@/app/api/bus-journey/route");
      const trains = await import("@/app/api/train-positions/route");
      const rail = await import("@/app/api/rail-network/route");
      const mrt = await import("@/app/api/mrt-lines/route");
      const bike = await import("@/app/api/micromobility/linkbike/route");
      const replay = await import("@/app/api/internal/preview/evidence-replay/route");
      const base = "http://localhost";
      const request = (path: string) => new NextRequest(base + path);
      const snapshot = simulationSnapshot(now);
      for (const query of ["?mode=live", "?includeStatic=1", "?mode=demo"]) {
        expect(await (await transit.GET(request("/api/transit" + query))).json()).toEqual(JSON.parse(JSON.stringify(snapshot)));
      }
      const bus = JSON.parse(JSON.stringify(snapshot.records[0]));
      const ref = railNetwork.stations[0].stopRefs![0];
      const responses = await Promise.all([
        alerts.GET(), trains.GET(), rail.GET(request("/api/rail-network?source=ktmb&mode=live")), mrt.GET(), bike.GET(),
        journey.GET(request("/api/bus-journey?mode=live&source=rapid-bus-kl&trip=forged&vehicle=" + bus.id)),
        departures.GET(request("/api/departures?mode=live&stop=" + encodeURIComponent(ref))),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      const [notices, positions, ktm, alignments, bikes, selected, board] = await Promise.all(responses.map(response => response.json()));
      expect(notices).toMatchObject({ dataMode: SIMULATED, alerts: snapshot.alerts });
      expect(positions).toMatchObject({ dataMode: SIMULATED, positions: snapshot.trains });
      expect(ktm).toMatchObject({ dataMode: SIMULATED });
      expect(ktm.lines).toHaveLength(2);
      expect(ktm.lines.every((line: { mode: string; dataMode: string }) => line.mode === "KTM" && line.dataMode === SIMULATED)).toBe(true);
      expect(alignments).toMatchObject({ dataMode: SIMULATED });
      expect(alignments.lines.map((line: { id: string }) => line.id)).toEqual(["MRT1", "MRT2"]);
      expect(bikes).toEqual(snapshot.linkBike);
      expect(selected).toMatchObject({ vehicle: bus, dataMode: SIMULATED, journeyId: bus.tripId });
      expect(board).toMatchObject({ dataMode: SIMULATED, status: SIMULATED, arrivals: stationArrivals([ref], now) });
      for (const method of [replay.GET, replay.POST, replay.PATCH, replay.DELETE, replay.HEAD, replay.OPTIONS]) {
        expect(method().status).toBe(404);
      }
      const errors = await Promise.all([
        journey.GET(request("/api/bus-journey")),
        journey.GET(request("/api/bus-journey?vehicle=unknown")),
        departures.GET(request("/api/departures")),
        departures.GET(request("/api/departures?stop=rapid-rail-kl:legacy")),
      ]);
      expect(errors.map(response => response.status)).toEqual([400, 404, 400, 400]);
      for (const response of errors) {
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ error: expect.any(String) });
      }
      for (const [query, count] of [["", 8], ["?source=rapid-rail-kl", 6], ["?source=ktmb", 2]] as const) {
        const response = await rail.GET(request("/api/rail-network" + query));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const body = await response.json();
        expect(body.dataMode).toBe(SIMULATED);
        expect(body.lines).toHaveLength(count);
      }
      for (const query of ["?source=invalid", "?source=", "?source=ktmb&source=rapid-rail-kl"]) {
        const response = await rail.GET(request("/api/rail-network" + query));
        expect(response.status).toBe(400);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toEqual({ error: expect.any(String) });
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
