import { buildTimetable } from "@/lib/scheduled-departures";
import { calculateBusJourney } from "@/lib/bus-journey";
import type { Record as TransitRecord } from "@/lib/transit-data";
export const adherenceNow=Date.parse("2026-11-07T06:01:00Z");
export const adherencePoint=(m:number):[number,number]=>[3.14,101.69+m/(111195.08*Math.cos(3.14*Math.PI/180))];
export const adherencePath=[0,600,1200,1800,2400].map(adherencePoint);
export function adherenceFixture(options:{afterMidnight?:boolean;exception?:"1"|"2";missingCoordinates?:boolean;missingDeparture?:boolean;estimated?:boolean;onlyOneFix?:boolean;now?:number}={}){
  const add=options.afterMidnight?12*3600000:0,now=options.now??adherenceNow+add;
  const seconds=options.afterMidnight?12:0,clock=(hour:number,minute:number)=>`${hour+seconds}:${String(minute).padStart(2,"0")}:00`;
  const stopTimes=[{departure:clock(13,40),arrival:clock(13,40)},{departure:clock(13,50),arrival:clock(13,49)},{departure:clock(14,0),arrival:clock(13,58)},{departure:clock(14,3),arrival:clock(14,2)},{departure:clock(14,5),arrival:clock(14,5)}].map((time,i)=>({trip_id:"t",stop_id:`s${i}`,stop_sequence:String((i+1)*10),arrival_time:time.arrival,departure_time:options.missingDeparture&&i===2?"":time.departure,timepoint:options.estimated&&i===2?"0":"1"}));
  const table=buildTimetable({stopTimes,trips:[{trip_id:"t",route_id:"R",service_id:"D",direction_id:"0",shape_id:"shape"}],routes:[{route_id:"R",route_short_name:"T999",route_long_name:"Synthetic adherence fixture"}],stops:[50,100,400,700,1400].map((m,i)=>({stop_id:`s${i}`,stop_name:["Before available history","Delayed fixture stop","On-time fixture stop","Early fixture stop","Upcoming fixture stop"][i],stop_lat:options.missingCoordinates&&i===2?"":String(adherencePoint(m)[0]),stop_lon:options.missingCoordinates&&i===2?"":String(adherencePoint(m)[1])})),calendars:options.exception?[{service_id:"D",start_date:"20261107",end_date:"20261107",saturday:"0"}]:[{service_id:"D",start_date:"20261107",end_date:"20261107",saturday:"1"}],exceptions:options.exception?[{service_id:"D",date:"20261107",exception_type:options.exception}]:[],frequencies:[],source:"Clearly labelled synthetic adherence GTFS fixture",mode:()=>"Bus"});
  const bus:TransitRecord={id:"ADHERENCE-A",name:"Adherence fixture bus",feedId:"rapid-bus-kl",operator:"Synthetic test fixture",mode:"Bus",route:"T999",routeId:"R",tripId:"t",position:adherencePoint(1100),bearing:90,speed:8,observation:{tripStartDate:"20261107",positionTimestamp:new Date(adherenceNow+add).toISOString()},recordKind:"vehicle",reportedAt:new Date(adherenceNow+add).toISOString(),station:null,status:"In service",dataMode:"LIVE",routePath:adherencePath,source:"Synthetic test fixture only"};
  const fixes=(options.onlyOneFix?[]:[[100,120],[200,90],[600,60],[900,30]]).map(([distance,ago])=>({position:adherencePoint(distance),timestamp:adherenceNow+add-ago*1000,bearing:90,speed:8,accuracyM:null}));
  const journey=calculateBusJourney(table,bus,{now,paths:new Map([["t",adherencePath]]),history:{token:"fixture-session",fixes}});
  return {now,bus,table,journey,fixes,path:adherencePath};
}
