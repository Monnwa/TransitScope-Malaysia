import { getRailStaticFeed } from "@/lib/official-transit";
import { rapidRailMeta, mergeRailStations, type RailLine, type RailNetwork } from "@/lib/rail-model";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { getKtmOsmPaths } from "@/lib/osm-ktm";
type Point = [number, number];
const xy = ([lat, lon]: Point): Point => [lon * 111000 * Math.cos(4 * Math.PI / 180), lat * 111000];
export function validRailPath(path: Point[], minimum = 10) {
  if (path.length < minimum || path.some(([lat, lon]) => !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 1 || lat > 7 || lon < 99 || lon > 105)) return false;
  return path.slice(1).every((p, i) => { const a = xy(p), b = xy(path[i]); return Math.hypot(a[0] - b[0], a[1] - b[1]) < 10000; });
}
export function coversRailStations(paths: Point[][], stations: Point[]) {
  return stations.length > 0 && stations.every(station => {
    const p = xy(station);
    return paths.some(path => path.slice(1).some((point, index) => {
      const a = xy(path[index]), b = xy(point), dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < 1000;
    }));
  });
}
export async function getRailNetwork(source: "rapid-rail-kl" | "ktmb"): Promise<RailNetwork> {
  const feed = await getRailStaticFeed(source);
  const lines: RailLine[] = [], stations: TransitRecord[] = [];
  for (const [routeId, route] of feed.routes) {
    const meta = source === "ktmb" ? { id: `KTM:${routeId}`, name: `KTM ${route.name}`, colour: "#24558A", mode: "KTM" as const } : rapidRailMeta[routeId];
    if (!meta) continue;
    const shapeIds = new Set<string>(); const paths: Point[][] = [];
    for (const [tripId, trip] of feed.trips) {
      if (trip.routeId !== routeId || !trip.shapeId || shapeIds.has(trip.shapeId)) continue;
      shapeIds.add(trip.shapeId); const path = feed.tripPaths.get(tripId);
      if (path && validRailPath(path)) paths.push(path);
    }
    let geometrySource = `Malaysia Official GTFS Static (${source})`;
    if (source === "ktmb" && !paths.length) {
      try { paths.push(...(await getKtmOsmPaths(routeId)).filter(path => validRailPath(path, 2))); } catch { /* Stations remain available if secondary geometry fails. */ }
      if (paths.length) geometrySource = "OpenStreetMap contributors (ODbL); original KTM Komuter railway relation";
    }
    const routeStations = feed.stops.filter(stop => route.mrtLine ? stop.mrtLines?.includes(route.mrtLine) : stop.routeId === routeId);
    if (paths.length && !coversRailStations(paths, routeStations.filter(stop => stop.position).map(stop => stop.position!))) paths.length = 0;
    lines.push({ ...meta, paths, source: geometrySource, dataMode: "STATIC", geometryStatus: paths.length ? "available" : "unavailable" });
    for (const stop of feed.stops) {
      const belongs = route.mrtLine ? stop.mrtLines?.includes(route.mrtLine) : stop.routeId === routeId;
      if (!belongs) continue;
      stations.push({ ...stop, mode: meta.mode, railLines: [meta.id], lineNames: [meta.name], route: meta.name, routePath: null });
    }
  }
  return { lines, stations: mergeRailStations(stations), available: true, source: `Malaysia Official GTFS Static (${source}); WGS84` };
}
