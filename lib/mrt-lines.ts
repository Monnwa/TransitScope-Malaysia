import type { MrtLineId } from "@/lib/transit-data";
import { getMrtStaticFeed } from "@/lib/official-transit";

export const mrtLineMeta = {
  MRT1: { name: "MRT Kajang Line (MRT1)", colour: "#006B3F" },
  MRT2: { name: "MRT Putrajaya Line (MRT2)", colour: "#F2C500" },
};
export type MrtAlignment = { id: MrtLineId; name: string; colour: string; paths: [number, number][][]; source: string; dataMode: "STATIC" };
type Point = [number, number];
// Metric projection is used only for validation; rendered vertices remain unchanged WGS84.
const metric = ([lat, lon]: Point): Point => [lon * 111_000 * Math.cos(3 * Math.PI / 180), lat * 111_000];
function segmentDistance(p: Point, a: Point, b: Point) {
  const [px, py] = metric(p), [ax, ay] = metric(a), [bx, by] = metric(b);
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export function validateMrtPath(path: Point[], stations: Point[]): boolean {
  if (path.length < 50 || stations.length < 20) return false;
  if (path.some(([lat, lon]) => !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 2.8 || lat > 3.4 || lon < 101.4 || lon > 101.9)) return false;
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const a = metric(path[i - 1]), b = metric(path[i]);
    const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (gap > 5000) return false;
    length += gap;
  }
  if (length < 35_000 || length > 80_000) return false;
  return stations.every(station => path.slice(1).some((point, i) => segmentDistance(station, path[i], point) < 750));
}
export async function getMrtAlignments(): Promise<MrtAlignment[]> {
  const feed = await getMrtStaticFeed();
  return (["MRT1", "MRT2"] as MrtLineId[]).flatMap(id => {
    const stations = feed.stops.filter(stop => stop.mrtLines?.includes(id) && stop.position).map(stop => stop.position!);
    const shapeIds = new Set<string>();
    const candidates: Point[][] = [];
    for (const [tripId, trip] of feed.trips) {
      if (feed.routes.get(trip.routeId)?.mrtLine !== id || !trip.shapeId || shapeIds.has(trip.shapeId)) continue;
      shapeIds.add(trip.shapeId);
      const path = feed.tripPaths.get(tripId);
      if (path && validateMrtPath(path, stations)) candidates.push(path);
    }
    const path = candidates.sort((a, b) => b.length - a.length)[0];
    return path ? [{ id, ...mrtLineMeta[id], paths: [path], dataMode: "STATIC" as const, source: "Malaysia Official Open API: rapid-rail-kl GTFS trips.txt → shapes.txt (WGS84)" }] : [];
  });
}
