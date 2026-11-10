import { after, NextRequest, NextResponse } from "next/server";
import { busSourceIds, getBusStaticFeed, getBusVehicle, type BusSourceId } from "@/lib/official-transit";
import { calculateBusJourney } from "@/lib/bus-journey";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { classificationArchive } from "@/lib/classification-evidence-store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:NextRequest) {
  const q=request.nextUrl.searchParams,source=q.get("source"),id=q.get("vehicle");
  if(!source||!busSourceIds.includes(source as BusSourceId)||!id||id.length>160||/[\x00-\x1f]/.test(id)||request.url.length>3000||q.get("direction")&&!/^[01]$/.test(q.get("direction")!))return NextResponse.json({error:"Provide a supported official bus source and vehicle identifier."},{status:400});
  const [realtime,staticFeed]=await Promise.allSettled([getBusVehicle(source as BusSourceId,id,after),getBusStaticFeed(source as BusSourceId)]);
  if (classificationArchive) after(() => classificationArchive?.flush());
  if(staticFeed.status!=="fulfilled")return NextResponse.json({error:"Official GTFS timetable unavailable. The vehicle route path remains available where already retrieved.",code:"TIMETABLE_UNAVAILABLE"},{status:503});
  const current=realtime.status==="fulfilled"?realtime.value:null;
  if(!q.get("departure")&&!q.get("direction")&&current?.available&&current.processed?.journey)return NextResponse.json(current.processed.journey,{headers:{"Cache-Control":"no-store"}});
  // A last-selected reference can retain a static timetable during an outage.
  // It is never treated as a fresh observation or proof of vehicle progress.
  const reference:TransitRecord={id,name:id,mode:"Bus",operator:source==="rapid-bus-penang"?"Rapid Penang":"Prasarana",route:q.get("route"),routeId:q.get("route"),tripId:q.get("trip"),position:null,station:null,reportedAt:null,status:"Unavailable",dataMode:"UNAVAILABLE",source:"Last selected timetable reference",observation:{tripStartDate:q.get("date")??undefined,tripStartTime:q.get("start")??undefined,positionTimestamp:q.get("observed")??undefined}};
  const record=current?.record??reference;
  const journey=calculateBusJourney(staticFeed.value.timetable,record,{realtimeAvailable:!!current?.record&&current.available,departure:q.get("departure"),direction:q.get("direction"),paths:staticFeed.value.tripPaths,gpsPaths:staticFeed.value.progressPaths,shapeDistances:staticFeed.value.tripShapeDistances,history:current?.history});
  return NextResponse.json(journey,{headers:{"Cache-Control":"no-store"}});
}
