import { buildTimetable } from "@/lib/scheduled-departures";
import { calculateBusJourney } from "@/lib/bus-journey";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import type { Record as TransitRecord } from "@/lib/transit-data";
export const reviewNow=Date.parse("2026-11-08T00:00:30+08:00");
export const reviewPoint=(metres:number):[number,number]=>[3.14,101.69+metres/(111195.08*Math.cos(3.14*Math.PI/180))];
export const reviewPath=[0,300,600,900,1200,1500].map(reviewPoint);
export function reviewTable(){
  return buildTimetable({routes:[{route_id:"R",route_short_name:"T700"}],trips:[{trip_id:"T",route_id:"R",service_id:"D",direction_id:"0",shape_id:"out"},{trip_id:"back",route_id:"R",service_id:"D",direction_id:"1",shape_id:"back"}],stopTimes:["T","back"].flatMap(trip_id=>["23:59:00","24:05:00","24:10:00"].map((clock,i)=>({trip_id,stop_id:`${trip_id}-${i}`,stop_sequence:String(i+1),arrival_time:clock,departure_time:clock}))),stops:[...[50,900,1500].map((m,i)=>({stop_id:`T-${i}`,stop_name:["Fixture Origin","Fixture Next","Fixture Terminus"][i],stop_lat:String(reviewPoint(m)[0]),stop_lon:String(reviewPoint(m)[1])})),...[1450,600,0].map((m,i)=>({stop_id:`back-${i}`,stop_name:`Reverse fixture ${i}`,stop_lat:String(reviewPoint(m)[0]),stop_lon:String(reviewPoint(m)[1])}))],calendars:[{service_id:"D",saturday:"1",sunday:"0",start_date:"20261107",end_date:"20261107"}],exceptions:[],frequencies:[],source:"Synthetic final-review fixture only",mode:()=>"Bus"});
}
export function reviewRecord(metres=300,seconds=0,patch:Partial<TransitRecord>={}):TransitRecord{
  return {id:"review-bus",feedId:"rapid-bus-kl",name:"Review fixture",operator:"Synthetic fixture",mode:"Bus",route:"T700",routeId:"R",tripId:"T",position:reviewPoint(metres),bearing:90,speed:5,reportedAt:new Date(reviewNow+seconds*1000).toISOString(),observation:{positionTimestamp:new Date(reviewNow+seconds*1000).toISOString(),tripStartDate:"20261107",directionId:"0"},recordKind:"vehicle",station:null,status:"In service",dataMode:"LIVE",source:"Synthetic final-review fixture only",...patch};
}
export function reviewJourney(){
  const table=reviewTable(),store=new VehicleProgressHistory(),paths=new Map([["T",reviewPath],["back",[...reviewPath].reverse()]]);
  for(const [m,s]of [[0,-60],[150,-30],[300,0]])store.ingest("rapid-bus-kl",[reviewRecord(m,s)],reviewNow+s*1000);
  const journey=calculateBusJourney(table,reviewRecord(),{now:reviewNow,paths,history:store.get("rapid-bus-kl","review-bus")});
  return {table,store,paths,journey};
}
