import { NextRequest, NextResponse } from "next/server";
import { calculateTrainArrivals } from "@/lib/train-arrivals";
import { getTimetable } from "@/lib/official-transit";
import { calculateDepartures, malaysiaDate } from "@/lib/scheduled-departures";
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
    try { const table = await getTimetable(source); const result = calculateDepartures(table, refs.filter(ref => ref.startsWith(source + ":")).map(ref => ref.slice(source.length + 1)), now); const dateKey = malaysiaDate(now).replaceAll("-", ""); const relevantServices = new Set(refs.filter(ref=>ref.startsWith(source+":" )).flatMap(ref=>[...(table.byStop.get(ref.slice(source.length+1))??[]),...(source==="rapid-rail-kl"?table.arrivalStops.get(ref.slice(source.length+1))??[]:[])]).map(row=>table.trips.get(row.trip_id)?.service_id)); const calendarCoversToday = table.calendars.some(row=>relevantServices.has(row.service_id)&&row.start_date<=dateKey&&row.end_date>=dateKey)||table.exceptions.some(row=>relevantServices.has(row.service_id)&&row.date===dateKey); return { source, result, arrivals: source === "rapid-rail-kl" ? calculateTrainArrivals(table, refs.filter(ref=>ref.startsWith(source+":")).map(ref=>ref.slice(source.length+1)), now) : null, calendarCoversToday, lastUpdated: table.updated, error: null }; }
    catch { return { source, result: null, arrivals: null, calendarCoversToday: false, error: "Official timetable could not be retrieved.", lastUpdated: null }; }
  }));
  const departures = outcomes.flatMap(item => item.result?.departures ?? []).sort((a, b) => a.scheduledTimestamp - b.scheduledTimestamp).slice(0, 10);
  const frequencies = outcomes.flatMap(item => item.result?.frequencies ?? []).slice(0, 10);
  const trainArrivals = outcomes.flatMap(item=>item.arrivals?.trainArrivals??[]).sort((a,b)=>a.arrivalTimestamp-b.arrivalTimestamp).slice(0,10);
  const arrivalFrequencyCoverage = outcomes.flatMap(item=>item.arrivals?.arrivalFrequencyCoverage??[]);
  const hasRecords = trainArrivals.length > 0 || outcomes.some(item => item.result?.hasRecords || item.arrivals?.hasRecords);
  const validPeriod = trainArrivals.length > 0 || departures.length > 0 || frequencies.length > 0 || outcomes.some(item=>item.result?.activeToday || item.arrivals?.activeToday);
  const emptyReason = trainArrivals.some(item=>malaysiaDate(item.arrivalTimestamp)===malaysiaDate(now)) ? null : !hasRecords || !validPeriod && !outcomes.some(item=>item.calendarCoversToday) ? "TIMETABLE_UNAVAILABLE" : outcomes.every(item=>item.result && item.calendarCoversToday && !item.result.activeToday && !item.arrivals?.activeToday && item.result.noMoreToday && (item.arrivals?.noMoreToday??true)) ? "NO_SERVICE_TODAY" : outcomes.every(item=>item.result?.noMoreToday && (item.arrivals?.noMoreToday??true)) ? "NO_MORE_TODAY" : null;
  const message = !hasRecords ? "Official timetable unavailable for this stop."
    : !validPeriod ? "No valid published service calendar for the current period; departures are unavailable."
    : emptyReason === "NO_MORE_TODAY" ? "No more scheduled departures today."
    : trainArrivals.length ? "Official GTFS train arrivals; each row identifies scheduled or estimated information."
    : frequencies.length && !departures.length ? "Official frequency timetable; exact departure times are not published."
    : "Official published timetable — Asia/Kuala_Lumpur";
  return NextResponse.json({
    status: hasRecords && validPeriod ? "SCHEDULED" : "UNAVAILABLE", departures, frequencies,
    trainArrivals, arrivalFrequencyCoverage, emptyReason,
    liveEta: { available: false, reason: "The official realtime API currently provides VehiclePosition only; no verified TripUpdate predictions are available." },
    message, sources: outcomes.map(({source,lastUpdated,error}) => ({source,lastUpdated,error})), retrievedAt: new Date(now).toISOString()
  }, { headers: { "Cache-Control": "no-store" } });
}
