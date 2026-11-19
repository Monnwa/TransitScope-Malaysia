import { NextResponse } from "next/server";
import { indexGtfsBusStops, type SearchBusStop } from "@/lib/bus-stop-search";
import { busSourceIds, feeds, getBusStaticFeed } from "@/lib/official-transit";
import type { Timetable } from "@/lib/scheduled-departures";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const indexed = new WeakMap<Timetable, SearchBusStop[]>();

export async function GET() {
  const results = await Promise.allSettled(busSourceIds.map(async id => {
    const { timetable } = await getBusStaticFeed(id);
    const cached = indexed.get(timetable);
    if (cached) return cached;
    const feed = feeds.find(feed => feed.id === id)!;
    const stops = indexGtfsBusStops(timetable, feed);
    if (!stops.length) throw new Error("No valid stops in static feed");
    indexed.set(timetable, stops);
    return stops;
  }));
  const stops = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const unavailable = busSourceIds.filter((_, index) => results[index].status === "rejected");
  return NextResponse.json({ stops, unavailable }, {
    status: stops.length ? 200 : 503,
    headers: { "Cache-Control": unavailable.length ? "no-store" : "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
