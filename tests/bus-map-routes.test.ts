import { describe, expect, it } from "vitest";
import { busMapRoutes, busNetworkPath, busRouteViewport } from "@/lib/bus-map-routes";
import { busRoutes } from "@/lib/simulation/network";

describe("Klang Valley map geometry", () => {
  it("shows only the existing T401/T402 routes and never includes Penang coordinates", () => {
    expect(busMapRoutes.map(route => route.id)).toEqual(["T401", "T402"]);
    expect(busNetworkPath.length).toBeGreaterThan(100);
    expect(busNetworkPath.every(([lat, lon]) => lat > 2.8 && lat < 3.5 && lon > 101 && lon < 102)).toBe(true);
  });
  it.each(["T401", "T402"])("preserves both existing internal legs of %s without adding coordinates", id => {
    const source = busRoutes.find(route => route.id === id)!;
    const path = busRouteViewport(id);
    expect(path.slice(0, source.legs[0].shape.path.length)).toEqual(source.legs[0].shape.path);
    expect(path.slice(source.legs[0].shape.path.length)).toEqual(source.legs[1].shape.path.slice(1));
    expect(path[0]).toEqual(path.at(-1));
    expect(path.every(point => source.legs.some(leg => leg.shape.path.includes(point)))).toBe(true);
  });
  it("restores the same stable network extent when route selection is cleared or unknown", () => {
    expect(busRouteViewport("")).toBe(busNetworkPath);
    expect(busRouteViewport("unavailable-route")).toBe(busNetworkPath);
    expect(busRouteViewport("T401")).not.toBe(busRouteViewport("T402"));
  });
});
