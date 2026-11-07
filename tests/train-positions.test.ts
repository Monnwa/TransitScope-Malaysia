import { describe,expect,it } from "vitest";
import { calculateTrainPositionModels,locateEstimatedTrain,positionsFromPayload,prepareTrainPositions,TRAIN_POSITION_LIMITS } from "@/lib/train-positions";
import { filterEstimatedTrains,groupEstimatedTrains } from "@/lib/train-position-display";
import { indexShape,pointAtDistance } from "@/lib/route-projection";
import { trainFixture,trainPayload,trainTime } from "./fixtures/train-positions";
const window=(exact="1")=>({trip_id:"T",start_time:"14:00:00",end_time:"14:20:00",headway_secs:"300",exact_times:exact});
function model(f= trainFixture(),now=trainTime()){return calculateTrainPositionModels(prepareTrainPositions(f.table,f.paths),now);}
const at=(clock:string)=>positionsFromPayload(trainPayload({},trainTime(clock)),trainTime(clock))[0];
describe("estimated train positions",()=>{
  for(const route of ["KGL","PYL","KJ","AG","PH","MR"])for(const direction of ["0","1"] as const){
    it(`${route} independently supports direction ${direction} from its own shape`,()=>{
      const f=trainFixture({route,direction}),payload=model(f),position=positionsFromPayload(payload,trainTime())[0];
      expect(position).toMatchObject({routeId:route,direction,dataMode:"ESTIMATED",basis:"SCHEDULED_TRIP",destination:"Fixture Terminus"});
      const expected=pointAtDistance(indexShape(f.path)!,indexShape(f.path)!.cumulative[5]/3).point;
      expect(position.position[0]).toBeCloseTo(expected[0],8);expect(position.position[1]).toBeCloseTo(expected[1],8);
      expect(position.previousStation?.name).toBe("Fixture Origin");expect(position.nextStation?.name).toBe("Fixture Bend");
    });
  }
  it("interpolates cumulative railway distance around a bend instead of a station chord",()=>{
    const f=trainFixture();f.table.byTrip.get("T")!.splice(1,1);
    const payload=model(f,trainTime("14:03:30")),train=positionsFromPayload(payload,trainTime("14:03:30"))[0];
    expect(train.position[0]).toBeGreaterThanOrEqual(3.14);expect(train.position[0]).toBeLessThan(3.14002);expect(train.position[1]).toBeCloseTo(101.7,8);
    expect(train.position[0]).not.toBeCloseTo(3.145,4);expect(train.progress).toBe(.5);
  });
  it("handles departure, arrival dwell and terminal expiry boundaries",()=>{
    expect(at("14:00:00").position).toEqual([3.14,101.69]);
    expect(at("14:03:00").nearStation?.name).toBe("Fixture Bend");
    expect(at("14:03:29").position).toEqual(at("14:03:00").position);
    expect(at("14:03:30").nearStation).toBeNull();expect(at("14:03:30").progress).toBe(0);
    expect(at("14:07:00")).toMatchObject({nextStation:null,nextArrival:null,progress:null});
    expect(at("14:07:20")).toBeUndefined();expect(at("13:59:59")).toBeUndefined();
  });
  it("calculates next-arrival times from the timetable rather than movement frames",()=>{
    const start=trainTime(),p=trainPayload(),run=p.runs[0],geometry=p.geometries[0];
    const first=locateEstimatedTrain(run,geometry,start)!,later=locateEstimatedTrain(run,geometry,start+15000)!;
    expect(later.nextArrival).toBe(trainTime("14:03:00"));expect(later.nextArrival).toBe(first.nextArrival);
    expect(later.distanceM).toBeGreaterThan(first.distanceM);expect(locateEstimatedTrain(run,geometry,start)!.position).toEqual(first.position);
  });
  it("generates multiple exact frequency trains; excludes window end and obsolete runs",()=>{
    const p=trainPayload({frequencies:[window()]},trainTime("14:06:00"));
    expect(positionsFromPayload(p,trainTime("14:06:00"))).toHaveLength(2);
    expect(p.runs.every(run=>run.basis==="EXACT_FREQUENCY")).toBe(true);
    const end=trainPayload({frequencies:[window()]},trainTime("14:20:00"));
    expect(end.runs.every(run=>run.startTime<trainTime("14:20:00"))).toBe(true);
    expect(trainPayload({frequencies:[window()]},trainTime("14:23:00")).runs).toEqual([]);
  });
  for(const precision of ["0",""])it(`does not invent a precise phase for approximate frequency (${precision||"absent"})`,()=>{
    const p=trainPayload({frequencies:[window(precision)]});expect(p.runs).toEqual([]);expect(p.geometries).toEqual([]);
    expect(p.lines.find(line=>line.routeId==="KGL")).toMatchObject({status:"FREQUENCY_ONLY",geometryMatchedTrips:1,eligibleTrips:0});
  });
  it("only uses exact sections of mixed frequency service",()=>{
    expect(trainPayload({frequencies:[window("0"),{...window(),start_time:"14:20:00",end_time:"15:00:00"}]}).runs).toEqual([]);
  });
  it("deduplicates equivalent trips, identical stop rows and frequency rows",()=>{
    const f=trainFixture({duplicate:true});f.table.byTrip.get("T")!.splice(1,0,{...f.table.byTrip.get("T")![0]});
    expect(model(f).runs).toHaveLength(1);
    expect(trainPayload({frequencies:[window(),window()]}).runs).toHaveLength(1);
  });
  it("honours removed/added date exceptions and inactive weekdays",()=>{
    expect(trainPayload({exceptions:[{service_id:"D",date:"20261107",exception_type:"2"}]}).runs).toEqual([]);
    expect(trainPayload({calendars:[],exceptions:[{service_id:"D",date:"20261107",exception_type:"1"}]}).runs).toHaveLength(1);
    expect(trainPayload({calendars:[{service_id:"D",saturday:"0",start_date:"20261107",end_date:"20261107"}]}).runs).toEqual([]);
    expect(trainPayload({},trainTime("14:01:00","2027-01-01")).runs).toEqual([]);
  });
  it("uses Kuala Lumpur service dates for >24-hour scheduled trips and exact frequencies",()=>{
    const now=trainTime("00:02:00","2026-11-08"),clocks=["24:00:00","24:03:00","24:03:30","24:07:00","24:07:20"];
    for(const frequencies of [[],[{...window(),start_time:"24:00:00",end_time:"25:00:00"}]]){
      const p=trainPayload({clocks,frequencies},now);expect(p.runs[0]).toMatchObject({serviceDate:"2026-11-07",startTime:trainTime("00:00:00","2026-11-08")});
      expect(positionsFromPayload(p,now)[0].nextArrival).toBe(trainTime("00:03:00","2026-11-08"));
    }
  });
  it("handles midnight independent of browser timezone or daylight changes",()=>{
    const p=trainPayload({},Date.parse("2026-11-07T01:01:00-05:00"));expect(p.runs[0].startTime).toBe(Date.parse("2026-11-07T06:00:00Z"));
  });
  it("fails closed on missing times, ambiguous phase, conflicting sequence, invalid directions or missing coordinates",()=>{
    const mutations=[
      (f:ReturnType<typeof trainFixture>)=>{f.table.byTrip.get("T")![1].arrival_time="";},
      (f:ReturnType<typeof trainFixture>)=>{f.table.byTrip.get("T")![0].timepoint="0";},
      (f:ReturnType<typeof trainFixture>)=>{f.table.byTrip.get("T")![1].stop_sequence="1";},
      (f:ReturnType<typeof trainFixture>)=>{f.table.trips.get("T")!.direction_id="9";},
      (f:ReturnType<typeof trainFixture>)=>{f.table.stops.get("S1")!.stop_lat="";},
      (f:ReturnType<typeof trainFixture>)=>{f.table.trips.get("T")!.shape_id="";},
      (f:ReturnType<typeof trainFixture>)=>{f.table.originConflicts.add("T");},
      (f:ReturnType<typeof trainFixture>)=>{f.table.byTrip.get("T")![1].arrival_time="14:00:00";},
    ];for(const mutate of mutations){const f=trainFixture();mutate(f);expect(model(f).runs).toEqual([]);}
  });
  it("rejects invalid geometry, reversed stop order, off-track or ambiguous station matches",()=>{
    for(const path of [[],[[3.14,101.69],[3.2,102.7]],[[3.4,101.7],[3.41,101.71]], [...trainFixture().path].reverse(),[...trainFixture().path,...[...trainFixture().path].reverse(),...trainFixture().path]]){
      const f=trainFixture();f.paths.set("T",path as [number,number][]);expect(model(f).runs).toEqual([]);
    }
  });
  it("rejects malformed and overlapping frequency windows",()=>{
    for(const windows of [[{...window(),headway_secs:"0"}],[{...window(),exact_times:"2"}],[{...window(),end_time:"bad"}],[window(),{...window(),start_time:"14:10:00"}]])expect(trainPayload({frequencies:windows}).runs).toEqual([]);
  });
  it("does not interpret BRT or other modes as train services",()=>{
    for(const mode of ["Bus","KTM"] as const){const f=trainFixture();f.table.routes.get("KGL")!.mode=mode;expect(model(f).runs).toEqual([]);}
    const f=trainFixture();f.table.routes.get("KGL")!.category="BRT";expect(model(f).runs).toEqual([]);
  });
  it("expires payloads and runs rather than freezing a stale train or showing an ETA",()=>{
    const p=trainPayload();expect(positionsFromPayload(p,trainTime()+TRAIN_POSITION_LIMITS.payloadLifetimeMs)).toEqual([]);
    expect(positionsFromPayload({...p,asOf:new Date(trainTime()+31000).toISOString()},trainTime())).toEqual([]);
    expect(positionsFromPayload({...p,validUntil:"bad"},trainTime())).toEqual([]);
    expect(locateEstimatedTrain(p.runs[0],undefined,trainTime())).toBeNull();
    expect(locateEstimatedTrain(p.runs[0],p.geometries[0],p.runs[0].validUntil)).toBeNull();
  });
  it("reuses prepared static indexes and limits generation to relevant windows",()=>{
    const f=trainFixture();expect(prepareTrainPositions(f.table,f.paths)).toBe(prepareTrainPositions(f.table,f.paths));
    const p=trainPayload({frequencies:[{...window(),start_time:"00:00:00",end_time:"27:00:00",headway_secs:"300"}]});
    expect(p.runs.length).toBeLessThan(4);expect(p.runs.every(run=>run.validFrom<=trainTime()+120000&&run.validUntil>trainTime())).toBe(true);
  });
  it("suppresses an excessive ambiguous fleet instead of silently truncating it",()=>{
    const p=trainPayload({frequencies:[{...window(),headway_secs:"1"}]},trainTime("14:06:00"));expect(p.runs).toEqual([]);expect(p.message).toContain("temporarily unavailable");
  });
});
describe("train map display",()=>{
  const filters={query:"",modes:[],statuses:[],dataModes:["LIVE","STATIC","ESTIMATED"]};
  it("respects mode, line, service status, text, and information-type filters",()=>{
    const positions=positionsFromPayload(trainPayload(),trainTime()),show=(values={},hidden:string[]=[],available=["MRT1"])=>filterEstimatedTrains(positions,{...filters,...values},hidden,available);
    expect(show()).toHaveLength(1);expect(show({modes:["Bus"]})).toEqual([]);expect(show({statuses:["Station available"]})).toEqual([]);
    expect(show({dataModes:["LIVE","STATIC"]})).toEqual([]);expect(show({},["MRT1"])).toEqual([]);expect(show({},[],[])).toEqual([]);
    expect(show({query:"Fixture Bend"})).toHaveLength(1);expect(show({query:"missing"})).toEqual([]);
  });
  it("groups overlapping icons at an original coordinate and preserves separate run identities",()=>{
    const train=positionsFromPayload(trainPayload(),trainTime())[0],other={...train,id:"Other",position:[3.14001,101.69001] as [number,number]},before=JSON.stringify([train,other]);
    const groups=groupEstimatedTrains([train,other],()=>({x:10,y:10}),other.id);expect(groups).toHaveLength(1);expect(groups[0].anchor).toBe(other);expect(groups[0].members).toHaveLength(2);
    expect(JSON.stringify([train,other])).toBe(before);expect(groupEstimatedTrains([train,other],t=>({x:t===train?0:100,y:0}),null)).toHaveLength(2);
  });
});
