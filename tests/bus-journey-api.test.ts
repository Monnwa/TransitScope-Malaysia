import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildTimetable } from "@/lib/scheduled-departures";
vi.mock("@/lib/official-transit",()=>({busSourceIds:["rapid-bus-kl","rapid-bus-mrtfeeder","rapid-bus-penang"],getBusVehicle:vi.fn(),getBusStaticFeed:vi.fn()}));
import { getBusVehicle, getBusStaticFeed } from "@/lib/official-transit";
import { GET } from "@/app/api/bus-journey/route";
import type { Record as TransitRecord } from "@/lib/transit-data";
const stamp="2026-11-07T06:00:00Z";
const vehicle:TransitRecord={id:"BUS",name:"Fixture Bus",feedId:"rapid-bus-kl",mode:"Bus",route:"T401",routeId:"R",tripId:"T",position:[3.142,101.699],operator:"Fixture",station:null,reportedAt:stamp,recordKind:"vehicle",status:"In service",dataMode:"LIVE",source:"Synthetic fixture",observation:{tripStartDate:"20261107",positionTimestamp:stamp,currentStopSequence:1,currentStatus:"STOPPED_AT"}};
function setup(){
  vi.useFakeTimers();vi.setSystemTime(new Date(stamp));
  const table=buildTimetable({stopTimes:[{trip_id:"T",stop_id:"A",stop_sequence:"1",arrival_time:"13:00:00",departure_time:"13:00:00"},{trip_id:"T",stop_id:"B",stop_sequence:"2",arrival_time:"15:00:00",departure_time:"15:00:00"}],trips:[{trip_id:"T",route_id:"R",service_id:"D",direction_id:"0"}],routes:[{route_id:"R",route_short_name:"T401"}],stops:[{stop_id:"A",stop_name:"Fixture origin"},{stop_id:"B",stop_name:"Fixture terminus"}],frequencies:[],calendars:[{service_id:"D",saturday:"1",start_date:"20261107",end_date:"20261107"}],exceptions:[],source:"Synthetic fixture",mode:()=>"Bus"});
  vi.mocked(getBusStaticFeed).mockResolvedValue({timetable:table,tripPaths:new Map([["T",[[3.142,101.699],[3.15,101.7]]]])} as Awaited<ReturnType<typeof getBusStaticFeed>>);
  vi.mocked(getBusVehicle).mockResolvedValue({record:vehicle,available:true,health:{id:"rapid-bus-kl",label:"Fixture",status:"healthy",lastSuccessAt:stamp,sourceTimestamp:stamp,message:null,records:1}});
}
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks();});
describe("official bus journey API",()=>{
  it("validates source, vehicle length and direction without fetching unsupported URLs",async()=>{
    for(const suffix of ["source=attacker&vehicle=BUS","source=rapid-bus-kl","source=rapid-bus-kl&vehicle=BUS&direction=8",`source=rapid-bus-kl&vehicle=${"x".repeat(161)}`])expect((await GET(new NextRequest(`https://example.test/api/bus-journey?${suffix}`))).status).toBe(400);
    expect(getBusStaticFeed).not.toHaveBeenCalled();
  });
  it("uses the verified feed record instead of client-supplied trip data",async()=>{
    setup();const response=await GET(new NextRequest("https://example.test/api/bus-journey?source=rapid-bus-kl&vehicle=BUS&trip=FAKE&route=FAKE"));const result=await response.json();expect(response.headers.get("cache-control")).toBe("no-store");expect(result.match.status).toBe("MATCHED");expect(result.selectedDeparture.tripId).toBe("T");expect(result.stops.map((s:{name:string})=>s.name)).toEqual(["Fixture origin","Fixture terminus"]);expect(result.path).toHaveLength(2);
  });
  it("timetable failure is explicit and never invents timeline times",async()=>{
    setup();vi.mocked(getBusStaticFeed).mockRejectedValue(new Error("Fixture outage"));const response=await GET(new NextRequest("https://example.test/api/bus-journey?source=rapid-bus-kl&vehicle=BUS"));expect(response.status).toBe(503);expect((await response.json()).code).toBe("TIMETABLE_UNAVAILABLE");
  });
  it("retains a labelled scheduled reference when realtime is unavailable, without progress or delay",async()=>{
    setup();vi.mocked(getBusVehicle).mockRejectedValue(new Error("Fixture outage"));const response=await GET(new NextRequest(`https://example.test/api/bus-journey?source=rapid-bus-kl&vehicle=BUS&trip=T&route=R&date=20261107&observed=${encodeURIComponent(stamp)}`));const result=await response.json();expect(result.vehicle.realtimeAvailable).toBe(false);expect(result.match.status).toBe("PATTERN_ONLY");expect(result.stops[0].classification).toBe("SCHEDULED");expect(result.stops.every((s:{status:string})=>s.status==="UNKNOWN")).toBe(true);expect(result.delay).toBeNull();
  });
  it("never promotes an unmatched route to an arbitrary vehicle trip",async()=>{
    setup();vi.mocked(getBusVehicle).mockResolvedValue({record:{...vehicle,tripId:null,observation:{positionTimestamp:stamp}},available:true,health:{id:"rapid-bus-kl",label:"Fixture",status:"healthy",lastSuccessAt:stamp,sourceTimestamp:stamp,message:null,records:1}});const result=await(await GET(new NextRequest("https://example.test/api/bus-journey?source=rapid-bus-kl&vehicle=BUS"))).json();expect(result.match.status).toBe("ROUTE_ONLY");expect(result.vehicleDeparture).toBeNull();expect(result.stops).toEqual([]);expect(result.route.directions).toEqual(["0"]);
  });
});
