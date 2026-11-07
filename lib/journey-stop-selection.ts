import type { JourneyStop,BusJourney } from "@/lib/bus-journey";
import type { Timetable } from "@/lib/scheduled-departures";
import { validPoint,type GeoPoint } from "@/lib/route-projection";
export type SelectedJourneyStop=JourneyStop&{key:string;journeyKey:string;vehicleId:string;routeName:string;confidence:string;position:GeoPoint|null};
export function officialStopPosition(table:Timetable,id:string):GeoPoint|null {
  const stop=table.stops.get(id),lat=stop?.stop_lat?.trim(),lon=stop?.stop_lon?.trim();
  const point:GeoPoint|null=lat&&lon?[Number(lat),Number(lon)]:null;return validPoint(point)?point:null;
}
export const journeySelectionKey=(journey:BusJourney)=>`${journey.source}|${journey.vehicle.id}|${journey.route?.id??""}|${journey.selectedDeparture?.key??"pattern"}`;
export function selectJourneyStop(journey:BusJourney,id:string,sequence:number):SelectedJourneyStop|null {
  const stop=journey.stops.find(item=>item.id===id&&item.sequence===sequence);if(!stop)return null;
  const key=journeySelectionKey(journey);
  return {...stop,key:`${key}|${id}|${sequence}`,journeyKey:key,vehicleId:journey.vehicle.id,routeName:journey.route?.code??journey.route?.name??"Route unavailable",confidence:journey.tracking?.confidence??"UNKNOWN",position:validPoint(stop.position)?stop.position:null};
}
export function retainedStopSelection(selection:{id:string;sequence:number;journeyKey:string}|null,journey:BusJourney|null){return selection&&journey&&selection.journeyKey===journeySelectionKey(journey)?selectJourneyStop(journey,selection.id,selection.sequence):null;}
export type Rect={left:number;top:number;right:number;bottom:number};
export function visibleMapArea(map:Rect,viewport:{width:number;height:number},obstructions:Rect[]){
  let area={left:Math.max(0,map.left),top:Math.max(0,map.top),right:Math.min(viewport.width,map.right),bottom:Math.min(viewport.height,map.bottom)};
  for(const obstruction of obstructions){if(obstruction.left>=area.right||obstruction.right<=area.left||obstruction.top>=area.bottom||obstruction.bottom<=area.top)continue;
    const choices=[{...area,bottom:Math.max(area.top,obstruction.top)},{...area,top:Math.min(area.bottom,obstruction.bottom)},{...area,right:Math.max(area.left,obstruction.left)},{...area,left:Math.min(area.right,obstruction.right)}];
    area=choices.sort((a,b)=>(b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top))[0];
  }
  return area;
}
export function mapStopAnchor(map:Rect,viewport:{width:number;height:number},obstructions:Rect[]){
  const area=visibleMapArea(map,viewport,obstructions),height=area.bottom-area.top;
  return {x:(area.left+area.right)/2-map.left,y:area.top+height*(height<300?.75:.5)-map.top,width:area.right-area.left,height};
}
