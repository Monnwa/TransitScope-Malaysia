import { gtfsSeconds,malaysiaDate,serviceRuns,type Timetable } from "@/lib/scheduled-departures";
import { rapidRailMeta } from "@/lib/rail-model";
import { bearing,indexShape,pointAtDistance,projectStops,validPoint,type GeoPoint } from "@/lib/route-projection";

export const TRAIN_POSITION_LIMITS={refreshMs:15000,pollMs:60000,payloadLifetimeMs:90000,lookAheadSeconds:120,maxDurationSeconds:21600,maxRuns:400} as const;
export const TRAIN_POSITION_EXPLANATION="Train positions are estimated using published service information and railway routes. Actual train locations and arrival times may differ.";
export type TrainStop={id:string;sequence:number;name:string;distanceM:number;arrivalOffset:number;departureOffset:number;estimatedTime:boolean};
export type TrainGeometry={id:string;path:GeoPoint[];source:string};
export type TrainRun={
  id:string;tripId:string;routeId:string;lineId:string;lineName:string;colour:string;mode:"MRT"|"LRT"|"Monorail";
  direction:"0"|"1";destination:string;serviceDate:string;startTime:number;validFrom:number;validUntil:number;
  geometryId:string;stops:TrainStop[];dataMode:"ESTIMATED";basis:"SCHEDULED_TRIP"|"EXACT_FREQUENCY";source:string;
};
export type EstimatedTrainPosition=TrainRun&{position:GeoPoint;bearing:number;distanceM:number;previousStation:TrainStop|null;nextStation:TrainStop|null;nearStation:TrainStop|null;progress:number|null;nextArrival:number|null;updatedAt:string};
export type TrainLineAvailability={
  routeId:string;lineId:string;name:string;colour:string;mode:string;directions:string[];scheduledTrips:number;exactFrequencyTrips:number;approximateFrequencyTrips:number;geometryMatchedTrips:number;eligibleTrips:number;activeTrains:number;
  status:"READY"|"FREQUENCY_ONLY"|"INVALID_DATA"|"NO_DATA";message:string;
  diagnostics:{tripId:string;direction:string;timing:string;geometryMatched:boolean;reason:string|null}[];
};
export type TrainPositionPayload={status:"AVAILABLE"|"UNAVAILABLE";dataMode:"ESTIMATED";asOf:string;validUntil:string;staticUpdatedAt:string;source:string;lines:TrainLineAvailability[];runs:TrainRun[];geometries:TrainGeometry[];message:string};
type Window={start:number;end:number;headway:number;exact:"0"|"1"};
type Pattern={tripId:string;routeId:string;serviceId:string;direction:"0"|"1";destination:string;origin:number;stops:TrainStop[];geometry:TrainGeometry;signature:string;windows:Window[]};
export type TrainPositionIndex={table:Timetable;patterns:Pattern[];lines:TrainLineAvailability[]};
const cache=new WeakMap<Timetable,{paths:Map<string,GeoPoint[]>;references:Map<string,number[]>|undefined;index:TrainPositionIndex}>();
const midnight=(date:string)=>Date.parse(`${date}T00:00:00+08:00`);
const signature=(text:string)=>{let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return `${text.length}:${hash>>>0}`;};
function frequencyWindows(rows:Record<string,string>[]){
  const windows:Window[]=[];
  for(const row of [...new Map(rows.map(row=>[JSON.stringify([row.start_time,row.end_time,row.headway_secs,row.exact_times||"0"]),row])).values()]){
    const start=gtfsSeconds(row.start_time),end=gtfsSeconds(row.end_time),headway=Number(row.headway_secs),exact=row.exact_times||"0";
    if(start===null||end===null||end<=start||!Number.isInteger(headway)||headway<=0||!["0","1"].includes(exact))return null;
    windows.push({start,end,headway,exact:exact as "0"|"1"});
  }
  windows.sort((a,b)=>a.start-b.start);return windows.some((window,i)=>i>0&&window.start<windows[i-1].end)?null:windows;
}
/** Prepared once per parsed static feed, not once per browser tick. */
export function prepareTrainPositions(table:Timetable,paths:Map<string,GeoPoint[]>,references?:Map<string,number[]>):TrainPositionIndex {
  const saved=cache.get(table);if(saved?.paths===paths&&saved.references===references)return saved.index;
  const patterns:Pattern[]=[],lines:TrainLineAvailability[]=[];
  for(const [routeId,meta]of Object.entries(rapidRailMeta)){
    const line:TrainLineAvailability={routeId,lineId:meta.id,name:meta.name,colour:meta.colour,mode:meta.mode,directions:[],scheduledTrips:0,exactFrequencyTrips:0,approximateFrequencyTrips:0,geometryMatchedTrips:0,eligibleTrips:0,activeTrains:0,status:"NO_DATA",message:"Service information unavailable for train position estimates.",diagnostics:[]};
    const route=table.routes.get(routeId),directions=new Set<string>();
    if(route&&route.category?.toUpperCase()!=="BRT"&&["MRT","LRT","Monorail"].includes(route.mode))for(const tripId of [...new Set(table.routeTrips.get(routeId)??[])]){
      const trip=table.trips.get(tripId);if(!trip)continue;
      const direction=trip.direction_id??"",frequencyRows=table.frequencies.get(tripId)??[],windows=frequencyWindows(frequencyRows);
      directions.add(direction);
      if(!frequencyRows.length)line.scheduledTrips++;else{if(windows?.some(window=>window.exact==="1"))line.exactFrequencyTrips++;if(windows?.some(window=>window.exact==="0"))line.approximateFrequencyTrips++;}
      let reason:string|null=null;
      if(!trip.service_id)reason="A valid service identifier is required.";
      const raw=table.byTrip.get(tripId)??[],rows:typeof raw=[];let previousSequence=-1;
      for(const row of raw){const sequence=Number(row.stop_sequence),previous=rows.at(-1);if(!row.stop_id||!row.stop_sequence||!Number.isInteger(sequence)||sequence<0||sequence<previousSequence){reason="Invalid stop order.";break;}if(sequence===previousSequence){if(previous?.stop_id!==row.stop_id||previous.arrival_time!==row.arrival_time||previous.departure_time!==row.departure_time)reason="Conflicting duplicate stop sequence.";continue;}rows.push(row);previousSequence=sequence;}
      const times=rows.map(row=>({arrival:gtfsSeconds(row.arrival_time),departure:gtfsSeconds(row.departure_time)}));
      if(rows.some(row=>row.timepoint!==undefined&&row.timepoint!==""&&!["0","1"].includes(row.timepoint)))reason??="Invalid stop-time precision flag.";
      if(rows.length<2||times.some((time,i)=>time.arrival===null||time.departure===null||time.departure<time.arrival||i>0&&time.arrival<times[i-1].departure!))reason??="Missing or inconsistent arrival/departure times.";
      const origin=times[0]?.departure??null;
      if(origin===null||rows[0]?.timepoint==="0"||table.originConflicts.has(tripId))reason??="The first departure does not establish an exact phase.";
      if(!["0","1"].includes(direction))reason??="Direction is missing or invalid.";
      if(!windows)reason??="Invalid or overlapping frequency windows.";
      const path=paths.get(tripId),shape=path?indexShape(path):null;
      if(!trip.shape_id||!shape)reason??="A validated shape for this trip is unavailable.";
      const projections=shape?projectStops(shape,rows.map(row=>{const stop=table.stops.get(row.stop_id),lat=stop?.stop_lat?.trim(),lon=stop?.stop_lon?.trim(),point:GeoPoint|null=lat&&lon?[Number(lat),Number(lon)]:null,rawDistance=row.shape_dist_traveled?.trim(),shapeDistance=rawDistance?Number(rawDistance):null;return {id:row.stop_id,sequence:Number(row.stop_sequence),name:stop?.stop_name||"Station name unavailable",position:validPoint(point)?point:null,shapeDistance:shapeDistance!==null&&Number.isFinite(shapeDistance)?shapeDistance:null};}),references?.get(tripId)):[];
      const geometryMatched=!!shape&&projections.length===rows.length&&projections.length>=2&&projections.every((stop,i)=>stop.confidence==="HIGH"&&stop.distanceM!==null&&(i===0||stop.distanceM>projections[i-1].distanceM!+.1));
      if(geometryMatched)line.geometryMatchedTrips++;else reason??="Stops cannot be matched unambiguously in order to the trip shape.";
      if(times.length&&times.at(-1)!.departure!==null&&times[0].arrival!==null&&times.at(-1)!.departure!-times[0].arrival!>TRAIN_POSITION_LIMITS.maxDurationSeconds)reason??="The trip duration exceeds the supported estimation range.";
      const eligibleTiming=!frequencyRows.length||!!windows?.some(window=>window.exact==="1");
      line.diagnostics.push({tripId,direction,timing:!frequencyRows.length?"SCHEDULED_TRIP":windows?.some(window=>window.exact==="1")?"EXACT_FREQUENCY":"APPROXIMATE_FREQUENCY",geometryMatched,reason:reason??(!eligibleTiming?"Approximate headways do not establish an individual train departure or bounded position interval.":null)});
      if(reason||!eligibleTiming||origin===null||!shape||!path||!windows)continue;
      const stops=rows.map((row,i)=>({id:row.stop_id,sequence:Number(row.stop_sequence),name:table.stops.get(row.stop_id)?.stop_name||"Station name unavailable",distanceM:projections[i].distanceM!,arrivalOffset:times[i].arrival!-origin,departureOffset:times[i].departure!-origin,estimatedTime:row.timepoint==="0"}));
      if(stops.some((stop,i)=>i>0&&stop.arrivalOffset<=stops[i-1].departureOffset)){line.diagnostics.at(-1)!.reason="Travel time between distinct stations must be positive.";continue;}
      line.eligibleTrips++;patterns.push({tripId,routeId,serviceId:trip.service_id,direction:direction as "0"|"1",destination:/^from\s+.+?\s+to\s+(.+)$/i.exec(trip.trip_headsign??"")?.[1]||trip.trip_headsign||stops.at(-1)!.name,origin,stops,geometry:{id:`${trip.shape_id}:${shape.fingerprint}`,path,source:table.source},signature:signature(JSON.stringify([meta.id,direction,shape.fingerprint,stops.map(s=>[s.id,s.sequence,s.arrivalOffset,s.departureOffset,s.distanceM])])),windows});
    }
    line.directions=[...directions].sort();
    if(line.eligibleTrips){line.status="READY";line.message="Train estimates use published schedules and railway routes.";}
    else if(line.approximateFrequencyTrips&&!line.scheduledTrips&&!line.exactFrequencyTrips){line.status="FREQUENCY_ONLY";line.message="Only service intervals are published; individual train positions are unavailable.";}
    else if(line.diagnostics.length){line.status="INVALID_DATA";line.message="Available service information cannot support a train position estimate.";}
    lines.push(line);
  }
  const index={table,patterns,lines};cache.set(table,{paths,references,index});return index;
}
/** Generate only current/soon-active runs. Approximate frequencies never create a phase grid. */
export function calculateTrainPositionModels(index:TrainPositionIndex,now=Date.now()):TrainPositionPayload {
  const {table}=index,runs=new Map<string,TrainRun>(),geometries=new Map<string,TrainGeometry>();let overflow=false;
  const today=midnight(malaysiaDate(now)),lookAhead=TRAIN_POSITION_LIMITS.lookAheadSeconds;
  for(const pattern of index.patterns){const meta=rapidRailMeta[pattern.routeId];for(let day=-Math.ceil((table.maxSeconds+TRAIN_POSITION_LIMITS.maxDurationSeconds)/86400);day<=1;day++){
    const base=today+day*86400000,date=malaysiaDate(base);if(!serviceRuns(table,pattern.serviceId,date))continue;
    const secondsNow=(now-base)/1000,firstOffset=pattern.stops[0].arrivalOffset,lastOffset=pattern.stops.at(-1)!.departureOffset;
    const push=(start:number,basis:TrainRun["basis"])=>{const startTime=base+start*1000,validFrom=startTime+firstOffset*1000,validUntil=startTime+lastOffset*1000;if(validUntil<=now||validFrom>now+lookAhead*1000)return;
      const id=JSON.stringify(["estimated-train",meta.id,pattern.direction,date,pattern.signature,start]);if(runs.has(id))return;
      if(runs.size>=TRAIN_POSITION_LIMITS.maxRuns){overflow=true;return;}
      geometries.set(pattern.geometry.id,pattern.geometry);runs.set(id,{id,tripId:pattern.tripId,routeId:pattern.routeId,lineId:meta.id,lineName:meta.name,colour:meta.colour,mode:meta.mode as TrainRun["mode"],direction:pattern.direction,destination:pattern.destination,serviceDate:date,startTime,validFrom,validUntil,geometryId:pattern.geometry.id,stops:pattern.stops,dataMode:"ESTIMATED",basis,source:table.source});};
    if(!pattern.windows.length)push(pattern.origin,"SCHEDULED_TRIP");
    else for(const window of pattern.windows){if(window.exact!=="1")continue;const first=Math.max(0,Math.floor((secondsNow-window.start-lastOffset)/window.headway)+1),last=Math.min(Math.ceil((window.end-window.start)/window.headway)-1,Math.floor((secondsNow+lookAhead-window.start-firstOffset)/window.headway));if(last-first+1>TRAIN_POSITION_LIMITS.maxRuns){overflow=true;continue;}for(let slot=first;slot<=last;slot++)push(window.start+slot*window.headway,"EXACT_FREQUENCY");}
  }}
  const result=overflow?[]:[...runs.values()],current=result.map(run=>locateEstimatedTrain(run,geometries.get(run.geometryId),now)).filter((run):run is EstimatedTrainPosition=>!!run);
  const lines=index.lines.map(line=>({...line,activeTrains:current.filter(run=>run.lineId===line.lineId).length}));
  return {status:result.length?"AVAILABLE":"UNAVAILABLE",dataMode:"ESTIMATED",asOf:new Date(now).toISOString(),validUntil:new Date(now+TRAIN_POSITION_LIMITS.payloadLifetimeMs).toISOString(),staticUpdatedAt:table.updated,source:table.source,lines,runs:result,geometries:overflow?[]:[...geometries.values()],message:overflow?"Train position estimates are temporarily unavailable.":current.length?"Estimated train positions are available.":index.patterns.length?"No estimated trains are in service at this time.":"Individual train positions are unavailable from the current service information. Choose a station for departure times."};
}
/** Time of day and the timetable are authoritative; no animation clock or GPS is used. */
export function locateEstimatedTrain(run:TrainRun,geometry:TrainGeometry|undefined,now:number):EstimatedTrainPosition|null {
  if(run.dataMode!=="ESTIMATED"||![now,run.startTime,run.validFrom,run.validUntil].every(Number.isFinite)||run.validUntil<=run.validFrom||now<run.validFrom||now>=run.validUntil||!geometry||geometry.id!==run.geometryId||!["0","1"].includes(run.direction))return null;
  const shape=indexShape(geometry.path);if(!shape||run.stops.length<2||run.stops.some((stop,i)=>![stop.distanceM,stop.arrivalOffset,stop.departureOffset].every(Number.isFinite)||stop.departureOffset<stop.arrivalOffset||i>0&&(stop.distanceM<=run.stops[i-1].distanceM||stop.arrivalOffset<=run.stops[i-1].departureOffset)))return null;
  const elapsed=(now-run.startTime)/1000;let previous:TrainStop|null=null,next:TrainStop|null=null,near:TrainStop|null=null,progress:number|null=null,distance:number|null=null;
  for(let i=0;i<run.stops.length;i++){const stop=run.stops[i],following=run.stops[i+1];if(elapsed>=stop.arrivalOffset&&elapsed<stop.departureOffset){near=stop;previous=run.stops[i-1]??null;next=following??null;distance=stop.distanceM;break;}
    if(following&&elapsed>=stop.departureOffset&&elapsed<following.arrivalOffset){const duration=following.arrivalOffset-stop.departureOffset;if(duration<=0)return null;progress=(elapsed-stop.departureOffset)/duration;distance=stop.distanceM+(following.distanceM-stop.distanceM)*progress;previous=stop;next=following;break;}}
  if(distance===null||!Number.isFinite(distance)||distance<0||distance>shape.lengthM+.1)return null;
  const location=pointAtDistance(shape,distance),segment=Math.min(location.segment,shape.path.length-2);
  return {...run,position:location.point,bearing:bearing(shape.path[segment],shape.path[segment+1]),distanceM:distance,previousStation:previous,nextStation:next,nearStation:near,progress,nextArrival:next?run.startTime+next.arrivalOffset*1000:null,updatedAt:new Date(now).toISOString()};
}
export function positionsFromPayload(payload:TrainPositionPayload|null,now:number){
  if(!payload||!Number.isFinite(Date.parse(payload.validUntil))||!Number.isFinite(Date.parse(payload.asOf))||now>=Date.parse(payload.validUntil)||now<Date.parse(payload.asOf)-30000)return [];
  const geometries=new Map(payload.geometries.map(item=>[item.id,item]));return payload.runs.map(run=>locateEstimatedTrain(run,geometries.get(run.geometryId),now)).filter((run):run is EstimatedTrainPosition=>!!run);
}
