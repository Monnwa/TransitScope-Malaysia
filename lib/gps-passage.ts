import { PROGRESS_LIMITS as L,type StopProjection } from "@/lib/route-projection";

export const PASSAGE_LIMITS={maxIntervalMs:60000,minMovementM:L.minimumMovementM} as const;
export type PassageObservation={
  contextKey:string;vehicleId:string;tripId:string;routeId:string|null;shapeId:string|null;serviceDate:string;
  timestamp:number;distanceM:number;rawDistanceM:number;offsetM:number;accuracyM:number|null;confidence:"HIGH"|"LOW";
};
export type PassageEvidence={stopId:string;sequence:number;stopDistanceM:number;inferredPassageTime:string;from:PassageObservation;to:PassageObservation;intervalMs:number;confirmedAt:string|null};
/** Uses original measured timestamps/distances only. No animation dependency. */
export function inferStopPassage(stop:StopProjection,from:PassageObservation,to:PassageObservation,now:number,limits:{maxIntervalMs:number;minMovementM:number}=PASSAGE_LIMITS):PassageEvidence|null {
  const identity=(fix:PassageObservation)=>JSON.stringify([fix.contextKey,fix.vehicleId,fix.tripId,fix.routeId,fix.shapeId,fix.serviceDate]);
  if(identity(from)!==identity(to)||!from.contextKey||!from.vehicleId||!from.tripId||!from.shapeId||!from.serviceDate)return null;
  if(stop.confidence!=="HIGH"||stop.distanceM===null||!Number.isFinite(stop.distanceM)||stop.offsetM===null||!Number.isFinite(stop.offsetM)||stop.offsetM<0||stop.offsetM>L.maxStopOffsetM)return null;
  for(const fix of [from,to])if(fix.confidence!=="HIGH"||![fix.timestamp,fix.distanceM,fix.rawDistanceM,fix.offsetM].every(Number.isFinite)||now-fix.timestamp>L.maxAgeMs||fix.timestamp-now>L.futureToleranceMs||fix.offsetM<0||fix.offsetM>L.highRouteOffsetM||fix.accuracyM!==null&&(!Number.isFinite(fix.accuracyM)||fix.accuracyM<0||fix.accuracyM>L.highAccuracyM)||Math.abs(fix.distanceM-fix.rawDistanceM)>.05)return null;
  const dt=to.timestamp-from.timestamp,delta=to.distanceM-from.distanceM;
  if(dt<=0||dt>limits.maxIntervalMs||delta<limits.minMovementM||delta>L.maximumSpeedMps*dt/1000+L.passedBufferM||to.rawDistanceM<=from.rawDistanceM||stop.distanceM<from.distanceM-.0001||stop.distanceM>to.distanceM+.0001)return null;
  const ratio=Math.max(0,Math.min(1,(stop.distanceM-from.distanceM)/delta));
  return {stopId:stop.id,sequence:stop.sequence,stopDistanceM:stop.distanceM,inferredPassageTime:new Date(from.timestamp+ratio*dt).toISOString(),from:{...from},to:{...to},intervalMs:dt,confirmedAt:null};
}
/** A shorter interval with no greater geometric offset is stronger evidence. */
export function strongerPassage(current:PassageEvidence|undefined,candidate:PassageEvidence){return !current||candidate.intervalMs<current.intervalMs&&candidate.from.offsetM+candidate.to.offsetM<=current.from.offsetM+current.to.offsetM;}
export function retainPassage(passages:PassageEvidence[],candidate:PassageEvidence){const current=passages.find(item=>item.stopId===candidate.stopId&&item.sequence===candidate.sequence);return strongerPassage(current,candidate)?[...passages.filter(item=>item!==current),{...candidate,confirmedAt:current?.confirmedAt??candidate.confirmedAt}]:passages;}
