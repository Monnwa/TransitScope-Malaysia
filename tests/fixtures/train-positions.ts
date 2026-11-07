// Deliberately synthetic curved geometry and exact schedules, never used by production.
import { buildTimetable } from "../../lib/scheduled-departures";
import { rapidRailMeta } from "../../lib/rail-model";
import { calculateTrainPositionModels,prepareTrainPositions } from "../../lib/train-positions";
import type { GeoPoint } from "../../lib/route-projection";
type Row=Record<string,string>;
export const trainTime=(clock="14:01:00",date="2026-11-07")=>Date.parse(`${date}T${clock}+08:00`);
export const trainPath:GeoPoint[]=[[3.14,101.69],[3.14,101.692],[3.14,101.694],[3.14,101.696],[3.14,101.698],[3.14,101.7],[3.142,101.7],[3.144,101.7],[3.146,101.7],[3.148,101.7],[3.15,101.7]];
export function trainFixture(options:{route?:string;direction?:"0"|"1";frequencies?:Row[];calendars?:Row[];exceptions?:Row[];clocks?:string[];duplicate?:boolean}={}){
  const route=options.route??"KGL",meta=rapidRailMeta[route],direction=options.direction??"0",path=direction==="0"?[...trainPath]:[...trainPath].reverse();
  const ids=options.duplicate?["T","duplicate"]:["T"],clocks=options.clocks??["14:00:00","14:03:00","14:03:30","14:07:00","14:07:20"];
  const table=buildTimetable({
    routes:[{route_id:route,route_long_name:meta.name}],trips:ids.map(trip_id=>({trip_id,route_id:route,service_id:"D",shape_id:`curve-${direction}`,direction_id:direction,trip_headsign:"From Fixture Origin to Fixture Terminus"})),
    stops:[0,5,10].map((i,j)=>({stop_id:`S${j}`,stop_name:["Fixture Origin","Fixture Bend","Fixture Terminus"][j],stop_lat:String(path[i][0]),stop_lon:String(path[i][1])})),
    stopTimes:ids.flatMap(trip_id=>[
      {trip_id,stop_id:"S0",stop_sequence:"1",arrival_time:clocks[0],departure_time:clocks[0]},
      {trip_id,stop_id:"S1",stop_sequence:"2",arrival_time:clocks[1],departure_time:clocks[2]},
      {trip_id,stop_id:"S2",stop_sequence:"3",arrival_time:clocks[3],departure_time:clocks[4]}]),
    frequencies:options.frequencies??[],calendars:options.calendars??[{service_id:"D",saturday:"1",start_date:"20261107",end_date:"20261107"}],exceptions:options.exceptions??[],source:"Synthetic test fixture only",mode:()=>meta.mode});
  const paths=new Map(ids.map(id=>[id,path]));return {table,paths,path};
}
export function trainPayload(options:Parameters<typeof trainFixture>[0]={},now=trainTime()){
  const f=trainFixture(options);return calculateTrainPositionModels(prepareTrainPositions(f.table,f.paths),now);
}
