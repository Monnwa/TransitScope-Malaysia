import { NextRequest, NextResponse } from "next/server";
import { getTimetable } from "@/lib/official-transit";
import { calculateDepartures } from "@/lib/scheduled-departures";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const coverage = request.nextUrl.searchParams.get("coverage");
  if (coverage) {
    if (!["rapid-rail-kl","ktmb","rapid-bus-kl","rapid-bus-mrtfeeder","rapid-bus-penang"].includes(coverage)) return NextResponse.json({error:"Unknown source"},{status:400});
    try { const table = await getTimetable(coverage); const supported = [...table.stops.keys()].filter(id=>table.byStop.has(id));
      return NextResponse.json({ source:coverage, canonicalStops:table.stops.size, publishedTimetableStops:supported.length, unavailableStops:table.stops.size-supported.length, frequencyTripCount:table.frequencies.size, lastUpdated:table.updated, note:"Canonical GTFS stop counts before interchange/marker merging; published record coverage, not a guarantee of service on every date." });
    } catch {return NextResponse.json({source:coverage,status:"UNAVAILABLE"},{status:503});}
  }
  const refs = [...new Set(request.nextUrl.searchParams.getAll("stop"))];
  const valid = /^(rapid-rail-kl|rapid-bus-kl|rapid-bus-mrtfeeder|rapid-bus-penang|ktmb):[A-Za-z0-9_.-]{1,80}$/;
  if (!refs.length || refs.length > 20 || refs.some(ref => !valid.test(ref))) return NextResponse.json({ status: "UNAVAILABLE", message: "Provide 1–20 canonical GTFS stop IDs." }, { status: 400 });
  const now = Date.now(); const sources = [...new Set(refs.map(ref => ref.split(":")[0]))];
  const outcomes = await Promise.all(sources.map(async source => {
    try { const table = await getTimetable(source); return { source, result: calculateDepartures(table, refs.filter(ref => ref.startsWith(source + ":")).map(ref => ref.slice(source.length + 1)), now), lastUpdated: table.updated, error: null }; }
    catch { return { source, result: null, error: "Official timetable could not be retrieved.", lastUpdated: null }; }
  }));
  const departures = outcomes.flatMap(item => item.result?.departures ?? []).sort((a, b) => a.scheduledTimestamp - b.scheduledTimestamp).slice(0, 10);
  const frequencies = outcomes.flatMap(item => item.result?.frequencies ?? []).slice(0, 10);
  const hasRecords = outcomes.some(item => item.result?.hasRecords);
  const validPeriod = departures.length > 0 || frequencies.length > 0 || outcomes.some(item=>item.result?.activeToday);
  return NextResponse.json({ status: hasRecords && validPeriod ? "SCHEDULED" : "UNAVAILABLE", departures, frequencies, liveEta: { available: false, reason: "The official realtime API currently provides VehiclePosition only; no verified TripUpdate predictions are available." }, message: !hasRecords ? "Official timetable unavailable for this stop." : !validPeriod ? "No valid published service calendar for the current period; departures are unavailable." : outcomes.every(item => item.result?.noMoreToday) ? "No more scheduled departures today." : frequencies.length && !departures.length ? "Official frequency timetable; exact departure times are not published." : "Official published timetable — Asia/Kuala_Lumpur", sources: outcomes.map(({source,lastUpdated,error}) => ({source,lastUpdated,error})), retrievedAt: new Date(now).toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
