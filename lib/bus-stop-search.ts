import { z } from "zod";
import { officialStopPosition } from "./journey-stop-selection";
import type { Timetable } from "./scheduled-departures";

const busStopSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  name: z.string(),
  position: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
  operator: z.string(),
  feed: z.string(),
  area: z.string().optional(),
  aliases: z.array(z.string()),
  routes: z.array(z.object({ id: z.string(), name: z.string() })),
  simulatedPosition: z.literal(true).optional(),
});
export type SearchBusStop = z.infer<typeof busStopSchema>;
export const busStopSearchResponseSchema = z.object({
  stops: z.array(busStopSchema),
  unavailable: z.array(z.string()),
});

export function indexGtfsBusStops(table: Timetable, source: { id: string; operator: string; label: string }): SearchBusStop[] {
  const routesByStop = new Map<string, Map<string, string>>();
  for (const [routeId, tripIds] of table.routeTrips) {
    const route = table.routes.get(routeId);
    if (route?.mode !== "Bus") continue;
    const name = route.route_short_name || route.route_long_name || routeId;
    for (const tripId of tripIds) {
      for (const { stop_id } of table.byTrip.get(tripId) ?? []) {
        let routes = routesByStop.get(stop_id);
        if (!routes) routesByStop.set(stop_id, routes = new Map());
        routes.set(routeId, name);
      }
    }
  }
  const stops: SearchBusStop[] = [];
  for (const [sourceId, stop] of table.stops) {
    const position = officialStopPosition(table, sourceId);
    if (!sourceId || !stop.stop_name?.trim() || !position ||
        (stop.location_type && stop.location_type !== "0" && stop.location_type !== "1")) continue;
    stops.push({
      id: `bus-stop:${source.id}:${sourceId}`,
      sourceId,
      name: stop.stop_name,
      position,
      operator: source.operator,
      feed: source.label,
      area: stop.stop_city || stop.stop_locality || undefined,
      aliases: stop.stop_code ? [stop.stop_code] : [],
      routes: Array.from(routesByStop.get(sourceId) ?? [], ([id, name]) => ({ id, name })),
    });
  }
  return stops;
}
