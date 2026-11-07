import type { Record as TransitRecord } from "@/lib/transit-data";
import { PROGRESS_LIMITS } from "@/lib/route-projection";
import { validGpsPosition } from "@/lib/vehicle-observation";
import type { GpsFix, ProgressHistory, VehicleProgress } from "@/lib/vehicle-progress";
type Entry={identity:string;token:string;record:TransitRecord;fixes:GpsFix[];seen:number;previous?:VehicleProgress};
export function gpsFix(record:TransitRecord):GpsFix|null {
  const timestamp=Date.parse(record.observation?.positionTimestamp??"");if(!validGpsPosition(record.position)||!Number.isFinite(timestamp))return null;
  return {timestamp,position:record.position,bearing:record.bearing??null,speed:record.speed??null,accuracyM:record.observation?.gpsAccuracyM??null};
}
/** Only decoded official observations enter this store; query snapshots never do. */
export class VehicleProgressHistory {
  private entries=new Map<string,Entry>();private generation=0;
  ingest(source:string,records:TransitRecord[],now=Date.now()):TransitRecord[]{
    const prefix=`${source}|`,present=new Set(records.map(record=>`${prefix}${record.id}`));
    for(const [key,entry]of this.entries)if(key.startsWith(prefix)&&!present.has(key)||now-entry.seen>600000)this.entries.delete(key);
    return records.map(record=>{
      const key=`${prefix}${record.id}`,identity=JSON.stringify([record.tripId,record.routeId,record.observation?.tripStartDate,record.observation?.tripStartTime,record.observation?.directionId]),fix=gpsFix(record);
      let entry=this.entries.get(key);
      if(entry&&fix&&entry.fixes.at(-1)&&fix.timestamp<entry.fixes.at(-1)!.timestamp){entry.seen=now;return entry.record;}
      const usable=!!fix&&now-fix.timestamp<=PROGRESS_LIMITS.maxAgeMs&&fix.timestamp-now<=PROGRESS_LIMITS.futureToleranceMs;
      if(!entry||entry.identity!==identity||!usable||entry.fixes.at(-1)&&fix!.timestamp-entry.fixes.at(-1)!.timestamp>PROGRESS_LIMITS.maxAgeMs){entry={identity,token:`${source}:${++this.generation}`,record,fixes:[],seen:now};this.entries.set(key,entry);}
      entry.seen=now;
      if(usable&&fix&&(!entry.fixes.length||fix.timestamp>entry.fixes.at(-1)!.timestamp)){entry.record=record;entry.fixes.push(fix);entry.fixes=entry.fixes.filter(item=>fix.timestamp-item.timestamp<=PROGRESS_LIMITS.maxAgeMs).slice(-8);}
      return entry.record;
    });
  }
  interrupt(source:string){for(const key of this.entries.keys())if(key.startsWith(`${source}|`))this.entries.delete(key);}
  get(source:string,vehicleId:string):ProgressHistory|undefined {const entry=this.entries.get(`${source}|${vehicleId}`);return entry?{token:entry.token,fixes:entry.fixes,previous:entry.previous}:undefined;}
  save(source:string,vehicleId:string,progress:VehicleProgress){const entry=this.entries.get(`${source}|${vehicleId}`);if(!entry||entry.token!==progress.historyToken||progress.vehicleId!==vehicleId||!entry.fixes.length||entry.fixes.at(-1)!.timestamp!==Date.parse(progress.vehicleTimestamp??"")||entry.previous?.vehicleTimestamp&&progress.vehicleTimestamp&&Date.parse(progress.vehicleTimestamp)<Date.parse(entry.previous.vehicleTimestamp))return;entry.previous=progress;}
}
export const officialProgressHistory=new VehicleProgressHistory();
