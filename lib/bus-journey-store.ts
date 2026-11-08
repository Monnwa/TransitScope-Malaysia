import { newerJourney } from "@/lib/bus-progress";
import type { TransitApiResponse } from "@/lib/transit-data";
import type { ProcessedBusJourney } from "@/lib/processed-bus-journeys";

const key=(entry:{source:string;vehicleId:string})=>JSON.stringify([entry.source,entry.vehicleId]);
/** Browser-session retention belongs to the dashboard, including buses never selected. */
export function mergeProcessedTransit(current:TransitApiResponse|null,next:TransitApiResponse):TransitApiResponse {
  if(!current||current.demo||next.demo)return next;
  const failed=new Set(next.feeds.filter(feed=>feed.status!=="healthy").map(feed=>feed.id));
  const presentRecords=new Set(next.records.map(record=>JSON.stringify([record.feedId,record.id])));
  const records=[...next.records,...current.records.filter(record=>record.feedId&&failed.has(record.feedId)&&!presentRecords.has(JSON.stringify([record.feedId,record.id])))];
  if(next.busJourneys===undefined)return {...next,records};
  const old=new Map((current.busJourneys??[]).map(entry=>[key(entry),entry]));
  const entries=next.busJourneys.map(entry=>{
    const prior=old.get(key(entry));
    if(entry.journey)return {...entry,journey:newerJourney(prior?.journey??null,entry.journey)};
    return entry.state==="DATA_UNAVAILABLE"&&prior?{...entry,journey:prior.journey}:entry;
  });
  const present=new Set(entries.map(key));
  const retained:ProcessedBusJourney[]=(current.busJourneys??[]).filter(entry=>failed.has(entry.source)&&!present.has(key(entry))).map(entry=>({...entry,state:"DATA_UNAVAILABLE"}));
  return {...next,records,busJourneys:[...entries,...retained]};
}
