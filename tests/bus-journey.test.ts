import { describe, expect, it } from "vitest";
import Bindings from "gtfs-realtime-bindings";
import { buildTimetable } from "@/lib/scheduled-departures";
import { calculateBusJourney } from "@/lib/bus-journey";
import { vehicleObservation } from "@/lib/vehicle-observation";
import type { Record as TransitRecord } from "@/lib/transit-data";
type Row=Record<string,string>;
const now=Date.parse("2026-11-07T14:00:00+08:00");
const iso=(time:string,date="2026-11-07")=>new Date(`${date}T${time}+08:00`).toISOString();
const calendar={service_id:"daily",start_date:"20260101",end_date:"20261231",monday:"1",tuesday:"1",wednesday:"1",thursday:"1",friday:"1",saturday:"1",sunday:"1"};
const times=(trip_id="t",start="13:30:00")=>[
  {trip_id,stop_id:"a",stop_sequence:"10",arrival_time:start,departure_time:start},
  {trip_id,stop_id:"b",stop_sequence:"20",arrival_time:"13:55:00",departure_time:"13:56:00"},
  {trip_id,stop_id:"c",stop_sequence:"30",arrival_time:"14:10:00",departure_time:"14:11:00"},
  {trip_id,stop_id:"d",stop_sequence:"40",arrival_time:"14:30:00",departure_time:"14:30:00"}];
function table(options:{stopTimes?:Row[];trips?:Row[];frequencies?:Row[];exceptions?:Row[];calendars?:Row[];routes?:Row[]}={}){
  return buildTimetable({stopTimes:options.stopTimes??times().reverse(),trips:options.trips??[{trip_id:"t",route_id:"R",service_id:"daily",trip_headsign:"Fixture terminal",direction_id:"0",shape_id:"shape"}],routes:options.routes??[{route_id:"R",route_short_name:"T401",route_long_name:"Fixture route"}],stops:[{stop_id:"a",stop_name:"Fixture origin"},{stop_id:"b",stop_name:"Fixture second stop"},{stop_id:"c",stop_name:"Fixture third stop"},{stop_id:"d",stop_name:"Fixture terminal"}],calendars:options.calendars??[calendar],exceptions:options.exceptions??[],frequencies:options.frequencies??[],mode:()=>"Bus",source:"https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl"});
}
const bus=(patch:Partial<TransitRecord>={}):TransitRecord=>({id:"fixture-bus",name:"Fixture bus",feedId:"rapid-bus-kl",operator:"Fixture operator",mode:"Bus",route:"T401",routeId:"R",tripId:"t",recordKind:"vehicle",position:[3.142,101.699],station:null,reportedAt:iso("14:00:00"),status:"In service",dataMode:"LIVE",source:"Synthetic test fixture only",observation:{tripStartDate:"20261107",positionTimestamp:iso("14:00:00")},...patch});
describe("bus journey matching and timetable",()=>{
  it("joins exact trip, true sequence ordering, stop names, directions and actual arrival/departure times",()=>{
    const result=calculateBusJourney(table(),bus(),{now});expect(result.match).toMatchObject({status:"MATCHED",method:"TRIP_ID"});expect(result.route).toMatchObject({code:"T401",origin:"Fixture origin",destination:"Fixture terminal",direction:"0"});
    expect(result.stops.map(s=>s.sequence)).toEqual([10,20,30,40]);expect(result.stops[1]).toMatchObject({name:"Fixture second stop",arrival:iso("13:55:00"),departure:iso("13:56:00"),classification:"SCHEDULED",status:"UNKNOWN"});expect(result.delay).toBeNull();
  });
  it("does not infer departed/current stops from clocks or geographic proximity",()=>{
    const result=calculateBusJourney(table(),bus(),{now});expect(result.progress.status).toBe("UNKNOWN");expect(result.stops.every(s=>s.status==="UNKNOWN")).toBe(true);
  });
  it("validates unique route-code aliases used by feeder and Penang feeds",()=>{
    const result=calculateBusJourney(table(),bus({routeId:"T401"}),{now});expect(result.match.status).toBe("MATCHED");expect(result.match.routeAlias).toBe(true);expect(result.route?.id).toBe("R");
    expect(calculateBusJourney(table(),bus({routeId:"different-route"}),{now}).stops).toEqual([]);
  });
  it("rejects ambiguous aliases and route/direction conflicts",()=>{
    const t=table({routes:[{route_id:"R",route_short_name:"T401"},{route_id:"R2",route_short_name:"T401"}]});expect(calculateBusJourney(t,bus({routeId:"T401"}),{now}).stops).toEqual([]);
    expect(calculateBusJourney(table(),bus({observation:{tripStartDate:"20261107",directionId:"1"}}),{now}).match.status).not.toBe("MATCHED");
  });
  it("matches missing trip ID only when all descriptor fields identify a single trip",()=>{
    const descriptor={tripStartDate:"20261107",tripStartTime:"13:30:00",directionId:"0",positionTimestamp:iso("14:00:00")};
    expect(calculateBusJourney(table(),bus({tripId:null,observation:descriptor}),{now}).match).toMatchObject({status:"MATCHED",method:"UNIQUE_DESCRIPTOR"});
    expect(calculateBusJourney(table(),bus({tripId:null}),{now}).stops).toEqual([]);
    const t=table();t.trips.set("duplicate",{...t.trips.get("t")!,trip_id:"duplicate"});t.byTrip.set("duplicate",times("duplicate"));t.routeTrips.get("R")!.push("duplicate");
    expect(calculateBusJourney(t,bus({tripId:null,observation:descriptor}),{now}).stops).toEqual([]);
  });
  it("rejects non-static modified/cancelled trip relationships",()=>{
    for(const scheduleRelationship of [1,3,4,5,6,7])expect(calculateBusJourney(table(),bus({observation:{scheduleRelationship,tripStartDate:"20261107"}}),{now}).match.status).not.toBe("MATCHED");
  });
  it("infers a unique scheduled service date around the observation, including previous >24h service",()=>{
    expect(calculateBusJourney(table(),bus({observation:{positionTimestamp:iso("14:00:00")}}),{now}).vehicleDeparture?.serviceDate).toBe("2026-11-07");
    const t=table({stopTimes:[{trip_id:"t",stop_id:"a",stop_sequence:"1",arrival_time:"24:05:00",departure_time:"24:05:00"},{trip_id:"t",stop_id:"b",stop_sequence:"2",arrival_time:"25:10:00",departure_time:"25:10:00"}]});
    const result=calculateBusJourney(t,bus({observation:{positionTimestamp:iso("00:30:00","2026-11-08")}}),{now:Date.parse(iso("00:30:00","2026-11-08"))});expect(result.vehicleDeparture?.serviceDate).toBe("2026-11-07");expect(result.stops[0].departure).toBe(iso("00:05:00","2026-11-08"));
  });
  it("honours calendar exceptions and withholds invalid service dates",()=>{
    for(const t of [table({exceptions:[{service_id:"daily",date:"20261107",exception_type:"2"}]}),table({calendars:[]})]){const result=calculateBusJourney(t,bus(),{now});expect(result.match.status).toBe("PATTERN_ONLY");expect(result.stops.every(s=>s.arrival===null)).toBe(true);}
    expect(calculateBusJourney(table(),bus({observation:{tripStartDate:"20260230"}}),{now}).vehicleDeparture).toBeNull();
  });
  it("expands only official exact future departures, preserving branch patterns and directions",()=>{
    const trips:Row[]=[{trip_id:"t",route_id:"R",service_id:"daily",direction_id:"0"},{trip_id:"later",route_id:"R",service_id:"daily",direction_id:"0",trip_headsign:"Short branch",shape_id:"branch"},{trip_id:"reverse",route_id:"R",service_id:"daily",direction_id:"1"}];
    const t=table({trips,stopTimes:[...times(),{trip_id:"later",stop_id:"c",stop_sequence:"1",arrival_time:"15:00:00",departure_time:"15:00:00"},{trip_id:"later",stop_id:"d",stop_sequence:"7",arrival_time:"15:20:00",departure_time:"15:20:00"},...times("reverse","13:00:00")]});
    const first=calculateBusJourney(t,bus(),{now});expect(first.departures.every(d=>d.direction==="0")).toBe(true);const option=first.departures.find(d=>d.tripId==="later")!;
    const result=calculateBusJourney(t,bus(),{now,departure:option.key,paths:new Map([["later",[[3.1,101.6],[3.2,101.7]]]])});expect(result.stops.map(s=>s.id)).toEqual(["c","d"]);expect(result.route?.destination).toBe("Short branch");expect(result.progress.status).toBe("TIMETABLE_PREVIEW");expect(result.path).toHaveLength(2);expect(result.delay).toBeNull();
  });
  it("never expands approximate headways into exact future options",()=>{
    const t=table({frequencies:[{trip_id:"t",start_time:"13:00:00",end_time:"22:00:00",headway_secs:"1800",exact_times:"0"}]});
    const result=calculateBusJourney(t,bus({observation:{tripStartDate:"20261107",tripStartTime:"13:42:00",positionTimestamp:iso("14:00:00")}}),{now});expect(result.departures).toEqual([]);expect(result.frequencies[0].headwaySeconds).toBe(1800);expect(result.stops[1]).toMatchObject({arrival:iso("14:07:00"),classification:"ESTIMATED"});expect(result.delay).toBeNull();
    const unanchored=calculateBusJourney(t,bus(),{now});expect(unanchored.stops.every(s=>s.arrival===null)).toBe(true);expect(unanchored.frequencies.length).toBeGreaterThan(0);
  });
  it("accepts only valid exact-frequency slots and excludes the exclusive end",()=>{
    const t=table({frequencies:[{trip_id:"t",start_time:"13:00:00",end_time:"15:00:00",headway_secs:"1800",exact_times:"1"}]});
    const result=calculateBusJourney(t,bus({observation:{tripStartDate:"20261107",tripStartTime:"13:30:00"}}),{now});expect(result.vehicleDeparture?.classification).toBe("SCHEDULED");expect(result.departures.filter(d=>d.serviceDate==="2026-11-07").map(d=>d.departure)).toEqual([iso("14:00:00"),iso("14:30:00")]);
    expect(calculateBusJourney(t,bus({observation:{tripStartDate:"20261107",tripStartTime:"13:31:00"}}),{now}).vehicleDeparture).toBeNull();
  });
  it("rejects malformed windows and incomplete or conflicting stop sequences",()=>{
    const result=calculateBusJourney(table({frequencies:[{trip_id:"t",start_time:"13:00:00",end_time:"12:00:00",headway_secs:"0"}]}),bus(),{now});expect(result.vehicleDeparture).toBeNull();expect(result.frequencies).toEqual([]);
    const bad=table({stopTimes:[...times(),{...times()[1],stop_id:"c"}]});expect(calculateBusJourney(bad,bus(),{now}).stops).toEqual([]);
    expect(calculateBusJourney(table({stopTimes:[]}),bus(),{now}).stops).toEqual([]);
  });
  it("retains a selected scheduled departure after its start, while refusing keys on other routes",()=>{
    const t=table(),unmatched=bus({tripId:null,observation:{directionId:"0",positionTimestamp:iso("14:00:00")}});const result=calculateBusJourney(t,unmatched,{now:Date.parse(iso("13:00:00"))});const option=result.departures[0];
    const retained=calculateBusJourney(t,unmatched,{now,departure:option.key});expect(retained.selectedDeparture?.key).toBe(option.key);expect(retained.selectionWarning).toBeNull();expect(retained.vehicleDeparture).toBeNull();expect(retained.progress.status).toBe("TIMETABLE_PREVIEW");
    const invalid=calculateBusJourney(t,bus(),{now,departure:JSON.stringify(["other-trip","2026-11-07",48600])});expect(invalid.selectionWarning).not.toBeNull();
  });
  it("does not pair an explicitly chosen opposite timetable direction with the old trip pattern",()=>{
    const result=calculateBusJourney(table(),bus({observation:{positionTimestamp:iso("14:00:00"),tripStartDate:"20260230"}}),{now,direction:"1"});expect(result.stops).toEqual([]);expect(result.route?.origin).toBeNull();
  });
  it("keeps an interpolated origin estimated and out of exact future choices",()=>{
    const rows:Row[]=times();rows[0]={...rows[0],timepoint:"0"};const result=calculateBusJourney(table({stopTimes:rows}),bus(),{now:Date.parse(iso("13:00:00"))});expect(result.vehicleDeparture?.classification).toBe("ESTIMATED");expect(result.departures).toEqual([]);
  });
});
describe("verified vehicle progress",()=>{
  const at=(currentStatus:"STOPPED_AT"|"IN_TRANSIT_TO"|"INCOMING_AT",extra:Record<string,unknown>={})=>bus({observation:{tripStartDate:"20261107",positionTimestamp:iso("14:00:00"),currentStopSequence:20,currentStatus,stopId:"b",...extra}});
  it("identifies completed/current/upcoming stops from explicit sequence/status",()=>{
    const result=calculateBusJourney(table(),at("STOPPED_AT"),{now});expect(result.stops.map(s=>s.status)).toEqual(["DEPARTED","CURRENT","UPCOMING","UPCOMING"]);expect(result.progress.message).toBe("At Fixture second stop");
  });
  it("a vehicle still at the first stop has no hidden previous stops",()=>{
    const result=calculateBusJourney(table(),at("STOPPED_AT",{currentStopSequence:10,stopId:"a"}),{now});expect(result.stops).toHaveLength(4);expect(result.stops.filter(s=>s.status==="DEPARTED")).toEqual([]);expect(result.stops[0].status).toBe("CURRENT");
  });
  it("between stops shows en route without claiming arrival at the next stop",()=>{
    const result=calculateBusJourney(table(),at("IN_TRANSIT_TO"),{now});expect(result.progress.status).toBe("IN_TRANSIT");expect(result.progress.message).toBe("En route to Fixture second stop");expect(result.stops[1].status).toBe("UPCOMING");expect(result.delay).toBeNull();
  });
  it("uses incoming status without inventing a stop arrival",()=>expect(calculateBusJourney(table(),at("INCOMING_AT"),{now}).progress.status).toBe("APPROACHING"));
  it("proves only a minimum departure delay while observed standing after the planned departure",()=>{
    const result=calculateBusJourney(table(),at("STOPPED_AT"),{now});expect(result.delay).toMatchObject({minimumMinutes:4,sequence:20,observedAt:iso("14:00:00")});expect(result.stops[2].arrival).toBe(iso("14:10:00"));
  });
  it("suppresses progress and delay for stale, missing-time or unavailable observations",()=>{
    for(const patch of [{positionTimestamp:iso("13:50:00")},{positionTimestamp:undefined}]){const result=calculateBusJourney(table(),at("STOPPED_AT",patch),{now});expect(result.stops.every(s=>s.status==="UNKNOWN")).toBe(true);expect(result.delay).toBeNull();}
    const offline=calculateBusJourney(table(),at("STOPPED_AT"),{now,realtimeAvailable:false});expect(offline.match.status).toBe("PATTERN_ONLY");expect(offline.stops[1].arrival).toBe(iso("13:55:00"));expect(offline.delay).toBeNull();expect(offline.stops.every(s=>s.status==="UNKNOWN")).toBe(true);
  });
  it("refuses conflicting stop IDs, ambiguous repeated stops and invalid sequence numbers",()=>{
    expect(calculateBusJourney(table(),at("STOPPED_AT",{stopId:"c"}),{now}).progress.status).toBe("UNKNOWN");
    expect(calculateBusJourney(table(),at("STOPPED_AT",{currentStopSequence:99}),{now}).progress.status).toBe("UNKNOWN");
    const t=table({stopTimes:times().map((row,i)=>i===2?{...row,stop_id:"b"}:row)});
    expect(calculateBusJourney(t,at("STOPPED_AT",{currentStopSequence:undefined}),{now}).progress.status).toBe("UNKNOWN");
  });
  it("a unique stop_id alone supplies a hint without departed or arrived claims",()=>{
    const result=calculateBusJourney(table(),at("STOPPED_AT",{currentStopSequence:undefined}),{now});expect(result.progress.message).toContain("Arrival/departure status is not provided");expect(result.stops.every(s=>s.status==="UNKNOWN")).toBe(true);
  });
  it("a verified final-stop observation ends the route without future stops or delay",()=>{
    const result=calculateBusJourney(table(),at("STOPPED_AT",{currentStopSequence:40,stopId:"d"}),{now});expect(result.progress.status).toBe("COMPLETED");expect(result.stops.filter(s=>s.status==="UPCOMING")).toEqual([]);expect(result.delay).toBeNull();
  });
});
describe("protobuf presence handling",()=>{
  it("does not mistake absent protobuf defaults or header timestamps for vehicle observations",()=>{
    const proto=Bindings.transit_realtime.VehiclePosition.decode(Bindings.transit_realtime.VehiclePosition.encode({trip:{tripId:"t",routeId:"R"},position:{latitude:3,longitude:101}}).finish());expect(vehicleObservation(proto)).toEqual({});
  });
  it("retains explicit zero direction/status/sequence and defaults status only with a reported sequence",()=>{
    const proto=Bindings.transit_realtime.VehiclePosition.decode(Bindings.transit_realtime.VehiclePosition.encode({trip:{tripId:"t",directionId:0},currentStopSequence:0,currentStatus:0,timestamp:Math.floor(now/1000)}).finish());expect(vehicleObservation(proto)).toMatchObject({directionId:"0",currentStopSequence:0,currentStatus:"INCOMING_AT",positionTimestamp:iso("14:00:00")});
    expect(vehicleObservation({currentStopSequence:20})).toMatchObject({currentStopSequence:20,currentStatus:"IN_TRANSIT_TO"});
  });
});
