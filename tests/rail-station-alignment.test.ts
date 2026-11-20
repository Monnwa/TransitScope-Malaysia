import { describe, expect, it } from "vitest";
import { railNetwork, railNetworkFor, railRoutes } from "@/lib/simulation/network";
import { railMapPaths } from "@/lib/rail-map-geometry";
import { classifyRailStationDistance, closestRailTrackPoint } from "@/lib/rail-station-audit";
import { publishedRailStops, railStationAnchor } from "@/lib/rail-station-coordinates";
import { distanceM, indexShape, validPoint, type GeoPoint } from "@/lib/route-projection";
import { expandedServiceById } from "@/lib/expanded-services";
import { buildStationSearchIndex, findStations, resolveExactStation } from "@/lib/station-search";

describe("rail station alignments", () => {
  it("measures WGS84 [latitude, longitude] positions against the selected track", () => {
    const track = indexShape([[3.1, 101.7], [3.1, 101.71]])!;
    const point = closestRailTrackPoint(track, [3.1001, 101.705])!;
    expect(point.point).toEqual([3.1, 101.705]);
    expect(point.offsetM).toBeCloseTo(11.12, 2);
    expect(closestRailTrackPoint(track, [101.705, 3.1001])).toBeNull();
    expect(classifyRailStationDistance(point.offsetM)).toBe("PASS");
  });

  it("applies inclusive thresholds and classifies unavailable measurements", () => {
    expect([0, 15, 15.01, 30, 30.01, null, NaN, -1].map(value => classifyRailStationDistance(value)))
      .toEqual(["PASS", "PASS", "WARNING", "WARNING", "FAIL", "UNVERIFIED", "UNVERIFIED", "UNVERIFIED"]);
    expect(classifyRailStationDistance(17, { passM: 20, warningM: 40 })).toBe("PASS");
  });

  it.each(railNetwork.lines.map(line => [line.id, line] as const))("%s has a connected path and ordered source positions", (id, line) => {
    const paths = railMapPaths(line);
    expect(paths).toHaveLength(1);
    const shape = indexShape(paths[0])!;
    expect(shape).not.toBeNull();
    expect(shape.cumulative.slice(1).every((distance, i) => distance - shape.cumulative[i] < 1600)).toBe(true);
    const route = railRoutes.find(item => item.id === id)!;
    const service = expandedServiceById.get(id);
    const refs = route.stops.map(stop => `sim:${id}:${stop.id}`);
    const stops = route.stops.map((stop, i) => publishedRailStops[refs[i]] ??
      service?.stops.find(entry => entry.id === stop.id));
    expect(stops.every(Boolean)).toBe(true);
    const sequences = stops.flatMap(stop => stop && "sequence" in stop ? [stop.sequence] : []);
    expect(sequences.every((sequence, i) => i === 0 || sequence > sequences[i - 1])).toBe(true);
    const ids = stops.map(stop => stop && ("code" in stop ? stop.code : stop.id));
    expect(new Set(ids).size).toBe(stops.length);
    const along = stops.map(stop => {
      expect(validPoint(stop!.position)).toBe(true);
      const point = closestRailTrackPoint(shape, stop!.position)!;
      expect(point.offsetM).toBeLessThan(125);
      return point.distanceM;
    });
    expect(along.every((position, i) => i === 0 || position > along[i - 1])).toBe(true);
    expect(along[0]).toBeLessThan(200);
    expect(shape.lengthM - along.at(-1)!).toBeLessThan(450);

    const markerOrder = refs.map(ref => {
      const marker = railNetwork.stations.find(record => record.stopRefs?.includes(ref))!;
      expect(marker.railLines).toContain(id);
      return closestRailTrackPoint(shape, marker.position!)!.distanceM;
    });
    expect(markerOrder.every((position, i) => i === 0 || position > markerOrder[i - 1])).toBe(true);
  });

  it("uses each verified route stop for one marker and preserves distinct named platforms", () => {
    const allRefs = railNetwork.stations.flatMap(station => station.stopRefs ?? []);
    expect(new Set(allRefs).size).toBe(allRefs.length);
    for (const ref of Object.keys(publishedRailStops)) expect(allRefs).toContain(ref);
    const salak = railNetwork.stations.filter(station => station.name === "Salak Selatan");
    expect(salak.map(station => station.railLines)).toEqual([["LRT-PH"], ["KTM:KC05_KB18"]]);
    expect(distanceM(salak[0].position!, salak[1].position!)).toBeGreaterThan(400);
    expect(resolveExactStation("Salak Selatan", railNetwork)).toBeUndefined();
    expect(findStations(buildStationSearchIndex(railNetwork, [], []), "Salak Selatan").map(station => station.id))
      .toEqual(expect.arrayContaining(salak.map(station => station.id)));
    const seri = publishedRailStops["sim:KTM:KA15_KD19:seri-setia"]!;
    const setia = publishedRailStops["sim:KTM:KA15_KD19:setia-jaya"]!;
    expect(seri.originalGtfsPosition).toEqual(setia.position);
    expect(seri.osmNodeId).toBe(6762842359);
    expect(distanceM(seri.position, setia.position)).toBeGreaterThan(1000);
  });

  it.each([
    ["KL Sentral", "KE01", 6],
    ["Bandar Tasik Selatan", "19600", 3],
    ["Putrajaya Sentral", "PY41", 2],
    ["Bandar Utama", "SA1", 2],
    ["Glenmarie", "KJ27", 2],
    ["USJ 7", "KJ31", 2],
    ["Setia Jaya", "53600", 2],
  ])("keeps one %s anchor across route memberships", (name, code, count) => {
    const stations = railNetwork.stations.filter(station => station.name === name);
    expect(stations).toHaveLength(1);
    const [station] = stations;
    expect(station.railLines).toHaveLength(count);
    const anchor = railStationAnchor(station)!;
    expect(anchor.code).toBe(code);
    expect(station.position).toBe(anchor.position);
    for (const source of ["rapid-rail-kl", "ktmb"] as const) {
      const sameComplex = railNetworkFor(source).stations.find(candidate => candidate.stopRefs?.some(ref => station.stopRefs?.includes(ref)));
      if (sameComplex) expect(sameComplex.position).toBe(station.position);
    }
  });

  it("retains the source coordinate even when it is offset from its route", () => {
    const station = railNetwork.stations.find(stop => stop.name === "KLCC")!;
    const shape = indexShape(railMapPaths(railNetwork.lines.find(line => line.id === "LRT-KJ")!)[0])!;
    expect(station.position).toEqual([3.158935, 101.713287] satisfies GeoPoint);
    const closest = closestRailTrackPoint(shape, station.position!)!;
    expect(closest.offsetM).toBeGreaterThan(30);
    expect(closest.point).not.toEqual(station.position);
  });
});
