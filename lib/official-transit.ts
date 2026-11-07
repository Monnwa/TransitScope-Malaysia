import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import JSZip from "jszip";
import { gtfsTimestamp,vehicleObservation,validGpsPosition } from "@/lib/vehicle-observation";
import { officialProgressHistory } from "@/lib/vehicle-progress-history";
import type { ProgressHistory } from "@/lib/vehicle-progress";
import { buildTimetable, type Timetable } from "@/lib/scheduled-departures";
import type { FeedHealth, Mode, MrtLineId, Record } from "@/lib/transit-data";

const API_BASE = "https://api.data.gov.my";
const REALTIME_TTL = 30_000;
const STATIC_TTL = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 12_000;
const STATIC_REQUEST_BUDGET = 15_000;
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
type StaticFeed = { timetable: Timetable; routes: Map<string, { name: string; mode: Mode; mrtLine?: MrtLineId }>; trips: Map<string, { routeId: string; shapeId: string | null; serviceId: string | null }>; stops: Record[]; tripPaths: Map<string, [number, number][]>; progressPaths:Map<string,[number,number][]>; tripShapeDistances:Map<string,number[]>; files: { agencies: number; stopTimes: number; calendar: number; shapes: number }; fetchedAt: string };
type Timed<T> = { value: T; expiresAt: number; lastSuccessAt: string };
const realtimeCache = new Map<string, Timed<{ records: Record[]; health: FeedHealth }>>();
const staticCache = new Map<string, Timed<StaticFeed>>();
const healthMemory = new Map<string, FeedHealth>();

const csv = (value: string) => {
  const lines = value.replace(/^\uFEFF/, "").trim().split(/\r?\n/); if (!lines.length) return [] as globalThis.Record<string, string>[];
  const parse = (line: string) => { const cells: string[] = []; let cell = "", quoted = false; for (let i = 0; i < line.length; i++) { const char = line[i]; if (char === '"') { if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (char === "," && !quoted) { cells.push(cell); cell = ""; } else cell += char; } cells.push(cell); return cells; };
  const headers = parse(lines[0]); return lines.slice(1).filter(Boolean).map(line => Object.fromEntries(headers.map((h, i) => [h, parse(line)[i] ?? ""])));
};
/** Builds GTFS's YYYYMMDD service date without relying on locale-specific formatting. */
const malaysiaServiceDate = () => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  const year = value("year"), month = value("month"), day = value("day");
  return { iso: `${year}-${month}-${day}`, key: `${year}${month}${day}` };
};
export const mapMode = (routeType: string | undefined, fallback: Mode, category?: string): Mode => {
  if (fallback === "KTM") return "KTM";
  const explicit = (category ?? "").toUpperCase();
  if (explicit === "MRT") return "MRT"; if (explicit === "LRT") return "LRT"; if (["MRL", "MONORAIL"].includes(explicit)) return "Monorail";
  return ({ "0": "LRT", "1": "MRT", "2": "KTM", "3": "Bus", "4": "Shared bike", "12": "Monorail" }[routeType ?? ""] as Mode | undefined) ?? fallback;
};
export const mrtLineFromCategory = (category?: string): MrtLineId | undefined => {
  const value = (category ?? "").toUpperCase();
  if (value === "KGL" || value.includes("KAJANG")) return "MRT1";
  if (value === "PYL" || value.includes("PUTRAJAYA")) return "MRT2";
  return undefined;
};
const mrtLineName = (lines: MrtLineId[]) => lines.map(line => line === "MRT1" ? "MRT Kajang Line (MRT1)" : "MRT Putrajaya Line (MRT2)").join(" · ");
const isSharedMrtStation = (name: string) => /kwasa damansara|tun razak exchange|\btrx\b/i.test(name);
export function mergeMrtStations(rawStops: Record[]): Record[] {
  const stations = new Map<string, Record>(); const other: Record[] = [];
  for (const input of rawStops) {
    if (input.mode !== "MRT") { other.push(input); continue; }
    const sharedKey = /kwasa damansara/i.test(input.name) ? "kwasadamansara" : /tun razak exchange|\btrx\b/i.test(input.name) ? "trx" : input.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const key = `${input.dataMode}:mrt:${sharedKey}`;
    const existing = stations.get(key);
    const lines = [...new Set([...(existing?.mrtLines ?? []), ...(input.mrtLines ?? [])])];
    const shared = isSharedMrtStation(input.name);
    const record = existing ?? { ...input, id: key };
    record.stopRefs = [...new Set([...(existing?.stopRefs ?? []), ...(input.stopRefs ?? [])])];
    record.mrtLines = shared ? ["MRT1", "MRT2"] : lines;
    record.interchange = record.mrtLines.length > 1;
    record.route = mrtLineName(record.mrtLines);
    if (input.nextScheduledAt && (!record.nextScheduledAt || input.nextScheduledAt < record.nextScheduledAt)) record.nextScheduledAt = input.nextScheduledAt;
    stations.set(key, record);
  }
  return [...other, ...stations.values()];
}
const validPosition = (lat?: number | null, lon?: number | null) => typeof lat === "number" && typeof lon === "number" && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
async function fetchBinary(url: string) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT); try { const response = await fetch(url, { signal: controller.signal, cache: "no-store" }); if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`); return new Uint8Array(await response.arrayBuffer()); } finally { clearTimeout(timer); } }
const staticRequests = new Map<string, Promise<StaticFeed>>();
async function staticFeed(source: typeof staticSources[number]) {
  const existing = staticRequests.get(source.id); if (existing) return existing;
  const request = loadStaticFeed(source).finally(() => staticRequests.delete(source.id));
  staticRequests.set(source.id, request); return request;
}
async function loadStaticFeed(source: typeof staticSources[number]) {
  const cached = staticCache.get(source.id); if (cached && cached.expiresAt > Date.now()) return cached.value;
  const zip = await JSZip.loadAsync(await fetchBinary(source.url));
  const read = async (file: string) => zip.file(file) ? csv(await zip.file(file)!.async("text")) : [];
  const [agencyRows, routeRows, tripRows, stopRows, stopTimeRows, calendarRows, shapeRows, exceptionRows, frequencyRows] = await Promise.all([read("agency.txt"), read("routes.txt"), read("trips.txt"), read("stops.txt"), read("stop_times.txt"), read("calendar.txt"), read("shapes.txt"), read("calendar_dates.txt"), read("frequencies.txt")]);
  const routes = new Map(routeRows.map(route => { const mrtLine = mrtLineFromCategory(route.route_id); return [route.route_id, { name: route.route_short_name || route.route_long_name || route.route_id, mode: mapMode(route.route_type, source.defaultMode, route.category), mrtLine }]; }));
  const trips = new Map(tripRows.map(trip => [trip.trip_id, { routeId: trip.route_id, shapeId: trip.shape_id || null, serviceId: trip.service_id || null }]));
  const shapePoints = new Map<string, [number, number, number, number|null][]>(),invalidShapes=new Set<string>();
  for (const shape of shapeRows) {
    const lat=Number(shape.shape_pt_lat),lon=Number(shape.shape_pt_lon),sequence=Number(shape.shape_pt_sequence);
    if(shape.shape_id&&shape.shape_pt_lat?.trim()&&shape.shape_pt_lon?.trim()&&shape.shape_pt_sequence?.trim()&&validPosition(lat,lon)&&Number.isInteger(sequence)&&sequence>=0){
      const group=shapePoints.get(shape.shape_id)??[],raw=shape.shape_dist_traveled?.trim(),reference=raw?Number(raw):null;
      group.push([sequence,lat,lon,reference!==null&&Number.isFinite(reference)?reference:null]);shapePoints.set(shape.shape_id,group);
    }else if(shape.shape_id)invalidShapes.add(shape.shape_id);
  }
  const shapeGeometry=new Map<string,{path:[number,number][];references:number[]|null}>();
  for(const [id,points]of shapePoints){points.sort((a,b)=>a[0]-b[0]);if(points.some((point,i)=>i>0&&point[0]===points[i-1][0]))invalidShapes.add(id);shapeGeometry.set(id,{path:points.map(([,lat,lon])=>[lat,lon]),references:points.every(point=>point[3]!==null)?points.map(point=>point[3]!):null});}
  const tripPaths=new Map<string,[number,number][]>(),progressPaths=new Map<string,[number,number][]>(),tripShapeDistances=new Map<string,number[]>();
  for(const [id,trip]of trips){const geometry=trip.shapeId?shapeGeometry.get(trip.shapeId):null;if(!geometry?.path.length)continue;tripPaths.set(id,geometry.path);if(!invalidShapes.has(trip.shapeId!))progressPaths.set(id,geometry.path);if(geometry.references)tripShapeDistances.set(id,geometry.references);}
  const stopById = new Map(stopRows.map(stop => [stop.stop_id, stop]));
  const serviceDate = malaysiaServiceDate();
  const departureAt = (time: string) => { const [h = "0", m = "0", s = "0"] = time.split(":"); const date = new Date(`${serviceDate.iso}T00:00:00+08:00`); date.setHours(Number(h), Number(m), Number(s), 0); if (Number(h) >= 24) date.setDate(date.getDate() + Math.floor(Number(h) / 24)); return date; };
  const now = new Date(); const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Asia/Kuala_Lumpur" }).format(now).toLowerCase(); const dateKey = serviceDate.key;
  const activeServices = new Set(calendarRows.filter(row => row[weekday] === "1" && (!row.start_date || row.start_date <= dateKey) && (!row.end_date || row.end_date >= dateKey)).map(row => row.service_id));
  const hasCalendar = calendarRows.length > 0; const stopService = new Map<string, Map<string, { routeId: string; tripId: string; next: Date | null }>>();
  for (const stopTime of stopTimeRows) { const trip = trips.get(stopTime.trip_id); if (!trip || !stopById.has(stopTime.stop_id)) continue; const routeStops = stopService.get(stopTime.stop_id) ?? new Map(); const inService = !hasCalendar || !trip.serviceId || activeServices.has(trip.serviceId); const departure = inService && stopTime.departure_time ? departureAt(stopTime.departure_time) : null; const earlier = routeStops.get(trip.routeId); if (!earlier || (departure && departure >= now && (!earlier.next || departure < earlier.next))) routeStops.set(trip.routeId, { routeId: trip.routeId, tripId: stopTime.trip_id, next: departure && departure >= now ? departure : earlier?.next ?? null }); stopService.set(stopTime.stop_id, routeStops); }
  const rawStops: Record[] = []; for (const [stopId, services] of stopService) { const stop = stopById.get(stopId)!; const lat = Number(stop.stop_lat), lon = Number(stop.stop_lon); if (!validPosition(lat, lon)) continue; for (const service of services.values()) { const route = routes.get(service.routeId); if (!route) continue; const lines = route.mrtLine ? [route.mrtLine] : undefined; rawStops.push({ id: `${source.id}:stop:${stopId}:${route.mode}:${service.routeId}`, name: stop.stop_name || stopId, mode: route.mode, operator: source.operator, route: lines ? mrtLineName(lines) : route.name, routeId: service.routeId, tripId: service.tripId, station: stop.stop_name || stopId, position: [lat, lon], nextScheduledAt: service.next?.toISOString() ?? null, routePath: tripPaths.get(service.tripId) ?? null, recordKind: "stop", stopRefs: [`${source.id}:${stopId}`], mrtLines: lines, interchange: lines ? isSharedMrtStation(stop.stop_name || stopId) : undefined, reportedAt: null, lastUpdatedAt: new Date().toISOString(), status: "Station available", dataMode: "STATIC", source: `Malaysia Open API GTFS Static (${source.id})` }); } }
  const stops = mergeMrtStations(rawStops);
  const timetable = buildTimetable({ stopTimes: stopTimeRows, trips: tripRows, routes: routeRows, stops: stopRows, calendars: calendarRows, exceptions: exceptionRows, frequencies: frequencyRows, source: source.url, mode: route => mapMode(route.route_type, source.defaultMode, route.category) });
  const value = { timetable, routes, trips, stops: stops.slice(0, 700), tripPaths, progressPaths, tripShapeDistances, files: { agencies: agencyRows.length, stopTimes: stopTimeRows.length, calendar: calendarRows.length, shapes: shapeRows.length }, fetchedAt: new Date().toISOString() }; staticCache.set(source.id, { value, expiresAt: Date.now() + STATIC_TTL, lastSuccessAt: value.fetchedAt }); return value;
}
const realtimeRequests = new Map<string, ReturnType<typeof loadRealtimeFeed>>();
async function realtimeFeed(feed: FeedConfig) {
  const pending=realtimeRequests.get(feed.id);if(pending)return pending;
  const request=loadRealtimeFeed(feed).finally(()=>realtimeRequests.delete(feed.id));
  realtimeRequests.set(feed.id,request);return request;
}
async function loadRealtimeFeed(feed: FeedConfig) {
  const cached = realtimeCache.get(feed.id); if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    // Vehicle positions must remain available even when the substantially larger
    // static GTFS archive is slow or unavailable in a serverless deployment.
    const bytes = await fetchBinary(feed.url);
    const cachedStatic = staticCache.get(feed.staticId);
    const staticData = cachedStatic && cachedStatic.expiresAt > Date.now() ? cachedStatic.value : null;
    const decoded = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
    const sourceTimestamp = gtfsTimestamp(Number(decoded.header?.timestamp))??null;
    const decodedRecords = decoded.entity.flatMap((entity) => { const vehicle = entity.vehicle; const position = vehicle?.position; const lat = position?.latitude, lon = position?.longitude; if (!vehicle || !position || !validPosition(lat, lon) || !validGpsPosition([lat!,lon!])) return []; const tripId = vehicle.trip?.tripId ?? null; const trip = tripId ? staticData?.trips.get(tripId) : undefined; const routeId = vehicle.trip?.routeId ?? trip?.routeId ?? null; const route = routeId ? staticData?.routes.get(routeId) : undefined; const observation=vehicleObservation(vehicle),timestamp=observation.positionTimestamp??null; return [{ feedId: feed.id, observation, id: vehicle.vehicle?.id || entity.id || `${feed.id}:${lat}:${lon}`, name: vehicle.vehicle?.label || vehicle.vehicle?.id || "Vehicle identifier unavailable", mode: route?.mode ?? feed.mode, operator: feed.operator, route: route?.name ?? routeId, routeId, tripId, station: null, position: [lat, lon] as [number, number], bearing: Object.prototype.hasOwnProperty.call(position,"bearing") ? position.bearing ?? null : null, speed: Object.prototype.hasOwnProperty.call(position,"speed") ? position.speed ?? null : null, routePath: tripId ? staticData?.tripPaths.get(tripId) ?? null : null, recordKind: "vehicle" as const, reportedAt: timestamp, lastUpdatedAt: new Date().toISOString(), status: "In service" as const, dataMode: "LIVE" as const, source: `Malaysia Open API GTFS-Realtime (${feed.label})` }]; });
    const records=officialProgressHistory.ingest(feed.id,decodedRecords);
    const health: FeedHealth = { id: feed.id, label: feed.label, status: "healthy", lastSuccessAt: new Date().toISOString(), sourceTimestamp, message: null, records: records.length }; healthMemory.set(feed.id, health); const value = { records, health }; realtimeCache.set(feed.id, { value, expiresAt: Date.now() + REALTIME_TTL, lastSuccessAt: health.lastSuccessAt! }); return value;
  } catch (error) { officialProgressHistory.interrupt(feed.id); const prior = healthMemory.get(feed.id); const health: FeedHealth = { id: feed.id, label: feed.label, status: prior ? "stale" : "unavailable", lastSuccessAt: prior?.lastSuccessAt ?? null, sourceTimestamp: prior?.sourceTimestamp ?? null, message: error instanceof Error ? error.message : "Unknown upstream error", records: prior?.records ?? 0 }; healthMemory.set(feed.id, health); return { records: [], health }; }
}
export async function getOfficialTransit() { const outcome = await Promise.all(feeds.map(realtimeFeed)); return { records: outcome.flatMap(x => x.records), feeds: outcome.map(x => x.health) }; }
export const busSourceIds = ["rapid-bus-kl", "rapid-bus-mrtfeeder", "rapid-bus-penang"] as const;
export type BusSourceId = typeof busSourceIds[number];
export async function getBusStaticFeed(id: BusSourceId) { return staticFeed(staticSources.find(source=>source.id===id)!); }
export async function getBusVehicle(id: BusSourceId, vehicleId: string):Promise<{record:Record|null;available:boolean;health:FeedHealth;history?:ProgressHistory}> {
  const feed=feeds.find(item=>item.id===id)!;
  const result=await realtimeFeed(feed);
  const available=result.health.status==="healthy";
  const record=(available?result.records:realtimeCache.get(id)?.value.records??[]).find(item=>item.id===vehicleId)??null;
  return { record, available, health:result.health,history:available?officialProgressHistory.get(id,vehicleId):undefined };
}
export async function getTimetable(sourceId: string) { const source = staticSources.find(item => item.id === sourceId); if (!source) throw new Error("Unsupported timetable source"); return (await staticFeed(source)).timetable; }
export async function getRailStaticFeed(id: "rapid-rail-kl" | "ktmb") { return staticFeed(staticSources.find(source => source.id === id)!); }
export async function getMrtStaticFeed() { return getRailStaticFeed("rapid-rail-kl"); }
export async function getStaticTransit() {
  const stops: Record[] = [];
  const outcome = Promise.all(staticSources.map(source => staticFeed(source).then(feed => { stops.push(...feed.stops); }).catch(() => undefined)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([outcome, new Promise<void>(resolve => { timer = setTimeout(resolve, STATIC_REQUEST_BUDGET); })]);
    return stops;
  } finally { if (timer) clearTimeout(timer); }
}
