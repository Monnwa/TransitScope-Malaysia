import type { BusJourney } from "@/lib/bus-journey";
import type { Timetable } from "@/lib/scheduled-departures";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { indexShape, projectStops, PROGRESS_LIMITS, type GeoPoint, type StopProjection } from "@/lib/route-projection";
import { evaluateVehicleProgress, unknownProgress, type ProgressHistory, type VehicleProgress } from "@/lib/vehicle-progress";
import { gpsFix } from "@/lib/vehicle-progress-history";
import { retainJourneyAdherence } from "@/lib/timetable-adherence";
const stopCache=new WeakMap<Timetable,Map<string,StopProjection[]>>();
export type GpsJourneyOptions={paths?:Map<string,GeoPoint[]>;gpsPaths?:Map<string,GeoPoint[]>;shapeDistances?:Map<string,number[]>;history?:ProgressHistory;now?:number};
export function applyBusProgress(journey:BusJourney,table:Timetable,vehicle:TransitRecord,options:GpsJourneyOptions):BusJourney {
  if(vehicle.mode!=="Bus"||vehicle.dataMode==="SIMULATED")return journey;
  const active=journey.vehicleDeparture,selected=journey.selectedDeparture;
  if(!active||!selected||active.key!==selected.key||journey.match.status!=="MATCHED")return journey;
  const trip=table.trips.get(active.tripId),shapeId=trip?.shape_id||null;
  const path=(options.gpsPaths??options.paths)?.get(active.tripId),shape=path?indexShape(path):null;
  const now=options.now??Date.now(),fix=gpsFix(vehicle),token=options.history?.token??"single-observation";
  const context={key:JSON.stringify([vehicle.feedId,vehicle.id,journey.route?.id,active.key,shapeId,shape?.fingerprint]),historyToken:token,vehicleId:vehicle.id,tripId:active.tripId,routeId:journey.route?.id??null,shapeId,serviceDate:active.serviceDate,stops:[] as StopProjection[]};
  const explicit=vehicle.observation?.currentStopSequence!==undefined;
  if(explicit){
    const valid=["AT_STOP","IN_TRANSIT","APPROACHING","COMPLETED"].includes(journey.progress.status);
    journey.tracking=unknownProgress(context,valid?journey.progress.message:"Reported stop sequence conflicts with the selected trip.",now,fix?.timestamp??null);
    if(valid){journey.tracking.source="LIVE_PROGRESS";journey.tracking.confidence="HIGH";journey.tracking.lastSuccessfulMatchTime=vehicle.observation?.positionTimestamp??null;journey.tracking.nextStopSequence=journey.progress.sequence;}
    return journey;
  }
  if(vehicle.observation?.stopId)return journey; // Preserve the existing explicit stop hint.
  if(!shape||!shapeId){journey.tracking=unknownProgress(context,"The matched trip has no validated GTFS shape. Scheduled stops are retained.",now,fix?.timestamp??null,options.history?.previous);return journey;}
  let cached=stopCache.get(table);if(!cached){cached=new Map();stopCache.set(table,cached);}
  const cacheKey=`${active.tripId}|${shape.fingerprint}`;
  let projected=cached.get(cacheKey);
  if(!projected){
    projected=projectStops(shape,journey.stops.map(stop=>{
      const row=table.stops.get(stop.id),lat=row?.stop_lat?.trim(),lon=row?.stop_lon?.trim();
      const time=table.byTrip.get(active.tripId)?.find(item=>Number(item.stop_sequence)===stop.sequence&&item.stop_id===stop.id);
      const raw=time?.shape_dist_traveled?.trim(),reference=raw?Number(raw):null;
      return {id:stop.id,sequence:stop.sequence,name:stop.name,position:lat&&lon?[Number(lat),Number(lon)] as GeoPoint:null,shapeDistance:reference!==null&&Number.isFinite(reference)?reference:null};
    }),options.shapeDistances?.get(active.tripId));cached.set(cacheKey,projected);
  }
  const passageKey=context.key;
  context.stops=projected;context.key+=JSON.stringify(projected.map(stop=>[stop.sequence,stop.distanceM===null?null:Math.round(stop.distanceM)]));
  journey.tracking=fix?evaluateVehicleProgress({...context,passageKey},shape,fix,now,options.history):unknownProgress({...context,passageKey},"Vehicle GPS coordinate or measurement timestamp unavailable.",now,null,options.history?.previous);
  const tracking=journey.tracking;
  if(["GPS_INFERRED","APPROXIMATE"].includes(tracking.source)){
    journey.stops=journey.stops.map(stop=>{const state=tracking.stopStates.find(item=>item.sequence===stop.sequence)?.state;return {...stop,status:state==="PASSED"?"PASSED":state==="UPCOMING"?"UPCOMING":"UNKNOWN"};});
    journey.progress={status:tracking.status==="NEAR_STOP"?"APPROACHING":"IN_TRANSIT",sequence:tracking.nextStopSequence,message:tracking.reason};
  }
  return journey;
}
/** Older packets must not rewind a currently displayed matched vehicle run. */
export function newerJourney(current:BusJourney|null,next:BusJourney):BusJourney {
  const sameSelection=current?.selectedDeparture?.key===next.selectedDeparture?.key;
  const bothVehicleRuns=current?.selectedDeparture?.key===current?.vehicleDeparture?.key&&next.selectedDeparture?.key===next.vehicleDeparture?.key;
  if(current&&current.vehicle.id===next.vehicle.id&&(sameSelection||bothVehicleRuns)&&current.vehicle.realtimeAvailable&&next.vehicle.realtimeAvailable&&current.vehicle.reportedAt&&next.vehicle.reportedAt&&Date.parse(next.vehicle.reportedAt)<Date.parse(current.vehicle.reportedAt))return current;
  return retainJourneyAdherence(current,next);
}
export function currentTracking(tracking:VehicleProgress|undefined,now:number,available=true):VehicleProgress|undefined {
  if(tracking&&!available)return {...tracking,source:"PROGRESS_UNKNOWN",status:"UNKNOWN",confidence:"LOW",position:null,distanceM:null,segment:null,nextStopSequence:null,previousStopSequence:null,stopStates:tracking.stopStates.map(stop=>({...stop,state:"SCHEDULED"})),reason:"Realtime evidence is unavailable; last matched position is historical only.",state:null};
  if(!tracking?.vehicleTimestamp)return tracking;
  const age=now-Date.parse(tracking.vehicleTimestamp);
  if(age<=PROGRESS_LIMITS.maxAgeMs&&age>=-PROGRESS_LIMITS.futureToleranceMs)return tracking;
  return {...tracking,source:"STALE",status:"STALE",confidence:"LOW",position:null,distanceM:null,segment:null,nextStopSequence:null,previousStopSequence:null,stopStates:tracking.stopStates.map(stop=>({...stop,state:"SCHEDULED"})),reason:"Last seen position is stale; current stop progress is unknown.",state:null,ageSeconds:Math.round(age/1000)};
}
