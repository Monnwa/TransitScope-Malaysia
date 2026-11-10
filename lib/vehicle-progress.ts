import { angleDifference, bearing, distanceM, distinctCandidates, pointAtDistance, projectCandidates, PROGRESS_LIMITS as L, type GeoPoint, type ShapeIndex, type StopProjection } from "@/lib/route-projection";
import { inferStopPassage,retainPassage,type PassageEvidence,type PassageObservation } from "@/lib/gps-passage";
import { busMotionScope,historicalBusSpeed,type HistoricalSpeed,type SpeedSample } from "@/lib/bus-motion";
import { rejectedPassageDiagnostic, type PassageDiagnostic, type DiagnosticReason } from "@/lib/adherence-diagnostics";
export type GpsFix={timestamp:number;position:GeoPoint;bearing:number|null;speed:number|null;accuracyM:number|null};
type MatchedFix=GpsFix&{distanceM:number;rawDistanceM:number;offsetM:number;point:GeoPoint;segment:number};
export type ProgressState={last:MatchedFix;origin:MatchedFix;highEvidence:boolean;confirmedDistanceM:number;speedSamples?:SpeedSample[];speedScope?:string};
export type VehicleProgress={
  key:string;historyToken:string;vehicleId:string;tripId:string;shapeId:string|null;serviceDate:string;
  source:"GPS_INFERRED"|"APPROXIMATE"|"PROGRESS_UNKNOWN"|"STALE"|"LIVE_PROGRESS";
  confidence:"HIGH"|"MEDIUM"|"LOW";status:"BEFORE_FIRST"|"BETWEEN_STOPS"|"NEAR_STOP"|"BEYOND_LAST"|"ON_ROUTE"|"UNKNOWN"|"STALE";
  vehicleTimestamp:string|null;ageSeconds:number|null;accuracyM:number|null;
  distanceM:number|null;rawDistanceM:number|null;offsetM:number|null;position:GeoPoint|null;segment:number|null;
  previousStopSequence:number|null;previousPassedStopSequence:number|null;nextStopSequence:number|null;
  stopProjections:StopProjection[];stopStates:{sequence:number;state:"PASSED"|"UPCOMING"|"SCHEDULED"}[];
  lastSuccessfulMatchTime:string|null;historicalPosition:GeoPoint|null;reason:string;observationsUsed:number;
  state:ProgressState|null;
  historicalSpeed?:HistoricalSpeed|null;
  directionId?:string|null;
  routeId?:string|null;passageKey?:string;passages?:PassageEvidence[];
  evidenceDiagnostics?:PassageDiagnostic[];continuityDiagnostic?:DiagnosticReason;
};
export type ProgressHistory={token:string;fixes:GpsFix[];previous?:VehicleProgress};
type Context={key:string;passageKey?:string;historyToken:string;vehicleId:string;tripId:string;routeId?:string|null;shapeId:string|null;serviceDate:string;directionId?:string|null;stops:StopProjection[]};
export function unknownProgress(context:Context,reason:string,now:number,timestamp:number|null=null,previous?:VehicleProgress,stale=false):VehicleProgress {
return {passageKey:context.passageKey??context.key,routeId:context.routeId??null,passages:previous?.key===context.key&&previous.historyToken===context.historyToken?previous.passages:undefined,key:context.key,historyToken:context.historyToken,vehicleId:context.vehicleId,tripId:context.tripId,shapeId:context.shapeId,serviceDate:context.serviceDate,source:stale?"STALE":"PROGRESS_UNKNOWN",confidence:"LOW",status:stale?"STALE":"UNKNOWN",vehicleTimestamp:timestamp===null?null:new Date(timestamp).toISOString(),ageSeconds:timestamp===null?null:Math.round((now-timestamp)/1000),accuracyM:null,distanceM:null,rawDistanceM:null,offsetM:null,position:null,segment:null,previousStopSequence:null,previousPassedStopSequence:null,nextStopSequence:null,stopProjections:context.stops,stopStates:context.stops.map(stop=>({sequence:stop.sequence,state:"SCHEDULED"})),lastSuccessfulMatchTime:previous?.lastSuccessfulMatchTime??null,historicalPosition:previous?.position??previous?.historicalPosition??null,reason,observationsUsed:0,state:null};
}
export function evaluateVehicleProgress(context:Context,shape:ShapeIndex,fix:GpsFix,now:number,history?:ProgressHistory):VehicleProgress {
  const speedScope=busMotionScope(context);
  const previous=history?.previous?.key===context.key&&history.previous.historyToken===context.historyToken?history.previous:undefined;
  if(!Number.isFinite(fix.timestamp))return unknownProgress(context,"Vehicle measurement timestamp unavailable.",now,null,previous);
  if(now-fix.timestamp>L.maxAgeMs||fix.timestamp-now>L.futureToleranceMs)return unknownProgress(context,"GPS measurement is stale or has an unreliable future timestamp. Last known position is historical only.",now,fix.timestamp,previous,true);
  if(previous?.vehicleTimestamp&&fix.timestamp<Date.parse(previous.vehicleTimestamp))return {...previous,ageSeconds:Math.round((now-Date.parse(previous.vehicleTimestamp))/1000),reason:"Older GPS packet ignored; retaining the newer matched observation."};
  let state=previous?.state&&fix.timestamp-previous.state.last.timestamp<=L.maxAgeMs?previous.state:null;
  let lastGood=previous,used=0,failure="GPS could not be associated with one consistent route segment.";
  let passages=previous?.passages??[];
  let evidenceDiagnostics=previous?.evidenceDiagnostics??[],continuityDiagnostic=previous?.continuityDiagnostic;
  const unique=new Map<number,GpsFix>();for(const item of [...(history?.fixes??[]),fix])if(item.timestamp<=fix.timestamp&&fix.timestamp-item.timestamp<=L.maxAgeMs&&!unique.has(item.timestamp))unique.set(item.timestamp,item);
  const ordered=[...unique.values()].sort((a,b)=>a.timestamp-b.timestamp);
  for(const item of ordered){
    if(state&&item.timestamp<=state.last.timestamp)continue;
    if(state&&item.timestamp-state.last.timestamp>L.maxAgeMs)state=null;
    if(item.accuracyM!==null&&(!Number.isFinite(item.accuracyM)||item.accuracyM<0||item.accuracyM>L.maxAccuracyM)){state=null;failure="Reported GPS accuracy is insufficient for route progress.";continue;}
    let candidates=projectCandidates(shape,item.position,L.maxRouteOffsetM);
    if(!candidates.length){state=null;failure="GPS is too far from the matched trip shape.";continue;}
    const movingBearing=item.bearing!==null&&Number.isFinite(item.bearing)&&item.bearing>=0&&item.bearing<=360&&item.speed!==null&&item.speed>=2?item.bearing:null;
    const motionBearing=state&&distanceM(state.last.position,item.position)>L.positionHysteresisM&&item.timestamp-state.last.timestamp>=5000?bearing(state.last.position,item.position):null;
    candidates=candidates.filter(candidate=>(movingBearing===null||angleDifference(candidate.bearing,movingBearing)<=L.headingToleranceDeg)&&(motionBearing===null||angleDifference(candidate.bearing,motionBearing)<=L.headingToleranceDeg));
    if(!candidates.length){state=null;failure="Vehicle movement or heading conflicts with the trip direction.";continue;}
    if(state){const dt=(item.timestamp-state.last.timestamp)/1000;candidates=candidates.filter(candidate=>candidate.distanceM>=state!.last.distanceM-L.positionHysteresisM&&candidate.distanceM<=state!.last.distanceM+L.maximumSpeedMps*dt+L.passedBufferM);}
    if(!candidates.length){state=null;failure="GPS movement conflicts with previous route progress; continuity has been reset.";continuityDiagnostic="GPS_OUTLIER_REJECTED";continue;}
    const distinct=distinctCandidates(candidates);
    if(distinct.length!==1){state=null;failure="GPS matches multiple route branches, parallel segments or loop occurrences.";continue;}
    const candidate=distinct[0],stableDistance=state?Math.max(state.last.distanceM,candidate.distanceM):candidate.distanceM,stable=pointAtDistance(shape,stableDistance);
    const matched:MatchedFix={...item,distanceM:stableDistance,rawDistanceM:candidate.distanceM,offsetM:candidate.offsetM,point:stable.point,segment:stable.segment};
    const quality=candidate.offsetM<=L.highRouteOffsetM&&(item.accuracyM===null||item.accuracyM<=L.highAccuracyM);
    const origin=state&&quality?state.origin:matched;
    const highEvidence=quality&&!!state&&(state.highEvidence||item.timestamp-origin.timestamp>=L.minimumObservationMs&&stableDistance-origin.distanceM>=L.minimumMovementM&&distanceM(origin.position,item.position)>=20);
    if(state&&quality&&highEvidence){
      const observation=(sample:MatchedFix):PassageObservation=>({contextKey:context.passageKey??context.key,vehicleId:context.vehicleId,tripId:context.tripId,routeId:context.routeId??null,shapeId:context.shapeId,serviceDate:context.serviceDate,timestamp:sample.timestamp,distanceM:sample.distanceM,rawDistanceM:sample.rawDistanceM,offsetM:sample.offsetM,accuracyM:sample.accuracyM,confidence:sample.offsetM<=L.highRouteOffsetM&&(sample.accuracyM===null||sample.accuracyM<=L.highAccuracyM)?"HIGH":"LOW"});
      for(const stop of context.stops){const from=observation(state.last),to=observation(matched),evidence=inferStopPassage(stop,from,to,now);if(evidence){passages=retainPassage(passages,evidence);evidenceDiagnostics=evidenceDiagnostics.filter(item=>item.stopId!==stop.id||item.sequence!==stop.sequence);}else if(!passages.some(item=>item.stopId===stop.id&&item.sequence===stop.sequence)){const diagnostic=rejectedPassageDiagnostic(stop,from,to,now);if(diagnostic)evidenceDiagnostics=[...evidenceDiagnostics.filter(item=>item.stopId!==stop.id||item.sequence!==stop.sequence),diagnostic];}}
    }
    const confirmedDistanceM=highEvidence?Math.max(state?.confirmedDistanceM??-1,Math.min(state!.last.distanceM,stableDistance)-L.passedBufferM):-1;
    const speedSamples=quality&&Math.abs(stableDistance-candidate.distanceM)<.05?[...(state?.speedScope===speedScope?state.speedSamples??[]:[]),matched].filter(sample=>item.timestamp-sample.timestamp<=L.maxAgeMs).slice(-8):[];
    state={last:matched,origin,highEvidence,confirmedDistanceM,speedSamples,speedScope};used++;
  }
  if(!state||state.last.timestamp!==fix.timestamp)return unknownProgress(context,failure,now,fix.timestamp,lastGood);
  const current=state.last,high=state.highEvidence;
  const speed=high&&state.speedScope===speedScope?historicalBusSpeed(state.speedSamples??[],now):null;
  const stopStates:VehicleProgress["stopStates"]=context.stops.map(stop=>({sequence:stop.sequence,state:stop.distanceM===null?"SCHEDULED":high&&stop.distanceM<=state!.confirmedDistanceM?"PASSED":stop.distanceM>=current.distanceM-5?"UPCOMING":"SCHEDULED"}));
  passages=passages.map(item=>!item.confirmedAt&&stopStates.some(stop=>stop.sequence===item.sequence&&stop.state==="PASSED")?{...item,confirmedAt:new Date(fix.timestamp).toISOString()}:item);
  const prior=context.stops.map((stop,i)=>stop.distanceM!==null&&stop.distanceM<current.distanceM?i:-1).filter(i=>i>=0).at(-1);
  const nextIndex=context.stops.findIndex(stop=>stop.distanceM!==null&&stop.distanceM>=current.distanceM);
  // A missing intervening stop prevents claiming that the next projected stop
  // is the actual next stop in the authoritative GTFS sequence.
  const bracket=nextIndex===0||nextIndex>0&&prior===nextIndex-1;
  const next=bracket&&nextIndex>=0?context.stops[nextIndex]:null,previousStop=prior!==undefined?context.stops[prior]:null;
  const previousPassed=context.stops.filter(stop=>stopStates.find(state=>state.sequence===stop.sequence)?.state==="PASSED").at(-1);
  const first=context.stops[0],last=context.stops.at(-1),near=next&&Math.abs(next.distanceM!-current.distanceM)<=L.approachingM;
  const status:VehicleProgress["status"]=first?.distanceM!==null&&first?.distanceM!==undefined&&current.distanceM<first.distanceM-L.approachingM?"BEFORE_FIRST":last?.distanceM!==null&&last?.distanceM!==undefined&&current.distanceM>last.distanceM+L.approachingM?"BEYOND_LAST":near?"NEAR_STOP":next&&previousStop?"BETWEEN_STOPS":"ON_ROUTE";
  const reason=status==="BEFORE_FIRST"?`Before ${first.name} — GPS position; departure unconfirmed.`:status==="BEYOND_LAST"?"Beyond the last mapped stop — trip completion is unconfirmed.":near?`Approaching ${next!.name} — arrival is unconfirmed.`:next?`En route to ${next.name}`:"On the matched trip shape; the exact stop bracket is unavailable.";
  return {evidenceDiagnostics,continuityDiagnostic,passageKey:context.passageKey??context.key,routeId:context.routeId??null,passages:passages,key:context.key,historyToken:context.historyToken,vehicleId:context.vehicleId,tripId:context.tripId,shapeId:context.shapeId,serviceDate:context.serviceDate,source:high?"GPS_INFERRED":"APPROXIMATE",confidence:high?"HIGH":"MEDIUM",status,vehicleTimestamp:new Date(fix.timestamp).toISOString(),ageSeconds:Math.round((now-fix.timestamp)/1000),accuracyM:fix.accuracyM,distanceM:current.distanceM,rawDistanceM:current.rawDistanceM,offsetM:current.offsetM,position:current.point,segment:current.segment,previousStopSequence:previousStop?.sequence??null,previousPassedStopSequence:previousPassed?.sequence??null,nextStopSequence:next?.sequence??null,stopProjections:context.stops,stopStates,lastSuccessfulMatchTime:new Date(fix.timestamp).toISOString(),historicalPosition:current.point,reason,observationsUsed:used||previous?.observationsUsed||1,state,directionId:context.directionId??null,historicalSpeed:speed?{...speed,scope:speedScope}:null};
}
