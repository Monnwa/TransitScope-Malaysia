import { afterEach, expect, it, vi } from "vitest";
import JSZip from "jszip";
import Bindings from "gtfs-realtime-bindings";
import { getBusStaticFeed, getBusVehicle } from "@/lib/official-transit";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("shares static parsing and inflight realtime fetches across vehicle selections, retaining labelled references on failure",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-07T06:00:00Z"));
  const zip=new JSZip();zip.file("routes.txt","route_id,route_short_name,route_type\nR,T401,3");zip.file("trips.txt","trip_id,route_id,service_id,shape_id\nT,R,D,shape");zip.file("stops.txt","stop_id,stop_name,stop_lat,stop_lon\nA,Fixture origin,3.14,101.69\nB,Fixture terminal,3.15,101.7");zip.file("stop_times.txt","trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT,B,2,15:00:00,15:00:00\nT,A,1,13:00:00,13:00:00");zip.file("calendar.txt","service_id,start_date,end_date,saturday\nD,20260101,20261231,1");zip.file("shapes.txt","shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nshape,3.14,101.69,1\nshape,3.15,101.7,2");const archive=await zip.generateAsync({type:"uint8array"});
  const proto=Bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:"2.0",timestamp:Math.floor(Date.now()/1000)},entity:["A","B"].map(id=>({id,vehicle:{trip:{tripId:"T",routeId:"R"},vehicle:{id},position:{latitude:3.14,longitude:101.69},timestamp:Math.floor(Date.now()/1000)}}))}).finish();
  let staticFetches=0,realtimeFetches=0,outage=false;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
    if(url.includes("gtfs-static")){staticFetches++;return new Response(Uint8Array.from(archive).buffer);}
    realtimeFetches++;if(outage)throw new Error("Controlled realtime outage");return new Response(Uint8Array.from(proto).buffer);
  }));
  const [first,second]=await Promise.all([getBusStaticFeed("rapid-bus-kl"),getBusStaticFeed("rapid-bus-kl")]);
  expect(first).toBe(second);expect(staticFetches).toBe(1);expect(first.timetable.byTrip.get("T")!.map(row=>row.stop_id)).toEqual(["A","B"]);
  expect(await getBusStaticFeed("rapid-bus-kl")).toBe(first);expect(staticFetches).toBe(1);
  const [a,b]=await Promise.all([getBusVehicle("rapid-bus-kl","A"),getBusVehicle("rapid-bus-kl","B")]);expect(realtimeFetches).toBe(1);expect(a.record?.id).toBe("A");expect(b.record?.id).toBe("B");expect(a.record?.observation?.currentStopSequence).toBeUndefined();expect(a.record?.routePath).toHaveLength(2);
  await getBusVehicle("rapid-bus-kl","A");expect(realtimeFetches).toBe(1);
  vi.setSystemTime(new Date("2026-11-07T06:00:31Z"));outage=true;const last=await getBusVehicle("rapid-bus-kl","A");expect(last.available).toBe(false);expect(last.record?.id).toBe("A");expect(last.health.status).toBe("stale");expect(realtimeFetches).toBe(2);expect(staticFetches).toBe(1);
});
