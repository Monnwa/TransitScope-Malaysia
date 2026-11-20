import { describe, expect, it } from "vitest";
import { railMapPaths } from "@/lib/rail-map-geometry";
import { distanceM, indexShape, projectCandidates, validPoint, type GeoPoint } from "@/lib/route-projection";
import { railNetwork, railRoutes } from "@/lib/simulation/network";
import { trainPositions } from "@/lib/simulation/vehicles";

const publishedEndpoints: Record<string, [GeoPoint, GeoPoint]> = {
  MRT1: [[3.17626398, 101.5719131], [2.98129958, 101.7902826]],
  MRT2: [[3.176307, 101.57225], [2.92766, 101.670778]],
  "LRT-KJ": [[3.23179299, 101.7244271], [2.99665404, 101.5746142]],
  "LRT-AG": [[3.186597, 101.695208], [3.150787, 101.760359]],
  "LRT-PH": [[3.18659697, 101.695208], [2.99713698, 101.57332]],
  MONORAIL: [[3.132852, 101.687817], [3.173152, 101.695806]],
  "KTM:KA15_KD19": [[3.6847478, 101.5182575], [2.9991327, 101.3916584]],
  "KTM:KC05_KB18": [[3.2392336, 101.6811126], [2.4631107, 102.2268588]],
};

// The nearest-point projection of these older simulation markers reverses
// their order. Use GTFS stops PY38 and PY39 to check the published alignment.
const putrajayaCheckpoints: Record<string, GeoPoint> = {
  "16 Sierra": [2.964974, 101.654812],
  "Cyberjaya Utara": [2.95, 101.6573],
};

function crosses(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint) {
  const side = (from: GeoPoint, to: GeoPoint, point: GeoPoint) =>
    (to[0] - from[0]) * (point[1] - from[1]) - (to[1] - from[1]) * (point[0] - from[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

describe("rail map geometry", () => {
  it.each(railNetwork.lines.map(line => [line.id, line] as const))("%s keeps valid, connected routes and stable endpoints", (id, line) => {
    const displayed = railMapPaths(line);
    const [path] = displayed;
    const simulation = railRoutes.find(route => route.id === id)!;
    expect(railMapPaths(line)).toBe(displayed);
    expect(displayed).toHaveLength(1);
    expect(path.every(validPoint)).toBe(true);

    const published = publishedEndpoints[id];
    if (!published) {
      expect(displayed).toBe(line.paths);
      return;
    }
    expect([path[0], path.at(-1)]).toEqual(published);
    expect(new Set(path.map(String)).size).toBe(path.length);
    expect(Math.max(...path.slice(1).map((point, index) => distanceM(point, path[index])))).toBeLessThan(1600);
    let crossingCount = 0;
    for (let i = 0; i < path.length - 3; i++) {
      for (let j = i + 2; j < path.length - 1; j++) {
        if (crosses(path[i], path[i + 1], path[j], path[j + 1])) crossingCount++;
      }
    }
    expect(crossingCount).toBe(0);

    const [original] = line.paths;
    expect(original).toBe(simulation.legs[0].shape.path);
    expect([original[0], original.at(-1)]).toEqual([simulation.stops[0].position, simulation.stops.at(-1)!.position]);
    expect(railMapPaths({ ...line, dataMode: "STATIC" })).toBe(line.paths);

    const shape = indexShape(path)!;
    const offsets = simulation.stops.map(station => {
      const checkpoint = id === "MRT2" ? putrajayaCheckpoints[station.name] ?? station.position : station.position;
      const closest = projectCandidates(shape, checkpoint, 2500).sort((a, b) => a.offsetM - b.offsetM)[0];
      expect(closest, station.name).toBeDefined();
      return closest.distanceM;
    });
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("keeps moving and stopped trains on their displayed routes in both directions", () => {
    const tracks = new Map(railNetwork.lines.map(line => [line.id, indexShape(railMapPaths(line)[0])!]));
    const coverage = new Set<string>();
    const offTrack = new Set<string>();
    const noon = Date.UTC(2026, 10, 20, 4);
    for (let minute = 0; minute < 90; minute += 5) {
      for (const train of trainPositions(noon + minute * 60_000)) {
        coverage.add(`${train.lineId}:${train.direction}:${train.status}`);
        if (!projectCandidates(tracks.get(train.lineId)!, train.position, 1).length) offTrack.add(train.lineId);
      }
    }
    expect([...offTrack]).toEqual([]);
    for (const { id } of railNetwork.lines) {
      for (const direction of [0, 1]) {
        expect(coverage.has(`${id}:${direction}:In service`)).toBe(true);
        expect(coverage.has(`${id}:${direction}:At stop`)).toBe(true);
      }
    }
  });
});
