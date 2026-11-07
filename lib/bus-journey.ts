import { gtfsSeconds, malaysiaDate, serviceRuns, type Timetable } from "@/lib/scheduled-departures";
import type { Record as TransitRecord } from "@/lib/transit-data";

type Row = Record<string,string>;
export const BUS_POSITION_MAX_AGE = 120_000;
export type JourneyDeparture = {
  key: string; tripId: string; serviceDate: string; startSeconds: number;
  departure: string; destination: string; direction: string | null;
  classification: "SCHEDULED" | "ESTIMATED"; basis: string;
};
export type JourneyStop = {
  id: string; sequence: number; name: string; arrival: string | null; departure: string | null;
  classification: "SCHEDULED" | "ESTIMATED" | null;
  status: "DEPARTED" | "CURRENT" | "UPCOMING" | "UNKNOWN";
};
export type BusJourney = {
  vehicle: {id:string;name:string;operator:string;reportedAt:string|null;position:[number,number]|null;realtimeAvailable:boolean;positionStatus:"CURRENT"|"STALE"|"UNKNOWN"};
  route: {id:string;code:string;name:string;origin:string|null;destination:string|null;direction:string|null;directions:string[]}|null;
  match: {status:"MATCHED"|"PATTERN_ONLY"|"ROUTE_ONLY"|"UNAVAILABLE";method:"TRIP_ID"|"UNIQUE_DESCRIPTOR"|null;reason:string;routeAlias:boolean};
  vehicleDeparture: JourneyDeparture|null; selectedDeparture: JourneyDeparture|null; departures: JourneyDeparture[];
  frequencies: {start:string;end:string;headwaySeconds:number;destination:string;direction:string|null}[];
  stops: JourneyStop[]; path: [number,number][]|null;
  progress: {status:"UNKNOWN"|"STALE"|"AT_STOP"|"IN_TRANSIT"|"APPROACHING"|"COMPLETED"|"TIMETABLE_PREVIEW";sequence:number|null;message:string};
  delay: {minimumMinutes:number;observedAt:string;sequence:number;basis:string}|null;
  source:string; staticUpdatedAt:string; retrievedAt:string; selectionWarning:string|null;
};
type Pattern = {rows:Row[];origin:number|null;end:number|null;destination:string;originName:string|null};
const patternCache = new WeakMap<Timetable,Map<string,Pattern|null>>();
function pattern(table:Timetable,tripId:string):Pattern|null {
  let cache=patternCache.get(table);if(!cache){cache=new Map();patternCache.set(table,cache);}if(cache.has(tripId))return cache.get(tripId)!;
  const rows:Row[]=[];let previous=-1,lastTime:number|null=null,valid=true;
  for(const row of table.byTrip.get(tripId)??[]) {
    const sequence=Number(row.stop_sequence),prior=rows.at(-1);
    if(!row.stop_sequence||!Number.isInteger(sequence)||sequence<0||!row.stop_id){valid=false;break;}
    if(sequence===previous){if(prior?.stop_id!==row.stop_id||prior.arrival_time!==row.arrival_time||prior.departure_time!==row.departure_time)valid=false;continue;}
    const arrival=gtfsSeconds(row.arrival_time),departure=gtfsSeconds(row.departure_time);
    if(sequence<previous||arrival!==null&&departure!==null&&departure<arrival||lastTime!==null&&(arrival??departure??lastTime)<lastTime){valid=false;break;}
    previous=sequence;lastTime=departure??arrival??lastTime;rows.push(row);
  }
  const last=rows.at(-1),first=rows[0],trip=table.trips.get(tripId);
  const value=valid&&rows.length?{rows,origin:gtfsSeconds(first.departure_time),end:last?gtfsSeconds(last.arrival_time)??gtfsSeconds(last.departure_time):null,destination:trip?.trip_headsign||table.stops.get(last?.stop_id??"")?.stop_name||"Destination unavailable",originName:table.stops.get(first.stop_id)?.stop_name??null}:null;
  cache.set(tripId,value);return value;
}
const midnight = (date:string) => Date.parse(`${date}T00:00:00+08:00`);
const dated = (date:string,seconds:number) => new Date(midnight(date)+seconds*1000).toISOString();
const validDate = (value?:string) => {
  if(!value||!/^\d{8}$/.test(value))return null;
  const date=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}`,epoch=midnight(date);
  return Number.isFinite(epoch)&&malaysiaDate(epoch)===date?date:null;
};
function routeFor(table:Timetable,id?:string|null) {
  if(!id)return null;if(table.routes.has(id))return {id,alias:false};
  const aliases=[...table.routes].filter(([,route])=>route.route_short_name===id||route.route_long_name===id);
  return aliases.length===1?{id:aliases[0][0],alias:true}:null;
}
function windows(table:Timetable,tripId:string) {
  const rows=[...new Map((table.frequencies.get(tripId)??[]).map(row=>[`${row.start_time}|${row.end_time}|${row.headway_secs}|${row.exact_times||"0"}`,row])).values()];
  const values=rows.map(row=>({start:gtfsSeconds(row.start_time),end:gtfsSeconds(row.end_time),headway:Number(row.headway_secs),exact:row.exact_times||"0"}));
  if(values.some(v=>v.start===null||v.end===null||v.end<=v.start||!Number.isInteger(v.headway)||v.headway<=0||!["0","1"].includes(v.exact)))return null;
  values.sort((a,b)=>a.start!-b.start!);if(values.some((v,i)=>i&&v.start!<values[i-1].end!))return null;
  return values;
}
function instance(table:Timetable,tripId:string,date:string,start?:number|null):JourneyDeparture|null {
  const trip=table.trips.get(tripId),p=pattern(table,tripId);if(!trip||!p||p.origin===null||!serviceRuns(table,trip.service_id,date))return null;
  const freq=windows(table,tripId);if(!freq)return null;
  let classification:"SCHEDULED"|"ESTIMATED"=p.rows[0].timepoint==="0"?"ESTIMATED":"SCHEDULED",basis=p.rows[0].timepoint==="0"?"Official interpolated GTFS origin time":"Official GTFS stop times",seconds=p.origin;
  if(freq.length){
    if(start===null||start===undefined)return null;
    const window=freq.find(w=>start>=w.start!&&start<w.end!);if(!window||window.exact==="1"&&(start-window.start!)%window.headway!==0)return null;
    seconds=start;classification=window.exact==="1"?"SCHEDULED":"ESTIMATED";
    basis=window.exact==="1"?"Official exact frequency slot":"Official reported trip start plus GTFS stop-time offsets; not a live arrival prediction";
  }else if(start!==undefined&&start!==null&&start!==p.origin)return null;
  return {key:JSON.stringify([tripId,date,seconds]),tripId,serviceDate:date,startSeconds:seconds,departure:dated(date,seconds),destination:p.destination,direction:trip.direction_id||null,classification,basis};
}
function serviceDates(table:Timetable,now:number,includeTomorrow=true) {
  const day=midnight(malaysiaDate(now)),dates:string[]=[];
  for(let offset=-Math.ceil(table.maxSeconds/86400);offset<=(includeTomorrow?1:0);offset++)dates.push(malaysiaDate(day+offset*86400000));
  return dates;
}
function inferredDate(table:Timetable,tripId:string,observed:number) {
  const trip=table.trips.get(tripId),p=pattern(table,tripId);if(!trip||!p||p.origin===null||p.end===null)return null;
  const possible=serviceDates(table,observed,false).filter(date=>serviceRuns(table,trip.service_id,date)&&observed>=midnight(date)+(p.origin!-7200)*1000&&observed<=midnight(date)+(p.end!+14400)*1000);
  return possible.length===1?possible[0]:null;
}

export function calculateBusJourney(table:Timetable,vehicle:TransitRecord,options:{now?:number;realtimeAvailable?:boolean;departure?:string|null;direction?:string|null;paths?:Map<string,[number,number][]>}={}):BusJourney {
  const now=options.now??Date.now(),realtimeAvailable=options.realtimeAvailable??true,obs=vehicle.observation??{};
  const observed=obs.positionTimestamp?Date.parse(obs.positionTimestamp):NaN;
  const positionStatus=!Number.isFinite(observed)?"UNKNOWN":now-observed>BUS_POSITION_MAX_AGE||observed-now>30000?"STALE":"CURRENT";
  const response:BusJourney={vehicle:{id:vehicle.id,name:vehicle.name,operator:vehicle.operator,reportedAt:obs.positionTimestamp??null,position:vehicle.position,realtimeAvailable,positionStatus},route:null,match:{status:"UNAVAILABLE",method:null,reason:"No reliable GTFS trip match is available.",routeAlias:false},vehicleDeparture:null,selectedDeparture:null,departures:[],frequencies:[],stops:[],path:vehicle.routePath??null,progress:{status:"UNKNOWN",sequence:null,message:"Vehicle progress unavailable — scheduled times do not confirm departure or arrival."},delay:null,source:table.source,staticUpdatedAt:table.updated,retrievedAt:new Date(now).toISOString(),selectionWarning:null};
  let route=routeFor(table,vehicle.routeId),tripId:string|null=null,active:JourneyDeparture|null=null,method:BusJourney["match"]["method"]=null;
  const reportedTrip=vehicle.tripId?table.trips.get(vehicle.tripId):null;
  const relationValid=obs.scheduleRelationship===undefined||[0,2].includes(obs.scheduleRelationship);
  if(reportedTrip&&(!vehicle.routeId||route?.id===reportedTrip.route_id)&&(!obs.directionId||obs.directionId===reportedTrip.direction_id)&&relationValid){
    tripId=reportedTrip.trip_id;route=route??{id:reportedTrip.route_id,alias:false};method="TRIP_ID";
    const date=obs.tripStartDate?validDate(obs.tripStartDate):!table.frequencies.has(tripId)&&Number.isFinite(observed)?inferredDate(table,tripId,observed):null;
    const start=obs.tripStartTime?gtfsSeconds(obs.tripStartTime):undefined;
    if(date&&(!obs.tripStartTime||start!==null))active=instance(table,tripId,date,start);
    response.match.reason=active?"Vehicle trip matched to the official GTFS timetable.":"Trip pattern matched, but its service date or start cannot identify a valid run. Times are withheld.";
    if(!active&&table.frequencies.has(tripId)){
      const published=windows(table,tripId);
      if(!obs.tripStartDate||!obs.tripStartTime)response.match.reason="Trip pattern matched, but the frequency-based vehicle lacks a service date or departure start. Stop times are withheld; published headways remain available.";
      else if(start!==null&&start!==undefined&&published&&!published.some(window=>start>=window.start!&&start<window.end!))response.match.reason="Trip pattern matched, but the reported start is outside its published frequency window. Stop times are withheld; published headways remain available.";
    }
  }else if(!reportedTrip&&route&&obs.directionId!==undefined&&validDate(obs.tripStartDate)&&gtfsSeconds(obs.tripStartTime??"")!==null&&relationValid){
    const matches=(table.routeTrips.get(route.id)??[]).filter(id=>table.trips.get(id)?.direction_id===obs.directionId).map(id=>instance(table,id,validDate(obs.tripStartDate)!,gtfsSeconds(obs.tripStartTime!))).filter((value):value is JourneyDeparture=>!!value);
    if(matches.length===1){active=matches[0];tripId=active.tripId;method="UNIQUE_DESCRIPTOR";response.match.reason="Unique official trip matched by route, direction, service date and start time.";}
    else response.match.reason="The route descriptor does not identify a unique trip; no vehicle journey was assumed.";
  }else if(reportedTrip)response.match.reason="Realtime route, direction or trip relationship conflicts with the static trip. No vehicle journey was assumed.";
  else response.match.reason=vehicle.tripId?"The reported trip ID is absent from the current official timetable. Route information only.":"The feed did not provide a trip ID or a complete unique trip descriptor. Route information only.";
  if(!route)return response;
  const staticRoute=table.routes.get(route.id)!;
  if(staticRoute.mode!=="Bus")return response;
  const trip=tripId?table.trips.get(tripId):null,p=tripId?pattern(table,tripId):null;
  const direction=options.direction??trip?.direction_id??obs.directionId??null;
  const directions=[...new Set((table.routeTrips.get(route.id)??[]).map(id=>table.trips.get(id)?.direction_id).filter((v):v is string=>v!==undefined&&v!==""))].sort();
  const code=staticRoute.route_short_name||(/^[\w-]{1,12}$/.test(staticRoute.route_long_name??"")?staticRoute.route_long_name:vehicle.routeId)||staticRoute.route_id;
  response.route={id:route.id,code,name:staticRoute.route_long_name||staticRoute.route_short_name||route.id,origin:p?.originName??null,destination:p?.destination??null,direction,directions};
  response.match={...response.match,status:active&&realtimeAvailable?"MATCHED":p?"PATTERN_ONLY":"ROUTE_ONLY",method:realtimeAvailable?method:null,routeAlias:route.alias};
  if(!realtimeAvailable)response.match.reason="Realtime vehicle information is unavailable. This is a timetable reference from the last selected trip, not a verified current vehicle journey.";
  response.vehicleDeparture=active;
  // Future options contain only actual exact schedules. Approximate headways
  // are summarized independently, never expanded into a made-up departure grid.
  const upcoming:JourneyDeparture[]=[],frequency=new Map<string,BusJourney["frequencies"][number]>();
  const horizon=midnight(malaysiaDate(now))+2*86400000;
  if(direction!==null)for(const id of table.routeTrips.get(route.id)??[]){
    if(table.trips.get(id)?.direction_id!==direction)continue;
    const patternValue=pattern(table,id),freq=windows(table,id);if(!patternValue||!freq)continue;
    for(const date of serviceDates(table,now)){
      if(!serviceRuns(table,table.trips.get(id)!.service_id,date))continue;
      if(!freq.length){const candidate=instance(table,id,date);if(candidate?.classification==="SCHEDULED"&&Date.parse(candidate.departure)>=now&&Date.parse(candidate.departure)<horizon)upcoming.push(candidate);}
      else for(const window of freq){
        const start=midnight(date)+window.start!*1000,end=midnight(date)+window.end!*1000;if(end<=now||start>=horizon)continue;
        if(window.exact==="0"){
          const value={start:new Date(start).toISOString(),end:new Date(end).toISOString(),headwaySeconds:window.headway,destination:patternValue.destination,direction};frequency.set(JSON.stringify(value),value);
        }else for(let seconds=window.start!+Math.max(0,Math.ceil((now-start)/(window.headway*1000)))*window.headway,count=0;seconds<window.end!&&count<10;seconds+=window.headway,count++){
          const candidate=instance(table,id,date,seconds);if(candidate&&Date.parse(candidate.departure)<horizon)upcoming.push(candidate);
        }
      }
    }
  }
  const unique=new Map<string,JourneyDeparture>();for(const item of upcoming){const key=`${item.departure}|${item.direction}|${item.destination}|${table.trips.get(item.tripId)?.shape_id??""}|${pattern(table,item.tripId)?.rows.map(row=>row.stop_id).join(",")}`;if(!unique.has(key))unique.set(key,item);}
  response.departures=[...unique.values()].sort((a,b)=>Date.parse(a.departure)-Date.parse(b.departure)).slice(0,10);
  response.frequencies=[...frequency.values()].sort((a,b)=>a.start.localeCompare(b.start));
  let retained:JourneyDeparture|null=null;
  if(options.departure){
    try {
      const [requestedTrip,date,start]=JSON.parse(options.departure);
      if(typeof requestedTrip==="string"&&typeof date==="string"&&Number.isInteger(start)&&table.trips.get(requestedTrip)?.route_id===route.id&&table.trips.get(requestedTrip)?.direction_id===direction&&serviceDates(table,now).includes(date)){
        const candidate=instance(table,requestedTrip,date,start);
        if(candidate?.classification==="SCHEDULED"&&candidate.key===options.departure)retained=candidate;
      }
    }catch{/* Only generated, validated timetable keys can retain a selection. */}
  }
  const chosen=options.departure?response.departures.find(item=>item.key===options.departure)??(active?.key===options.departure?active:retained):active;
  if(chosen&&chosen.key!==active?.key&&!response.departures.some(item=>item.key===chosen.key))response.departures.unshift(chosen);
  if(options.departure&&!chosen)response.selectionWarning="That departure is no longer available. The vehicle reference is shown instead.";
  const selected=chosen??active;response.selectedDeparture=selected;
  const selectedTrip=selected?.tripId??(options.direction!==undefined&&options.direction!==null&&options.direction!==trip?.direction_id?null:tripId),selectedPattern=selectedTrip?pattern(table,selectedTrip):null;
  if(!selectedPattern&&options.direction!==undefined&&options.direction!==null){response.route.origin=null;response.route.destination=null;}
  if(!selectedPattern){if(tripId)response.match.reason="The matched trip has missing or inconsistent stop sequence records.";return response;}
  response.route.origin=selectedPattern.originName;response.route.destination=selectedPattern.destination;
  response.route.direction=selected?.direction??direction;
  response.path=selectedTrip?options.paths?.get(selectedTrip)??(selectedTrip===vehicle.tripId?vehicle.routePath??null:null):null;
  const shift=selected&&selectedPattern.origin!==null?selected.startSeconds-selectedPattern.origin:0;
  response.stops=selectedPattern.rows.map(row=>{
    const arrival=gtfsSeconds(row.arrival_time),departure=gtfsSeconds(row.departure_time);
    return {id:row.stop_id,sequence:Number(row.stop_sequence),name:table.stops.get(row.stop_id)?.stop_name||`Stop name unavailable (${row.stop_id})`,arrival:selected&&arrival!==null?dated(selected.serviceDate,arrival+shift):null,departure:selected&&departure!==null?dated(selected.serviceDate,departure+shift):null,classification:selected&&(arrival!==null||departure!==null)?row.timepoint==="0"?"ESTIMATED":selected.classification:null,status:"UNKNOWN"};
  });
  if(selected&&selected.key!==active?.key){response.progress={status:"TIMETABLE_PREVIEW",sequence:null,message:"Timetable preview — vehicle progress belongs to its own matched journey."};return response;}
  if(!realtimeAvailable){response.progress.message="Realtime unavailable — stop progress and delay are not asserted.";return response;}
  if(positionStatus!=="CURRENT"){response.progress={status:positionStatus==="STALE"?"STALE":"UNKNOWN",sequence:null,message:positionStatus==="STALE"?"Vehicle position is stale — stop progress and delay are unavailable.":"Vehicle measurement time unavailable — stop progress cannot be verified."};return response;}
  if(!active)return response;
  const sequence=obs.currentStopSequence;
  let index=sequence!==undefined?response.stops.findIndex(stop=>stop.sequence===sequence):-1;
  // stop_id can repeat on loops: only a unique match may supply a next-stop hint.
  if(sequence===undefined&&obs.stopId){const matches=response.stops.map((stop,i)=>stop.id===obs.stopId?i:-1).filter(i=>i>=0);if(matches.length===1)index=matches[0];}
  if(index<0||obs.stopId&&response.stops[index].id!==obs.stopId)return response;
  const current=response.stops[index],status=sequence===undefined?"IN_TRANSIT_TO":obs.currentStatus;
  if(!status)return response;
  // With only stop_id, report the next-stop hint without fabricating completed
  // stops or arrival. Sequence plus status supports actual progress assertions.
  if(sequence===undefined){response.progress={status:"IN_TRANSIT",sequence:current.sequence,message:`Reported stop: ${current.name}. Arrival/departure status is not provided.`};return response;}
  for(let i=0;i<response.stops.length;i++)response.stops[i].status=i<index?"DEPARTED":i===index?status==="STOPPED_AT"?"CURRENT":"UPCOMING":"UPCOMING";
  const completed=status==="STOPPED_AT"&&index===response.stops.length-1;
  response.progress={status:completed?"COMPLETED":status==="STOPPED_AT"?"AT_STOP":status==="INCOMING_AT"?"APPROACHING":"IN_TRANSIT",sequence:current.sequence,message:completed?"Trip completed — at the final stop.":status==="STOPPED_AT"?`At ${current.name}`:status==="INCOMING_AT"?`Approaching ${current.name}`:`En route to ${current.name}`};
  // A fresh observation still standing at a stop after its exact planned
  // departure proves a minimum departure delay, not an actual arrival time.
  if(!completed&&status==="STOPPED_AT"&&current.classification==="SCHEDULED"&&current.departure&&observed-Date.parse(current.departure)>=60000){response.delay={minimumMinutes:Math.floor((observed-Date.parse(current.departure))/60000),observedAt:new Date(observed).toISOString(),sequence:current.sequence,basis:"Minimum departure delay: the vehicle was observed standing at this stop after its scheduled departure. No downstream ETA is inferred."};}
  return response;
}
