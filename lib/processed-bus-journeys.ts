import { calculateBusJourney, type BusJourney } from "@/lib/bus-journey";
import { newerJourney } from "@/lib/bus-progress";
import type { Timetable } from "@/lib/scheduled-departures";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import { PROGRESS_LIMITS } from "@/lib/route-projection";
import { attachAdherenceDiagnostics } from "@/lib/adherence-diagnostics";
import type { ProgressHistory } from "@/lib/vehicle-progress";
import type { BusEvidencePersistence } from "@/lib/bus-evidence";
import type { ClassificationEvidenceArchive, RetainClassificationAdmission } from "@/lib/classification-evidence-store";
import type { ValidAdherence } from "@/lib/timetable-adherence";

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
  constructor(
    private history:VehicleProgressHistory,
    private persistence?:BusEvidencePersistence,
    private archive?:ClassificationEvidenceArchive,
  ) {}
  async processWithPersistence(source:string,records:TransitRecord[],feed:BusJourneyFeed,now?:number,retainAdmission?:RetainClassificationAdmission):Promise<ProcessedBusJourney[]> {
    const started=performance.now();
    const clock=now===undefined?Date.now:()=>now;
    if(!this.persistence){
      const results=this.process(source,records,feed,clock());
      await this.archive?.finishFeed(now,retainAdmission);
      return results;
    }
    const failures=this.persistence.status().failures;
    let prepared:ReturnType<BusEvidencePersistence["prepare"]>=[],histories:Map<string,ProgressHistory>|undefined;
    try { prepared=this.persistence.prepare(source,records,feed,id=>this.history.get(source,id),clock());histories=await this.persistence.hydrate(prepared,clock()); }
    catch { this.persistence.unavailable(); }
    const results=this.process(source,records,feed,clock(),histories);
    const admission=this.archive?.finishFeed(now,retainAdmission);
    try { await this.persistence.persist(prepared,new Map(results.filter(entry=>entry.journey).map(entry=>[entry.vehicleId,entry.journey!])),clock()); }
    catch { this.persistence.unavailable(); }
    if(this.persistence.status().failures>failures)for(const entry of results)for(const stop of entry.journey?.stops??[])if(stop.adherence?.diagnostic&&!stop.adherence.diagnostic.secondary.includes("PERSISTENCE_UNAVAILABLE"))stop.adherence={...stop.adherence,diagnostic:{...stop.adherence.diagnostic,secondary:[...stop.adherence.diagnostic.secondary,"PERSISTENCE_UNAVAILABLE"]}};
    this.persistence.recordProcessing(performance.now()-started);
    await admission;
    return results;
  }
  process(source:string,records:TransitRecord[],feed:BusJourneyFeed,now=Date.now(),histories?:Map<string,ProgressHistory>):ProcessedBusJourney[] {
    const present=new Set(records.map(record=>busJourneyKey(source,record.id)));
    for(const [key,entry] of this.entries)if(now-entry.seen>600000||entry.result.source===source&&!present.has(key))this.entries.delete(key);
    return records.filter(record=>record.mode==="Bus"&&record.recordKind==="vehicle").map(record=>{
      const key=busJourneyKey(source,record.id),prior=this.entries.get(key),history=histories?.get(record.id)??this.history.get(source,record.id);
      const measured=Date.parse(record.observation?.positionTimestamp??""),age=now-measured;
      // Reuse unchanged fixes, but withdraw stale/future claims even without a new observation.
      const freshness=Number.isFinite(age)?age>PROGRESS_LIMITS.maxAgeMs?"stale":age< -PROGRESS_LIMITS.futureToleranceMs?"future":"current":"missing";
      const signature=JSON.stringify([record.tripId,record.routeId,record.position,record.bearing,record.speed,record.observation,history?.token,freshness]);
      if(!histories?.has(record.id)&&prior?.table===feed.timetable&&prior.signature===signature){prior.seen=now;return prior.result;}
      const next=calculateBusJourney(feed.timetable,record,{now,paths:feed.tripPaths,gpsPaths:feed.progressPaths,shapeDistances:feed.tripShapeDistances,history});
      // Keep the directly evaluated results separate from assessments carried forward by retention.
      const directResults = this.archive ? new Set<ValidAdherence>(
        next.stops.flatMap(stop => stop.adherence?.result ? [stop.adherence.result] : []),
      ) : undefined;
      const journey=attachAdherenceDiagnostics(newerJourney(prior?.result.journey??null,next),now);
      if (journey === next && directResults?.size) this.archive?.capture(source, journey, directResults, now);
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
