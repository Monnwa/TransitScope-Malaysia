import type { Mode } from "@/lib/transit-data";
type Row = Record<string, string>;
export type ScheduledDeparture = { tripId: string; routeId: string; routeName: string; mode: Mode; destination?: string; direction?: string; scheduledDeparture: string; scheduledTimestamp: number; platform?: string; status: "SCHEDULED"; source: string; lastUpdated: string };
export type FrequencyWindow = { tripId: string; routeName: string; mode: Mode; destination?: string; direction?: string; platform?: string; start: string; end: string; headwaySeconds: number; source: string };
export type Timetable = { byStop: Map<string, Row[]>; trips: Map<string, Row>; routes: Map<string, Row & { mode: Mode }>; stops: Map<string, Row>; calendars: Row[]; exceptions: Row[]; frequencies: Map<string, Row[]>; firstTime: Map<string, number>; destination: Map<string, string>; lastSeq: Map<string, number>; source: string; updated: string; maxSeconds: number };
export function gtfsSeconds(time: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(time ?? "");
  return match ? +match[1] * 3600 + +match[2] * 60 + +match[3] : null;
}
export function buildTimetable(input: { stopTimes: Row[]; trips: Row[]; routes: Row[]; stops: Row[]; calendars: Row[]; exceptions: Row[]; frequencies: Row[]; source: string; mode: (route: Row) => Mode }): Timetable {
  const byStop = new Map<string, Row[]>(), firstTime = new Map<string, number>(), destination = new Map<string, string>(), lastSeq = new Map<string, number>(), frequencies = new Map<string, Row[]>();
  let maxSeconds = 86400;
  for (const row of input.stopTimes) {
    const seq = Number(row.stop_sequence); if (Number.isFinite(seq) && seq > (lastSeq.get(row.trip_id) ?? -1)) { destination.set(row.trip_id, row.stop_id); lastSeq.set(row.trip_id, seq); }
    const seconds = gtfsSeconds(row.departure_time); if (seconds === null || row.pickup_type === "1") continue;
    const rows = byStop.get(row.stop_id) ?? []; rows.push(row); byStop.set(row.stop_id, rows);
    maxSeconds = Math.max(maxSeconds, seconds); firstTime.set(row.trip_id, Math.min(firstTime.get(row.trip_id) ?? Infinity, seconds));
  }
  for (const row of input.frequencies) { const rows = frequencies.get(row.trip_id) ?? []; rows.push(row); frequencies.set(row.trip_id, rows); maxSeconds = Math.max(maxSeconds, gtfsSeconds(row.end_time) ?? 0); }
  return { byStop, firstTime, destination, lastSeq, frequencies, trips: new Map(input.trips.map(row => [row.trip_id, row])), routes: new Map(input.routes.map(row => [row.route_id, { ...row, mode: input.mode(row) }])), stops: new Map(input.stops.map(row => [row.stop_id, row])), calendars: input.calendars, exceptions: input.exceptions, source: input.source, updated: new Date().toISOString(), maxSeconds };
}
export function serviceRuns(table: Timetable, serviceId: string, date: string): boolean {
  const exception = table.exceptions.find(row => row.service_id === serviceId && row.date === date.replaceAll("-", ""));
  if (exception) return exception.exception_type === "1";
  const calendar = table.calendars.find(row => row.service_id === serviceId);
  if (!calendar) return false;
  const key = date.replaceAll("-", ""); const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return calendar[weekdays[new Date(`${date}T12:00:00+08:00`).getUTCDay()]] === "1" && key >= calendar.start_date && key <= calendar.end_date;
}
export function malaysiaDate(now: number) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
export function calculateDepartures(table: Timetable, stopIds: string[], now = Date.now()) {
  const departures: ScheduledDeparture[] = [], frequencies: FrequencyWindow[] = []; let hasRecords = false, activeToday = false;
  const today = malaysiaDate(now); const todayMidnight = Date.parse(`${today}T00:00:00+08:00`), tomorrow = todayMidnight + 86400000;
  for (let offset = -Math.ceil(table.maxSeconds / 86400); offset <= 1; offset++) {
    const midnight = todayMidnight + offset * 86400000; const date = malaysiaDate(midnight);
    for (const stopId of stopIds) for (const stopTime of table.byStop.get(stopId) ?? []) {
      hasRecords = true; const trip = table.trips.get(stopTime.trip_id); const route = trip && table.routes.get(trip.route_id);
      if (!trip || !route || !serviceRuns(table, trip.service_id, date)) continue;
      // The last stop of a trip is an arrival, not an onward departure.
      if (Number(stopTime.stop_sequence) === table.lastSeq.get(trip.trip_id)) continue;
      if (offset === 0) activeToday = true;
      const seconds = gtfsSeconds(stopTime.departure_time); if (seconds === null) continue;
      const base = { tripId: trip.trip_id, routeId: trip.route_id, routeName: route.route_long_name || route.route_short_name || trip.route_id, mode: route.mode, destination: trip.trip_headsign || table.stops.get(table.destination.get(trip.trip_id) ?? "")?.stop_name, direction: trip.direction_id || undefined, platform: table.stops.get(stopId)?.platform_code || table.stops.get(stopId)?.stop_code || stopId, status: "SCHEDULED" as const, source: table.source, lastUpdated: table.updated };
      const windows = table.frequencies.get(trip.trip_id);
      if (!windows?.length) {
        const time = midnight + seconds * 1000;
        if (time >= now && time < tomorrow + 86400000) departures.push({ ...base, scheduledDeparture: new Date(time).toISOString(), scheduledTimestamp: time });
      } else for (const window of windows) {
        const start = gtfsSeconds(window.start_time), end = gtfsSeconds(window.end_time), headway = Number(window.headway_secs), origin = table.firstTime.get(trip.trip_id);
        if (start === null || end === null || origin === undefined || end <= start || !Number.isFinite(headway) || headway <= 0) continue;
        const shift = seconds - origin, from = midnight + (start + shift) * 1000, until = midnight + (end + shift) * 1000;
        if (until <= now || from >= tomorrow + 86400000) continue;
        if (window.exact_times !== "1") {
          frequencies.push({ tripId: trip.trip_id, routeName: base.routeName, mode: base.mode, destination: base.destination, direction: base.direction, platform: base.platform, start: new Date(from).toISOString(), end: new Date(until).toISOString(), headwaySeconds: headway, source: table.source });
        } else {
          for (let time = from + Math.max(0, Math.ceil((now - from) / (headway * 1000))) * headway * 1000, count = 0; time < until && count < 10; time += headway * 1000, count++) departures.push({ ...base, scheduledDeparture: new Date(time).toISOString(), scheduledTimestamp: time });
        }
      }
    }
  }
  const unique = new Map(departures.map(item => [`${item.source}:${item.tripId}:${item.scheduledTimestamp}`, item]));
  const uniqueWindows = new Map(frequencies.map(item => [`${item.source}:${item.tripId}:${item.start}:${item.end}`, item]));
  return { departures: [...unique.values()].sort((a, b) => a.scheduledTimestamp - b.scheduledTimestamp).slice(0, 10), frequencies: [...uniqueWindows.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(0, 10), hasRecords, activeToday, noMoreToday: !departures.some(item => item.scheduledTimestamp < tomorrow) && !frequencies.some(item => Date.parse(item.start) < tomorrow) };
}
