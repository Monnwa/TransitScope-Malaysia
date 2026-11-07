import type { BusJourney } from "@/lib/bus-journey";
import type { VehicleProgress } from "@/lib/vehicle-progress";
import type { ValidAdherence } from "@/lib/timetable-adherence";

// Presentation only: internal enum values, calculations and API fields stay intact.
export const sentenceCase=(value:string)=>value?value.charAt(0).toUpperCase()+value.slice(1).toLowerCase().replaceAll("_"," "):"";
export const timingLabel=(result:ValidAdherence)=>result.status==="ON_TIME"?"On time":`${result.differenceMinutes} min ${result.status==="EARLY"?"early":"late"}`;
export const informationLabel=(mode:string)=>({LIVE:"Vehicle location",STATIC:"Timetable",ESTIMATED:"Estimated",SCHEDULED:"Scheduled",SIMULATED:"Demo data",UNAVAILABLE:"Unavailable"})[mode as "LIVE"]??sentenceCase(mode);
export const filterLabel=(mode:string)=>mode==="LIVE"?"Vehicle locations":mode==="STATIC"?"Stops & timetables":mode==="ESTIMATED"?"Estimated trains":informationLabel(mode);
export const locationLabel=(source:VehicleProgress["source"])=>({GPS_INFERRED:"Current bus location",APPROXIMATE:"Approximate bus location",PROGRESS_UNKNOWN:"Location unavailable",LIVE_PROGRESS:"Current bus location",STALE:"Location update delayed"})[source];
export const stopStatusLabel=(status:string)=>({PASSED:"Passed",DEPARTED:"Passed",CURRENT:"Current location",UPCOMING:"Upcoming",UNKNOWN:"Status unavailable"})[status as "PASSED"]??"Status unavailable";
export const publicRouteCode=(value:string|null|undefined)=>value&&/^(?:[A-Za-z]{1,3})?\d{1,4}[A-Za-z]?$/.test(value)?value:null;
export const publicRouteName=(value:string|null|undefined,id?:string|null)=>value&&!/^\d{5,}$/.test(value)&&(value!==id||!!publicRouteCode(value))?value:null;
export const platformLabel=(value:string|undefined)=>value&&/^(?:platform\s+)?[A-Za-z]?\d{1,2}[A-Za-z]?$/i.test(value)?`Platform ${value.replace(/^platform\s+/i,"")}`:"";
export const alertLabel=(value:string)=>value==="UNKNOWN"?"Status unavailable":value==="ACTIVE"?"Current":sentenceCase(value);
export const passengerName=(value:string)=>/^(?:Stop name|Vehicle identifier) unavailable/i.test(value)?"Name unavailable":value;
export const resultCountLabel=(count:number)=>`${count} ${count===1?"result":"results"}`;
export function journeyLocationText(data:BusJourney|null,tracking:VehicleProgress|undefined,stale:boolean,preview:boolean){
  if(!data)return "";
  if(preview)return "Scheduled journey";
  if(!data.vehicle.realtimeAvailable)return "Location unavailable · Showing the timetable";
  if(stale||tracking?.source==="STALE")return "Location update delayed";
  const next=data.stops.find(stop=>stop.sequence===(tracking?.nextStopSequence??data.progress.sequence));
  if(tracking?.source==="PROGRESS_UNKNOWN")return "Location unavailable";
  if(tracking?.source==="APPROXIMATE")return next?`Approximate bus location · On the way to ${passengerName(next.name)}`:"Approximate bus location";
  if(data.progress.status==="AT_STOP"||data.progress.status==="COMPLETED")return next?`At ${passengerName(next.name)}`:"Current bus location";
  if(tracking?.status==="BEYOND_LAST")return "Beyond the last stop";
  if(next)return `On the way to ${passengerName(next.name)}`;
  return tracking?.source==="GPS_INFERRED"?"Current bus location":"Location unavailable";
}
