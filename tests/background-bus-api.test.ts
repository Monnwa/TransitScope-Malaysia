import { afterEach, expect, it, vi } from "vitest";
import JSZip from "jszip";
import Bindings from "gtfs-realtime-bindings";
import { NextRequest } from "next/server";
import { adherenceFixture, adherenceNow, adherencePoint } from "@/tests/fixtures/adherence";
import type { TransitApiResponse } from "@/lib/transit-data";

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();});
it("the dashboard feed computes six buses before any detail request, coalesces refreshes and retains outage results",async()=>{
  vi.resetModules();vi.useFakeTimers({toFake:["Date"]});
  const f=adherenceFixture(),zip=new JSZip();
  const csv=(rows:globalThis.Record<string,string>[])=>{const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];return [headers.join(","),...rows.map(row=>headers.map(key=>row[key]??"").join(","))].join("\n");};
  zip.file("routes.txt",csv([...f.table.routes.values()].map(row=>({...row,route_type:"3"}))));zip.file("trips.txt",csv([...f.table.trips.values()]));zip.file("stops.txt",csv([...f.table.stops.values()]));zip.file("stop_times.txt",csv([...f.table.byTrip.values()].flat()));zip.file("calendar.txt",csv(f.table.calendars));zip.file("shapes.txt",csv(f.path.map(([lat,lon],index)=>({shape_id:"shape",shape_pt_lat:String(lat),shape_pt_lon:String(lon),shape_pt_sequence:String(index)}))));
  const archive=await zip.generateAsync({type:"uint8array"});let distance=100,time=adherenceNow-120000,outage=false,fetches=0;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
    fetches++;if(url.includes("gtfs-static"))return new Response(Uint8Array.from(archive).buffer);
    if(outage)throw new Error("Controlled upstream outage");
    const point=adherencePoint(distance),bytes=Bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:"2.0",timestamp:time/1000},entity:["A","B"].map(id=>({id,vehicle:{vehicle:{id},trip:{tripId:"t",routeId:"R",startDate:"20261107",directionId:0},position:{latitude:point[0],longitude:point[1],bearing:90,speed:8},timestamp:time/1000}}))}).finish();
    return new Response(Uint8Array.from(bytes).buffer);
  }));
  const {GET}=await import("@/app/api/transit/route");
  const load=async()=>{const response=await GET(new NextRequest("https://fixture.test/api/transit?mode=live"));expect(response.headers.get("cache-control")).toBe("no-store");return response.json() as Promise<TransitApiResponse>;};
  let result:TransitApiResponse;
  // No detail API call during any of these observation cycles.
  // Start before the stop, rather than exactly on it: protobuf stores float32 coordinates.
  for(const [m,ago]of [[90,120],[200,90],[600,60],[900,30],[1100,0]]){distance=m;time=adherenceNow-ago*1000;vi.setSystemTime(time);result=await load();}
  expect(result!.busJourneys).toHaveLength(6);
  const journeys=result!.busJourneys!;
  for(const entry of journeys)expect(entry.journey!.stops.map(stop=>stop.adherence?.status)).toEqual(["STATUS_UNKNOWN","DELAYED","ON_TIME","EARLY","STATUS_UNKNOWN"]);
  expect(journeys.flatMap(entry=>entry.journey!.stops).filter(stop=>stop.adherence?.result)).toHaveLength(18);
  const count=fetches;
  const [duplicate,parallel]=await Promise.all([load(),load()]);expect(fetches).toBe(count);expect(duplicate.busJourneys).toEqual(parallel.busJourneys);
  const {GET:detail}=await import("@/app/api/bus-journey/route");
  const selected=await(await detail(new NextRequest("https://fixture.test/api/bus-journey?source=rapid-bus-kl&vehicle=A"))).json();
  expect(selected).toEqual(journeys.find(entry=>entry.source==="rapid-bus-kl"&&entry.vehicleId==="A")!.journey);expect(fetches).toBe(count);
  outage=true;vi.setSystemTime(adherenceNow+31000);const failed=await load();
  expect(failed.busJourneys!.every(entry=>entry.state==="DATA_UNAVAILABLE")).toBe(true);
  expect(failed.busJourneys!.map(entry=>entry.journey)).toEqual(journeys.map(entry=>entry.journey));
});
