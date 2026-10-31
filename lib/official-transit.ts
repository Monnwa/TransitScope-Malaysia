import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import JSZip from "jszip";
import type { FeedHealth, Mode, Record } from "@/lib/transit-data";

const API_BASE = "https://api.data.gov.my";
const REALTIME_TTL = 30_000;
const STATIC_TTL = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 12_000;
type FeedConfig = { id: string; label: string; operator: string; url: string; staticId: "rapid-bus-kl" | "rapid-bus-mrtfeeder" | "rapid-bus-penang" | "rapid-rail-kl" | "ktmb"; mode: Mode };
export const feeds: FeedConfig[] = [
  { id: "rapid-bus-kl", label: "Rapid KL Bus", operator: "Prasarana", url: `${API_BASE}/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl`, staticId: "rapid-bus-kl", mode: "Bus" },
  { id: "rapid-bus-mrtfeeder", label: "MRT Feeder Bus", operator: "Prasarana", url: `${API_BASE}/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder`, staticId: "rapid-bus-mrtfeeder", mode: "Bus" },
  { id: "ktmb", label: "KTMB", operator: "KTMB", url: `${API_BASE}/gtfs-realtime/vehicle-position/ktmb`, staticId: "ktmb", mode: "KTM" },
  { id: "rapid-bus-penang", label: "Rapid Penang", operator: "Prasarana", url: `${API_BASE}/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-penang`, staticId: "rapid-bus-penang", mode: "Bus" },
];
const staticSources = [
  { id: "rapid-bus-kl", url: `${API_BASE}/gtfs-static/prasarana?category=rapid-bus-kl`, operator: "Prasarana", defaultMode: "Bus" as Mode },
  { id: "rapid-bus-mrtfeeder", url: `${API_BASE}/gtfs-static/prasarana?category=rapid-bus-mrtfeeder`, operator: "Prasarana", defaultMode: "Bus" as Mode },
  { id: "rapid-bus-penang", url: `${API_BASE}/gtfs-static/prasarana?category=rapid-bus-penang`, operator: "Prasarana", defaultMode: "Bus" as Mode },
  { id: "rapid-rail-kl", url: `${API_BASE}/gtfs-static/prasarana?category=rapid-rail-kl`, operator: "Prasarana", defaultMode: "MRT" as Mode },
  { id: "ktmb", url: `${API_BASE}/gtfs-static/ktmb`, operator: "KTMB", defaultMode: "KTM" as Mode },
];
type StaticFeed = { routes: Map<string, { name: string; mode: Mode }>; trips: Map<string, string>; stops: Record[]; files: { agencies: number; stopTimes: number; calendar: number; shapes: number }; fetchedAt: string };
type Timed<T> = { value: T; expiresAt: number; lastSuccessAt: string };
const realtimeCache = new Map<string, Timed<{ records: Record[]; health: FeedHealth }>>();
const staticCache = new Map<string, Timed<StaticFeed>>();
const healthMemory = new Map<string, FeedHealth>();

const csv = (value: string) => {
  const lines = value.replace(/^\uFEFF/, "").trim().split(/\r?\n/); if (!lines.length) return [] as globalThis.Record<string, string>[];
  const parse = (line: string) => { const cells: string[] = []; let cell = "", quoted = false; for (let i = 0; i < line.length; i++) { const char = line[i]; if (char === '"') { if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (char === "," && !quoted) { cells.push(cell); cell = ""; } else cell += char; } cells.push(cell); return cells; };
  const headers = parse(lines[0]); return lines.slice(1).filter(Boolean).map(line => Object.fromEntries(headers.map((h, i) => [h, parse(line)[i] ?? ""])));
};
const mapMode = (routeType: string | undefined, fallback: Mode): Mode => ({ "0": "LRT", "1": "MRT", "2": "KTM", "3": "Bus", "4": "Shared bike", "12": "Monorail" }[routeType ?? ""] as Mode | undefined) ?? fallback;
const validPosition = (lat?: number | null, lon?: number | null) => typeof lat === "number" && typeof lon === "number" && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
async function fetchBinary(url: string) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT); try { const response = await fetch(url, { signal: controller.signal, cache: "no-store" }); if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`); return new Uint8Array(await response.arrayBuffer()); } finally { clearTimeout(timer); } }
async function staticFeed(source: typeof staticSources[number]) {
  const cached = staticCache.get(source.id); if (cached && cached.expiresAt > Date.now()) return cached.value;
  const zip = await JSZip.loadAsync(await fetchBinary(source.url));
  const read = async (file: string) => zip.file(file) ? csv(await zip.file(file)!.async("text")) : [];
  const [agencyRows, routeRows, tripRows, stopRows, stopTimeRows, calendarRows, shapeRows] = await Promise.all([read("agency.txt"), read("routes.txt"), read("trips.txt"), read("stops.txt"), read("stop_times.txt"), read("calendar.txt"), read("shapes.txt")]);
  const routes = new Map(routeRows.map(route => [route.route_id, { name: route.route_short_name || route.route_long_name || route.route_id, mode: mapMode(route.route_type, source.defaultMode) }]));
  const trips = new Map(tripRows.map(trip => [trip.trip_id, trip.route_id]));
  const stops = stopRows.slice(0, 300).flatMap(stop => { const lat = Number(stop.stop_lat), lon = Number(stop.stop_lon); return validPosition(lat, lon) ? [{ id: `${source.id}:stop:${stop.stop_id}`, name: stop.stop_name || stop.stop_id, mode: source.defaultMode, operator: source.operator, route: null, tripId: null, station: stop.stop_name || stop.stop_id, position: [lat, lon] as [number, number], reportedAt: null, lastUpdatedAt: new Date().toISOString(), status: "Station available" as const, dataMode: "STATIC" as const, source: `Malaysia Open API GTFS Static (${source.id})` }] : []; });
  const value = { routes, trips, stops, files: { agencies: agencyRows.length, stopTimes: stopTimeRows.length, calendar: calendarRows.length, shapes: shapeRows.length }, fetchedAt: new Date().toISOString() }; staticCache.set(source.id, { value, expiresAt: Date.now() + STATIC_TTL, lastSuccessAt: value.fetchedAt }); return value;
}
async function realtimeFeed(feed: FeedConfig) {
  const cached = realtimeCache.get(feed.id); if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const [bytes, staticData] = await Promise.all([fetchBinary(feed.url), staticFeed(staticSources.find(s => s.id === feed.staticId) ?? staticSources[0])]);
    const decoded = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
    const sourceTimestamp = decoded.header?.timestamp ? new Date(Number(decoded.header.timestamp) * 1000).toISOString() : null;
    const records = decoded.entity.flatMap((entity: any) => { const vehicle = entity.vehicle; const position = vehicle?.position; const lat = position?.latitude, lon = position?.longitude; if (!vehicle || !validPosition(lat, lon)) return []; const tripId = vehicle.trip?.tripId ?? null; const routeId = vehicle.trip?.routeId ?? (tripId ? staticData.trips.get(tripId) : null) ?? null; const route = routeId ? staticData.routes.get(routeId) : undefined; const timestamp = vehicle.timestamp ? new Date(Number(vehicle.timestamp) * 1000).toISOString() : sourceTimestamp; return [{ id: vehicle.vehicle?.id || entity.id || `${feed.id}:${lat}:${lon}`, name: vehicle.vehicle?.label || vehicle.vehicle?.id || "Vehicle identifier unavailable", mode: route?.mode ?? feed.mode, operator: feed.operator, route: route?.name ?? routeId, tripId, station: null, position: [lat, lon] as [number, number], bearing: position.bearing ?? null, speed: position.speed ?? null, reportedAt: timestamp, lastUpdatedAt: new Date().toISOString(), status: "In service" as const, dataMode: "LIVE" as const, source: `Malaysia Open API GTFS-Realtime (${feed.label})` }]; });
    const health: FeedHealth = { id: feed.id, label: feed.label, status: "healthy", lastSuccessAt: new Date().toISOString(), sourceTimestamp, message: null, records: records.length }; healthMemory.set(feed.id, health); const value = { records, health }; realtimeCache.set(feed.id, { value, expiresAt: Date.now() + REALTIME_TTL, lastSuccessAt: health.lastSuccessAt! }); return value;
  } catch (error) { const prior = healthMemory.get(feed.id); const health: FeedHealth = { id: feed.id, label: feed.label, status: prior ? "stale" : "unavailable", lastSuccessAt: prior?.lastSuccessAt ?? null, sourceTimestamp: prior?.sourceTimestamp ?? null, message: error instanceof Error ? error.message : "Unknown upstream error", records: prior?.records ?? 0 }; healthMemory.set(feed.id, health); return { records: [], health }; }
}
export async function getOfficialTransit() { const outcome = await Promise.all(feeds.map(realtimeFeed)); return { records: outcome.flatMap(x => x.records), feeds: outcome.map(x => x.health) }; }
export async function getStaticTransit() { const outcome = await Promise.allSettled(staticSources.map(staticFeed)); return outcome.flatMap(result => result.status === "fulfilled" ? result.value.stops : []); }
