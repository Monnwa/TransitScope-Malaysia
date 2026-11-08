import { calculateBusJourney, type BusJourney } from "@/lib/bus-journey";
import { newerJourney } from "@/lib/bus-progress";
import type { Timetable } from "@/lib/scheduled-departures";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import { PROGRESS_LIMITS } from "@/lib/route-projection";

export type ProcessedBusJourney = {
  source: string; vehicleId: string;
  state: "READY" | "NO_MATCH" | "DATA_UNAVAILABLE";
  journey: BusJourney | null;
};
export type BusJourneyFeed = {
  timetable: Timetable; tripPaths: Map<string, [number,number][]>;
  progressPaths: Map<string, [number,number][]>; tripShapeDistances: Map<string,number[]>;
};
export const busJourneyKey = (source:string,vehicleId:string) => JSON.stringify([source,vehicleId]);
type Entry = { signature:string; table:Timetable; result:ProcessedBusJourney; seen:number };

/** Feed processing owns progress history. UI selection never advances it. */
export class ProcessedBusJourneys {
  private entries = new Map<string,Entry>();
  constructor(private history:VehicleProgressHistory) {}
  process(source:string,records:TransitRecord[],feed:BusJourneyFeed,now=Date.now()):ProcessedBusJourney[] {
    const present=new Set(records.map(record=>busJourneyKey(source,record.id)));
    for(const [key,entry] of this.entries)if(now-entry.seen>600000||entry.result.source===source&&!present.has(key))this.entries.delete(key);
    return records.filter(record=>record.mode==="Bus"&&record.recordKind==="vehicle").map(record=>{
      const key=busJourneyKey(source,record.id),prior=this.entries.get(key),history=this.history.get(source,record.id);
      const measured=Date.parse(record.observation?.positionTimestamp??""),age=now-measured;
      // Reuse unchanged fixes, but withdraw stale/future claims even without a new observation.
      const freshness=Number.isFinite(age)?age>PROGRESS_LIMITS.maxAgeMs?"stale":age< -PROGRESS_LIMITS.futureToleranceMs?"future":"current":"missing";
      const signature=JSON.stringify([record.tripId,record.routeId,record.position,record.bearing,record.speed,record.observation,history?.token,freshness]);
      if(prior?.table===feed.timetable&&prior.signature===signature){prior.seen=now;return prior.result;}
      const next=calculateBusJourney(feed.timetable,record,{now,paths:feed.tripPaths,gpsPaths:feed.progressPaths,shapeDistances:feed.tripShapeDistances,history});
      const journey=newerJourney(prior?.result.journey??null,next);
      if(journey.tracking)this.history.save(source,record.id,journey.tracking);
      const result:ProcessedBusJourney={source,vehicleId:record.id,state:journey.match.status==="MATCHED"?"READY":"NO_MATCH",journey};
      this.entries.set(key,{signature,table:feed.timetable,result,seen:now});return result;
    });
  }
  unavailable(source:string,records:TransitRecord[],now=Date.now()):ProcessedBusJourney[] {
    for(const [key,entry]of this.entries)if(now-entry.seen>600000)this.entries.delete(key);
    return records.filter(record=>record.mode==="Bus"&&record.recordKind==="vehicle").map(record=>({source,vehicleId:record.id,state:"DATA_UNAVAILABLE",journey:this.entries.get(busJourneyKey(source,record.id))?.result.journey??null}));
  }
}
