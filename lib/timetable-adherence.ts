import type { BusJourney,JourneyStop } from "@/lib/bus-journey";
import { strongerPassage,type PassageEvidence } from "@/lib/gps-passage";
import { PROGRESS_LIMITS } from "@/lib/route-projection";

export const ON_TIME_TOLERANCE_SECONDS=120;
export const ADHERENCE_EXPLANATION="Timetable adherence is estimated from GPS-observed vehicle movement across the stop location. It does not confirm actual stop arrival or departure.";
export type AdherenceStatus="EARLY"|"ON_TIME"|"DELAYED"|"STATUS_UNKNOWN";
export type ValidAdherence={status:Exclude<AdherenceStatus,"STATUS_UNKNOWN">;inferredPassageTime:string;scheduledReferenceTime:string;differenceSeconds:number;differenceMinutes:number;evidence:PassageEvidence;toleranceSeconds:number};
export type StopAdherence={status:AdherenceStatus;reference:"DEPARTURE";label:"GPS-INFERRED";reason:string;result:ValidAdherence|null;lastValid:ValidAdherence|null};
export function classifyAdherence(differenceSeconds:number,toleranceSeconds=ON_TIME_TOLERANCE_SECONDS):AdherenceStatus {
  if(!Number.isFinite(differenceSeconds)||!Number.isFinite(toleranceSeconds)||toleranceSeconds<0)return "STATUS_UNKNOWN";
  return differenceSeconds>toleranceSeconds?"DELAYED":differenceSeconds< -toleranceSeconds?"EARLY":"ON_TIME";
}
export const adherenceLabel=(result:ValidAdherence)=>result.status==="ON_TIME"?"ON TIME":`${result.status} ${result.differenceMinutes} MIN`;
const unknown=(reason:string,lastValid:ValidAdherence|null=null):StopAdherence=>({status:"STATUS_UNKNOWN",reference:"DEPARTURE",label:"GPS-INFERRED",reason,result:null,lastValid});
export function assessStopAdherence(journey:BusJourney,stop:JourneyStop,now:number,toleranceSeconds=ON_TIME_TOLERANCE_SECONDS):StopAdherence {
  const tracking=journey.tracking,selected=journey.selectedDeparture;
  const evidence=tracking?.passages?.find(item=>item.stopId===stop.id&&item.sequence===stop.sequence&&item.confirmedAt);
  const reference=stop.departure?Date.parse(stop.departure):NaN;
  if(!selected||selected.key!==journey.vehicleDeparture?.key||journey.match.status!=="MATCHED")return unknown("The selected stop is not on a uniquely matched current vehicle run.");
  if(selected.classification!=="SCHEDULED"||stop.classification!=="SCHEDULED"||!Number.isFinite(reference))return unknown("An exact official scheduled departure reference is unavailable.");
  if(!evidence||!tracking?.stopProjections.some(projection=>projection.id===stop.id&&projection.sequence===stop.sequence&&projection.confidence==="HIGH"&&projection.distanceM!==null&&Math.abs(projection.distanceM-evidence.stopDistanceM)<.05)||evidence.from.contextKey!==(tracking?.passageKey??tracking?.key)||evidence.to.contextKey!==(tracking?.passageKey??tracking?.key)||evidence.to.vehicleId!==journey.vehicle.id||evidence.to.tripId!==selected.tripId||evidence.to.serviceDate!==selected.serviceDate||evidence.to.routeId!==(journey.route?.id??null))return unknown("No reliable GPS crossing pair was recorded for this exact trip stop; earlier passage cannot be reconstructed.");
  const passage=Date.parse(evidence.inferredPassageTime),differenceSeconds=(passage-reference)/1000,status=classifyAdherence(differenceSeconds,toleranceSeconds);
  if(status==="STATUS_UNKNOWN")return unknown("The crossing or timetable reference is invalid.");
  const result:ValidAdherence={status,inferredPassageTime:evidence.inferredPassageTime,scheduledReferenceTime:stop.departure!,differenceSeconds,differenceMinutes:Math.round(Math.abs(differenceSeconds)/60),evidence,toleranceSeconds};
  const age=now-Date.parse(tracking?.vehicleTimestamp??"");
  if(!journey.vehicle.realtimeAvailable||tracking?.source!=="GPS_INFERRED"||tracking.confidence!=="HIGH"||!Number.isFinite(age)||age>PROGRESS_LIMITS.maxAgeMs||age< -PROGRESS_LIMITS.futureToleranceMs)return unknown("Current GPS evidence is unavailable or stale. The last valid observations are historical.",result);
  if(stop.status!=="PASSED")return unknown("Timetable adherence is only classified for GPS-passed stops.");
  return {status,reference:"DEPARTURE",label:"GPS-INFERRED",reason:"Compared with the exact scheduled departure for this service-date trip stop.",result,lastValid:null};
}
export function applyJourneyAdherence(journey:BusJourney,now:number,toleranceSeconds=ON_TIME_TOLERANCE_SECONDS):BusJourney {
  journey.stops=journey.stops.map(stop=>({...stop,adherence:assessStopAdherence(journey,stop,now,toleranceSeconds)}));return journey;
}
/** Client freshness changes withdraw current claims without rewriting the historical estimate. */
export function displayedAdherence(assessment:StopAdherence|undefined,fresh:boolean){if(!assessment)return unknown("No reliable GPS crossing pair was recorded for this stop.");return fresh?assessment:unknown("Current GPS evidence is unavailable or stale. Last valid observations are historical.",assessment.result??assessment.lastValid);}
export function adherenceSummary(stops:JourneyStop[]){const passed=stops.filter(stop=>stop.status==="PASSED");return {passed:passed.length,early:passed.filter(stop=>stop.adherence?.status==="EARLY").length,onTime:passed.filter(stop=>stop.adherence?.status==="ON_TIME").length,delayed:passed.filter(stop=>stop.adherence?.status==="DELAYED").length,unknown:passed.filter(stop=>!stop.adherence||stop.adherence.status==="STATUS_UNKNOWN").length};}
/** API history is bounded/serverless; retain established evidence for this same run and exact schedule. */
export function retainJourneyAdherence(current:BusJourney|null,next:BusJourney):BusJourney {
  if(!current||current.vehicle.id!==next.vehicle.id||current.source!==next.source||current.route?.id!==next.route?.id||current.selectedDeparture?.key!==next.selectedDeparture?.key||next.selectedDeparture?.key!==next.vehicleDeparture?.key||next.tracking?.shapeId&&current.tracking?.shapeId!==next.tracking.shapeId)return next;
  next.stops=next.stops.map(stop=>{
    const old=current.stops.find(item=>item.id===stop.id&&item.sequence===stop.sequence&&item.departure===stop.departure&&item.classification===stop.classification)?.adherence,previous=old?.result??old?.lastValid,newResult=stop.adherence?.result;
    if(!previous||stop.status==="UPCOMING"||next.progress.status==="TIMETABLE_PREVIEW")return stop;
    const projection=next.tracking?.stopProjections.find(item=>item.id===stop.id&&item.sequence===stop.sequence);
    if(projection?.distanceM!==null&&projection?.distanceM!==undefined&&Math.abs(projection.distanceM-previous.evidence.stopDistanceM)>.05)return stop;
    if(newResult&&(newResult.toleranceSeconds!==previous.toleranceSeconds||strongerPassage(previous.evidence,newResult.evidence)))return stop;
    const age=Date.parse(next.retrievedAt)-Date.parse(next.tracking?.vehicleTimestamp??"");
    const fresh=stop.status==="PASSED"&&next.match.status==="MATCHED"&&next.tracking?.source==="GPS_INFERRED"&&next.tracking.confidence==="HIGH"&&next.vehicle.realtimeAvailable&&projection?.confidence==="HIGH"&&Number.isFinite(age)&&age<=PROGRESS_LIMITS.maxAgeMs&&age>=-PROGRESS_LIMITS.futureToleranceMs;
    const assessment=fresh?{status:previous.status,reference:"DEPARTURE" as const,label:"GPS-INFERRED" as const,reason:"Retained reliable crossing evidence for the same exact run and schedule.",result:previous,lastValid:null}:unknown("Last valid observations retained; current GPS adherence is unknown.",previous);
    return {...stop,adherence:assessment};
  });return next;
}
