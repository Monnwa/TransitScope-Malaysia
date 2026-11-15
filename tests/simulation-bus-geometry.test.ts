import { describe, expect, it } from "vitest";
import { angleDifference, bearing, distanceM, pointAtDistance, validPoint } from "@/lib/route-projection";
import { busRoadPaths } from "@/lib/simulation/bus-road-paths";
import { busRoutes, busStopReviews, busStops } from "@/lib/simulation/network";
import feed from "@/docs/SM-2.3-evidence/gtfs-route-extract.json";

describe("published feeder geometry", () => {
  it.each([
    ["T401", [10_877, 9_672], [27, 26], "12001294"],
    ["T402", [7_312, 8_538], [17, 23], "12001733"],
  ] as const)("retains the distinct directions and open-road path for %s", (id, metres, counts, midpoint) => {
    const route = busRoutes.find(item => item.id === id)!;
    expect(route.legs.map(leg => Math.round(leg.shape.lengthM))).toEqual(metres);
    expect(route.legs.map(leg => leg.stops.length)).toEqual(counts);
    expect(route.legs[0].shape.path).not.toEqual([...route.legs[1].shape.path].reverse());
    expect(route.legs[0].stops.at(-1)?.id).toBe(midpoint);
    for (const [direction, leg] of route.legs.entries()) {
      const next = route.legs[1 - direction];
      expect(leg.shape.path.at(-1)).toEqual(next.shape.path[0]);
      expect(leg.stops.at(-1)?.id).toBe(next.stops[0].id);
      const path = leg.shape.path;
      const nextPoint = next.shape.path[1];
      expect(angleDifference(bearing(path.at(-2)!, path.at(-1)!), bearing(path.at(-1)!, nextPoint))).toBeLessThan(45);
      expect(path.every(point => validPoint(point))).toBe(true);
      for (let index = 1; index < path.length; index++) {
        const edge = distanceM(path[index - 1], path[index]);
        expect(edge).toBeGreaterThan(0);
        expect(edge).toBeLessThan(200);
        if (index > 1 && edge >= 5 && distanceM(path[index - 2], path[index - 1]) >= 5) {
          expect(angleDifference(bearing(path[index - 2], path[index - 1]), bearing(path[index - 1], path[index]))).toBeLessThan(150);
        }
      }
      let previous = -1;
      for (const stop of leg.stops) {
        expect(stop.distance).toBeGreaterThan(previous);
        expect(pointAtDistance(leg.shape, stop.distance).point).toEqual(stop.position);
        previous = stop.distance;
      }
    }
  });

  it("matches the full published stop sequence, including repeated visits across segments", () => {
    expect(busRoutes.map(route => route.id)).toEqual(["T401", "T402"]);
    for (const route of busRoutes) {
      const source = feed.routes.find(item => item.code === route.id)!;
      expect(source.direction).toBe("0");
      const [outbound, inbound] = route.legs;
      expect([...outbound.stops, ...inbound.stops.slice(1)].map(stop => stop.id)).toEqual(source.visits.map(stop => stop.id));
    }
  });

  it("keeps real GTFS IDs, unique public records and unverified boarding status", () => {
    expect(busStops).toHaveLength(85);
    expect(new Set(busStops.map(stop => stop.id)).size).toBe(85);
    expect(busStopReviews.size).toBe(85);
    for (const stop of busStops) {
      const review = busStopReviews.get(stop.id)!;
      const fixture = busRoadPaths.find(item => item.id === stop.routeId)!;
      const source = fixture.visits.find(visit => visit.id === review.stopId)!;
      expect(review).toMatchObject({ confidence: "PUBLISHED_GTFS_STOP", verificationStatus: "BOARDING_BAY_UNVERIFIED",
        dataMode: "SIMULATED", publishedPosition: source.published, position: stop.position });
      expect(review.distanceFromPublishedM).toBeLessThan(22);
      expect(stop).not.toHaveProperty("publishedPosition");
      expect(stop.stopRefs).toEqual([`sim:${fixture.id}:${source.id}`]);
    }
  });
});
