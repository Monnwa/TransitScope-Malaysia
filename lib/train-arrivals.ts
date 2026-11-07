import { gtfsSeconds, malaysiaDate, serviceRuns, type Timetable } from "@/lib/scheduled-departures";
import type { Mode } from "@/lib/transit-data";
export type TrainArrival = {
  tripId: string; routeId: string; routeName: string; mode: Mode; stopId: string; destination?: string; direction?: string; platform: string;
  arrivalTime: string; arrivalTimestamp: number; classification: "SCHEDULED" | "ESTIMATED";
  source: string; lastUpdated: string; serviceDate: string;
  basis: "OFFICIAL_STOP_TIME" | "EXACT_FREQUENCY" | "PUBLISHED_FREQUENCY_ANCHOR" | "INTERPOLATED_STOP_TIME";
  headwaySeconds?: number; windowStart?: string; windowEnd?: string;
};
export const isArrivalMode = (mode: string) => ["MRT", "LRT", "Monorail"].includes(mode);
export const frequencyKey = (source: string, tripId: string, platform?: string, start?: string, end?: string) => `${source}|${tripId}|${platform ?? ""}|${start??""}|${end??""}`;
export function calculateTrainArrivals(table: Timetable, stopIds: string[], now = Date.now()) {
  const arrivals: TrainArrival[] = [], covered = new Set<string>();
  const todayMidnight = Date.parse(`${malaysiaDate(now)}T00:00:00+08:00`), horizon = todayMidnight + 2 * 86400000;
  const records = [...new Set(stopIds)].flatMap(stopId => (table.arrivalStops.get(stopId) ?? []).map(row => ({stopId,row})));
  let activeToday=false, hasRecords=false, windowToday=false;
  let maximumShift = 0;
  for (const {row} of records) { const origin = gtfsSeconds(table.origins.get(row.trip_id)?.departure_time ?? ""), arrival = gtfsSeconds(row.arrival_time); if (origin !== null && arrival !== null) maximumShift = Math.max(maximumShift, arrival-origin); }
  for (let day = -Math.ceil((table.maxSeconds + maximumShift) / 86400); day <= 1; day++) {
    const midnight = todayMidnight + day * 86400000, serviceDate = malaysiaDate(midnight);
    for (const {stopId,row} of records) {
      const trip = table.trips.get(row.trip_id), route = trip && table.routes.get(trip.route_id);
      if (!trip || !route || !isArrivalMode(route.mode) || route.category?.toUpperCase() === "BRT") continue;
      hasRecords=true;if(!serviceRuns(table,trip.service_id,serviceDate))continue;if(day===0)activeToday=true;
      const arrival = gtfsSeconds(row.arrival_time); if (arrival === null) continue;
      const departure = gtfsSeconds(row.departure_time); if (departure !== null && departure < arrival) continue;
      const stop = table.stops.get(stopId);
      const base = { tripId:trip.trip_id,routeId:trip.route_id,routeName:route.route_long_name||route.route_short_name||trip.route_id,mode:route.mode,stopId,destination:trip.trip_headsign||table.stops.get(table.destination.get(trip.trip_id)??"")?.stop_name,direction:trip.direction_id||undefined,platform:stop?.platform_code||stop?.stop_code||stopId,source:table.source,lastUpdated:table.updated,serviceDate };
      const windows = table.frequencies.get(trip.trip_id);
      const push = (timestamp:number, details:Pick<TrainArrival,"classification"|"basis"> & Partial<TrainArrival>) => { if(timestamp>=now && timestamp<horizon) arrivals.push({...base,...details,arrivalTime:new Date(timestamp).toISOString(),arrivalTimestamp:timestamp}); };
      if (!windows?.length) { push(midnight+arrival*1000,{classification:row.timepoint==="0"?"ESTIMATED":"SCHEDULED",basis:row.timepoint==="0"?"INTERPOLATED_STOP_TIME":"OFFICIAL_STOP_TIME"}); continue; }
      // A true first-stop departure is required. A later stop's minimum time is
      // never substituted as a phase anchor when the first stop is incomplete.
      const origin = table.origins.get(trip.trip_id), originDeparture = gtfsSeconds(origin?.departure_time??"");
      if (!origin || table.originConflicts.has(trip.trip_id) || originDeparture === null || !row.stop_sequence || !Number.isInteger(Number(row.stop_sequence)) || Number(row.stop_sequence)<0 || !Number.isInteger(Number(origin.stop_sequence)) || Number(origin.stop_sequence)<0) continue;
      if (Number(row.stop_sequence)<Number(origin.stop_sequence) || Number(row.stop_sequence)>Number(origin.stop_sequence) && arrival<originDeparture || Number(row.stop_sequence)===Number(origin.stop_sequence) && stopId!==origin.stop_id) continue;
      const shift = arrival-originDeparture;
      const parsed = [...new Map(windows.map(window => [`${window.start_time}|${window.end_time}|${window.headway_secs}|${window.exact_times||"0"}`,window])).values()].map(window=>({start:gtfsSeconds(window.start_time),end:gtfsSeconds(window.end_time),headway:Number(window.headway_secs),exact:window.exact_times||"0"}));
      if (parsed.some(window=>window.start===null||window.end===null||window.end<=window.start||!Number.isInteger(window.headway)||window.headway<=0||!["0","1"].includes(window.exact))) continue;
      parsed.sort((a,b)=>a.start!-b.start!);
      if (parsed.some((window,index)=>index>0&&window.start!<parsed[index-1].end!)) continue;
      for (const window of parsed) {
        const start=window.start!, end=window.end!, anchor=midnight+(start+shift)*1000, until=midnight+(end+shift)*1000;
        if (until<=now || anchor>=horizon) continue;
        if(anchor<todayMidnight+86400000)windowToday=true;
        const before=arrivals.length;
        const firstSlot=Math.max(0,Math.ceil((now-anchor)/(window.headway*1000)));
        // The grid is anchored to the published first-vehicle departure, offset
        // to this stop's arrival. With exact_times=0 it is explicitly a model,
        // not a promise of an individual train's actual phase or live position.
        for(let slot=firstSlot,count=0;count<10;slot++,count++) {
          const timestamp=anchor+slot*window.headway*1000;
          if(timestamp>=until || timestamp>=horizon)break;
          const exact=window.exact==="1" && row.timepoint!=="0";
          push(timestamp,{classification:exact?"SCHEDULED":"ESTIMATED",basis:exact?"EXACT_FREQUENCY":window.exact==="1"?"INTERPOLATED_STOP_TIME":"PUBLISHED_FREQUENCY_ANCHOR",headwaySeconds:window.headway,windowStart:new Date(anchor).toISOString(),windowEnd:new Date(until).toISOString()});
        }
        if(arrivals.length>before && departure!==null)covered.add(frequencyKey(table.source,trip.trip_id,base.platform,new Date(midnight+(start+departure-originDeparture)*1000).toISOString(),new Date(midnight+(end+departure-originDeparture)*1000).toISOString()));
      }
    }
  }
  const unique=new Map<string,TrainArrival>();
  for(const arrival of arrivals) { const key=`${arrival.source}|${arrival.routeId}|${arrival.stopId}|${arrival.direction??""}|${arrival.destination??""}|${arrival.arrivalTimestamp}`; const prior=unique.get(key);if(!prior||prior.classification==="ESTIMATED"&&arrival.classification==="SCHEDULED")unique.set(key,arrival); }
  const result=[...unique.values()].sort((a,b)=>a.arrivalTimestamp-b.arrivalTimestamp);
  return { trainArrivals:result.slice(0,10), arrivalFrequencyCoverage:[...covered], hasRecords, activeToday, noMoreToday:!windowToday&&!result.some(item=>item.arrivalTimestamp<todayMidnight+86400000) };
}
